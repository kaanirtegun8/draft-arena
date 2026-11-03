// Goal levels with roles, honest xG, penalty events and resting worn-out starters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/core/engine.js';
import { defaultInstructions } from '../src/core/tactics.js';
import { abilities, buildMarketModel } from '../src/core/abilities.js';
import { formationSlots, roleOf } from '../src/core/positions.js';
import { rolesFor, roleFit } from '../src/core/roles.js';
import { restTired, REST_BELOW, teamSnapshot, levelFn, playerStateBefore } from '../src/core/season.js';
import { POOL, byId, makeRoom, startLeague } from './helpers.js';

const SLOT_ROLE = { GK: 'GK', CB: 'CB', RB: 'RB', LB: 'LB', CDM: 'CDM', CM: 'CM', CAM: 'CAM', RW: 'RW', LW: 'LW', ST: 'ST' };
// XI for 4-3-3 from the n-th best players per position, every slot with its best-fitting role
function side(id, rank, used, { roles = true } = {}) {
  const slots = formationSlots('4-3-3');
  const lineup = slots.map((s) => {
    const p = POOL.filter((x) => roleOf(x) === SLOT_ROLE[s.code] && !used.has(x.id)).sort((a, b) => b.ovr - a.ovr)[rank];
    used.add(p.id);
    return p.id;
  });
  const withRoles = slots.map((s, i) => {
    if (!roles) return { ...s, role: null };
    const ab = abilities(byId[lineup[i]]);
    return { ...s, role: rolesFor(s.code).slice().sort((a, b) => roleFit(b, ab) - roleFit(a, ab))[0] || null };
  });
  const players = {};
  for (const pid of lineup) players[pid] = { ...byId[pid], level: byId[pid].ovr, condition: 100 };
  return { id, name: id, formation: '4-3-3', slots: withRoles, instructions: defaultInstructions(), lineup, bench: [], players, autoManage: true, subRules: [] };
}

function league(n, opts) {
  let goals = 0, xg = 0, pens = 0, penGoals = 0, penLabelled = true;
  for (let i = 0; i < n; i++) {
    const used = new Set();
    const H = side('H', i % 3, used, opts), A = side('A', (i + 1) % 3, used, opts);
    const r = simulateMatch({ seed: 'bal' + i, matchId: 'm', home: H, away: A });
    goals += r.homeGoals + r.awayGoals;
    xg += r.teamStats.home.xg + r.teamStats.away.xg;
    for (const e of r.events) {
      if (e.type === 'goal' || e.type === 'miss' || e.type === 'save') {
        if (e.penalty) { pens++; if (e.type === 'goal') penGoals++; if (e.chance !== 'penalty' || e.zone !== 'C') penLabelled = false; }
      }
    }
  }
  return { goals: goals / n, xg: xg / n, pens, penGoals, penLabelled };
}

test('well-fitting roles on both sides do not turn matches into goal fests', () => {
  const plain = league(300, { roles: false });
  const roles = league(300, { roles: true });
  assert.ok(roles.goals < 3.3, `rollerle maç başı gol ${roles.goals.toFixed(2)}`);
  assert.ok(roles.goals < plain.goals * 1.3, `rolsüz ${plain.goals.toFixed(2)} / rollü ${roles.goals.toFixed(2)}`);
});

test('xG matches the goals actually scored (keepers are measured against an average starter)', () => {
  const r = league(400, { roles: true });
  const ratio = r.goals / r.xg;
  assert.ok(ratio > 0.85 && ratio < 1.15, `gol/xG ${ratio.toFixed(2)}`);
});

test('penalties are logged as penalties and are scored most of the time', () => {
  const r = league(600, { roles: true });
  assert.ok(r.pens > 10, `penaltı sayısı ${r.pens}`);
  assert.ok(r.penLabelled, 'penaltı şutu "penalty" olarak, merkezden kaydedilmeli');
  const rate = r.penGoals / r.pens;
  assert.ok(rate > 0.6 && rate < 0.9, `penaltı gol oranı ${rate.toFixed(2)}`);
});

test('restTired: an exhausted starter is rested when a fresher squad player is better', () => {
  const cbs = POOL.filter((p) => roleOf(p) === 'CB').sort((a, b) => b.ovr - a.ovr);
  const star = cbs[0], sub = cbs[3];
  const slots = [{ code: 'CB', side: 'C' }];
  const levelOf = (p) => p.ovr;
  const tired = restTired({ lineup: [star.id], slots, squad: [star.id, sub.id], byId, state: { [star.id]: { condition: 35 } }, levelOf });
  assert.deepEqual(tired.lineup, [sub.id]);
  assert.deepEqual(tired.swaps, [{ out: star.id, in: sub.id }]);
  // just under the threshold but the only alternative is a striker: he plays
  const st = POOL.filter((p) => roleOf(p) === 'ST').sort((a, b) => b.ovr - a.ovr)[0];
  const ok = restTired({ lineup: [star.id], slots, squad: [star.id, st.id], byId, state: { [star.id]: { condition: REST_BELOW - 1 } }, levelOf });
  assert.deepEqual(ok.lineup, [star.id]);
  // fresh enough: never touched
  const fresh = restTired({ lineup: [star.id], slots, squad: [star.id, sub.id], byId, state: { [star.id]: { condition: REST_BELOW + 1 } }, levelOf });
  assert.deepEqual(fresh.swaps, []);
});

test('kick-off line-up rests a worn-out starter unless the manager turned it off', async () => {
  const ctx = await makeRoom(2, { squadSize: 16 });
  const room = await startLeague(ctx);
  const seat = Object.keys(room.members)[0];
  const levelOf = levelFn(buildMarketModel(POOL));
  const state = playerStateBefore(room, room.season.currentWeek);
  const base = teamSnapshot(room, seat, state, byId, levelOf).snapshot;
  const victim = base.lineup.find((pid) => byId[pid].pos !== 'GK');
  state[victim] = { ...state[victim], condition: 20 };
  const withXI = (extra) => ({ ...room, tactics: { ...(room.tactics || {}), [seat]: { ...((room.tactics || {})[seat] || {}), lineup: base.lineup, ...extra } } });
  const rested = teamSnapshot(withXI({}), seat, state, byId, levelOf);
  assert.ok(!rested.snapshot.lineup.includes(victim), 'yorgun oyuncu ilk 11 dışında');
  assert.ok(rested.notes.some((n) => /dinlendirildi/.test(n)), 'maç notu yazıldı');
  assert.ok(teamSnapshot(withXI({ restTired: false }), seat, state, byId, levelOf).snapshot.lineup.includes(victim), 'kapalıyken menajerin 11\'i korunur');
});
