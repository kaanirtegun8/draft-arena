import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, fingerprint, MAX_SUBS } from '../src/core/engine.js';
import { teamUnits, analyse, defaultInstructions } from '../src/core/tactics.js';
import { formationSlots, roleOf } from '../src/core/positions.js';
import { POOL, byId } from './helpers.js';

const best = (role, n, skip = new Set(), filter = () => true) => POOL.filter((p) => roleOf(p) === role && !skip.has(p.id) && filter(p)).sort((a, b) => b.ovr - a.ovr).slice(0, n);

// Build an XI for a formation from role lists (slot code -> role pool)
const SLOT_ROLE = { GK: 'GK', CB: 'CB', RB: 'RB', LB: 'LB', RWB: 'RB', LWB: 'LB', CDM: 'CDM', CM: 'CM', CAM: 'CAM', RM: 'RW', LM: 'LW', RW: 'RW', LW: 'LW', ST: 'ST', CF: 'ST' };
function team(id, formation, { ins = {}, pick = {}, levelDelta = 0, cond = 100, skip = new Set(), filter = {} } = {}) {
  const used = new Set(skip);
  const lineup = formationSlots(formation).map((s) => {
    const role = pick[s.code] || SLOT_ROLE[s.code];
    const p = best(role, 1, used, filter[s.code] || (() => true))[0];
    used.add(p.id);
    return p.id;
  });
  const bench = ['GK', 'CB', 'CM', 'ST', 'LW', 'RB', 'CDM'].map((r) => best(r, 1, used)[0]).filter(Boolean).map((p) => { used.add(p.id); return p.id; });
  const players = {};
  for (const pid of [...lineup, ...bench]) players[pid] = { ...byId[pid], level: byId[pid].ovr + levelDelta, condition: cond };
  return { id, name: id, formation, instructions: { ...defaultInstructions(), ...ins }, lineup, bench, players, autoManage: true, subRules: [], used };
}

// home is built first; the away side never reuses home players (like a real league)
function series(n, mkHome, mkAway) {
  const out = { hg: 0, ag: 0, hw: 0, aw: 0, poss: 0, flankConcededH: 0, centralConcededH: 0, n };
  for (let i = 0; i < n; i++) {
    const home = mkHome(i);
    const away = mkAway(home.used);
    const r = simulateMatch({ seed: 'eng' + i, matchId: 'm', home, away });
    out.hg += r.homeGoals; out.ag += r.awayGoals;
    if (r.homeGoals > r.awayGoals) out.hw++; else if (r.awayGoals > r.homeGoals) out.aw++;
    out.poss += r.teamStats.home.possession;
    for (const e of r.events) if (e.type === 'goal' && e.side === 'away') { if (e.zone === 'L' || e.zone === 'R') out.flankConcededH++; else out.centralConcededH++; }
  }
  out.poss /= n;
  return out;
}

test('same seed => same match; different seed => different match', () => {
  const H = team('H', '4-3-3'), A = team('A', '4-2-3-1', { skip: H.used });
  const a = simulateMatch({ seed: 's1', matchId: 'm', home: H, away: A });
  const b = simulateMatch({ seed: 's1', matchId: 'm', home: JSON.parse(JSON.stringify(H)), away: JSON.parse(JSON.stringify(A)) });
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(simulateMatch({ seed: 's2', matchId: 'm', home: H, away: A })));
});

test('events are consistent with the score; never more than 5 subs', () => {
  for (let i = 0; i < 40; i++) {
    const H = team('H', '4-3-3'), A = team('A', '4-4-2', { skip: H.used });
    H.subRules = [{ type: 'fatigue', threshold: 99, fromMinute: 46 }, { type: 'yellow', fromMinute: 46 }];
    const r = simulateMatch({ seed: 'c' + i, matchId: 'm', home: H, away: A });
    for (const side of ['home', 'away']) {
      const goals = r.events.filter((e) => e.type === 'goal' && e.side === side).length;
      assert.equal(goals, side === 'home' ? r.homeGoals : r.awayGoals);
      assert.equal(Object.values(r.playerStats).filter((x) => x.side === side && x.played).reduce((a, x) => a + x.goals, 0), goals);
      assert.ok(r.subsUsed[side] <= MAX_SUBS);
    }
    for (const e of r.events.filter((x) => x.type === 'goal')) assert.notEqual(e.playerId, e.assistId);
  }
});

test('stronger current level (form + market value) wins clearly more often', () => {
  const base = series(200, () => team('H', '4-3-3'), (skip) => team('A', '4-3-3', { skip }));
  const s = series(200, () => team('H', '4-3-3', { levelDelta: 4 }), (skip) => team('A', '4-3-3', { skip, levelDelta: -4 }));
  assert.ok(s.hw > base.hw * 1.2 && s.aw < base.aw * 0.8, `fark: ${base.hw}-${base.aw} → ${s.hw}-${s.aw}`);
  assert.ok(s.aw > 0, 'sürpriz mümkün');
});

test('no defensive midfielder: two attacking CMs concede more than a double pivot', () => {
  const opp = (skip) => team('A', '4-3-3', { skip });
  const noAnchor = series(200, () => team('H', '4-4-2', { pick: { CM: 'CAM' }, filter: { CM: (p) => p.def < 62 } }), opp);
  const pivot = series(200, () => team('H', '4-2-3-1'), opp);
  assert.ok(noAnchor.ag > pivot.ag * 1.1, `DOS'suz ${noAnchor.ag} / çift pivot ${pivot.ag}`);
  const H = team('H', '4-4-2', { pick: { CM: 'CAM' }, filter: { CM: (p) => p.def < 62 } });
  const view = (t) => t.lineup.map((pid, i) => ({ slot: formationSlots(t.formation)[i], player: t.players[pid], level: t.players[pid].level, cond: 100, day: 1 }));
  const A = opp(H.used);
  const a = analyse(teamUnits(view(H), H.instructions), teamUnits(view(A), A.instructions), H.instructions, A.instructions);
  assert.ok(a.notes.some((n) => /ön libero|iki orta saha/i.test(n.text)), 'analiz uyarısı');
});

test('wingers who do not track back + attacking full-backs concede more from the flanks', () => {
  const opp = (skip) => team('A', '4-3-3', { skip, ins: { width: 'wide' } });
  const lazy = (p) => p.workDef === 'L';
  const hasLazy = POOL.filter((p) => ['LW', 'RW'].includes(roleOf(p)) && lazy(p)).length >= 2;
  const mk = (exposed) => () => {
    const t = team('H', '4-3-3', { ins: { fullbacks: exposed ? 'attack' : 'stay' } });
    if (exposed && !hasLazy) for (const pid of t.lineup) if (['LW', 'RW'].includes(roleOf(t.players[pid]))) t.players[pid].workDef = 'L';
    if (!exposed) for (const pid of t.lineup) if (['LW', 'RW'].includes(roleOf(t.players[pid]))) t.players[pid].workDef = 'H';
    return t;
  };
  const exposed = series(250, mk(true), opp);
  const safe = series(250, mk(false), opp);
  assert.ok(exposed.flankConcededH > safe.flankConcededH * 1.15, `açık kanat ${exposed.flankConcededH} / kapalı ${safe.flankConcededH}`);
});

test('being outnumbered in midfield costs possession', () => {
  const opp = (skip) => team('A', '4-3-3', { skip });
  const two = series(80, () => team('H', '4-4-2'), opp);
  const diamond = series(80, () => team('H', '4-4-2 Elmas'), opp);
  assert.ok(diamond.poss > two.poss + 2, `elmas ${diamond.poss.toFixed(1)} / düz 4-4-2 ${two.poss.toFixed(1)}`);
});

test('a centre-back playing up front is much worse than a real striker', () => {
  const opp = (skip) => team('A', '4-3-3', { skip });
  const real = series(200, () => team('H', '4-3-3'), opp);
  const wrong = series(200, () => team('H', '4-3-3', { pick: { ST: 'CB' } }), opp);
  assert.ok(real.hg > wrong.hg * 1.15, `gerçek forvet ${real.hg} / stoper forvette ${wrong.hg}`);
});

test('tired squads lose more often', () => {
  const base = series(200, () => team('H', '4-3-3'), (skip) => team('A', '4-3-3', { skip }));
  const s = series(200, () => team('H', '4-3-3'), (skip) => team('A', '4-3-3', { skip, cond: 45 }));
  assert.ok(s.hw > base.hw * 1.2 && s.aw < base.aw * 0.8, `dinç rakibe karşı ${base.hw}-${base.aw}, yorgun rakibe karşı ${s.hw}-${s.aw}`);
});

test('calibration: realistic averages', () => {
  let goals = 0, shots = 0, sot = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const fs = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '4-1-4-1'];
    const H = team('H', fs[i % 5]), A = team('A', fs[(i + 2) % 5], { skip: H.used });
    const r = simulateMatch({ seed: 'cal' + i, matchId: 'm', home: H, away: A });
    n++; goals += r.homeGoals + r.awayGoals;
    shots += r.teamStats.home.shots + r.teamStats.away.shots; sot += r.teamStats.home.sot + r.teamStats.away.sot;
  }
  assert.ok(goals / n > 2.0 && goals / n < 3.6, `gol ${goals / n}`);
  assert.ok(shots / n / 2 > 8 && shots / n / 2 < 17, `şut ${shots / n / 2}`);
  assert.ok(sot / shots > 0.27 && sot / shots < 0.5, `isabet ${sot / shots}`);
});
