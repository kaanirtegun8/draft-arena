import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, resultFingerprint, performanceScore } from '../src/core/engine.js';
import { PERFORMANCE_WEIGHTS, MAX_SUBS } from '../src/core/config.js';
import { autoLineup } from '../src/core/tactics.js';
import { prepareMatchInput, nextMatch } from '../src/core/league.js';
import { draftedLeague, byId, pool, clone } from './helpers.js';
import { groupOf } from '../src/core/players.js';

function firstInput(seed = 'eng') {
  const s = draftedLeague(seed);
  return prepareMatchInput(s, nextMatch(s).id, byId).input;
}

// Build a synthetic team from the pool: strong=true takes the best players per group.
function team(id, strong, cond = 100) {
  const groups = { GK: 2, DEF: 6, MID: 6, FWD: 4 };
  const squad = [];
  for (const [g, n] of Object.entries(groups)) {
    const list = pool.filter((p) => groupOf(p) === g).sort((a, b) => b.ovr - a.ovr);
    const pickFrom = strong ? list.slice(0, n) : list.slice(-n);
    squad.push(...pickFrom.map((p) => p.id));
  }
  const ps = {};
  for (const pid of squad) ps[pid] = { condition: cond, injuredWeeks: 0 };
  const { lineup, bench } = autoLineup({ squad, formation: '4-3-3', playerById: byId, playerState: ps, rotation: 0 });
  const players = {};
  for (const pid of squad) players[pid] = { ...byId[pid], condition: cond };
  return { id, name: id, formation: '4-3-3', style: 'balanced', autoManage: true, subRules: [], lineup, bench, players };
}

test('performance weights are the configured starting values and sum to 1', () => {
  assert.deepEqual(PERFORMANCE_WEIGHTS, { ea: 0.3, form: 0.3, tactic: 0.15, matchup: 0.1, condition: 0.1, random: 0.05 });
  const sum = Object.values(PERFORMANCE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('same seed => identical match; different seed => different match', () => {
  const input = firstInput();
  const a = simulateMatch(clone(input));
  const b = simulateMatch(clone(input));
  assert.equal(resultFingerprint(a), resultFingerprint(b));
  assert.deepEqual(a, b);
  const c = simulateMatch({ ...clone(input), seed: 'other' });
  assert.notEqual(resultFingerprint(a), resultFingerprint(c));
});

test('score is built from events: goal events, player goals and team score agree', () => {
  for (let i = 0; i < 30; i++) {
    const input = firstInput('evt' + i);
    const r = simulateMatch(input);
    for (const side of ['home', 'away']) {
      const goalsEv = r.events.filter((e) => e.type === 'goal' && e.side === side).length;
      const goalsPl = Object.values(r.playerStats).filter((x) => x.side === side && x.played).reduce((s, x) => s + x.goals, 0);
      const score = side === 'home' ? r.homeGoals : r.awayGoals;
      assert.equal(goalsEv, score);
      assert.equal(goalsPl, score);
      const assistsEv = r.events.filter((e) => e.type === 'goal' && e.side === side && e.assistId).length;
      const assistsPl = Object.values(r.playerStats).filter((x) => x.side === side && x.played).reduce((s, x) => s + x.assists, 0);
      assert.equal(assistsEv, assistsPl);
      const shots = r.events.filter((e) => ['goal', 'save', 'miss'].includes(e.type) && e.side === side).length;
      assert.equal(shots, r.teamStats[side].shots);
    }
    for (const e of r.events.filter((x) => x.type === 'goal')) assert.notEqual(e.playerId, e.assistId);
    // score in goal events is monotonic and ends at the final score
    const last = r.events.filter((e) => e.type === 'goal').pop();
    if (last) assert.deepEqual(last.score, [r.homeGoals, r.awayGoals]);
    assert.ok(r.motm && r.playerStats[r.motm].played);
  }
});

test('never more than 5 substitutions, even with aggressive rules', () => {
  for (let i = 0; i < 25; i++) {
    const input = firstInput('subs' + i);
    for (const side of ['home', 'away']) {
      const t = input[side];
      t.subRules = [
        { type: 'fatigue', threshold: 99, fromMinute: 46 },
        { type: 'yellow', fromMinute: 46 },
        ...t.lineup.slice(1, 8).map((l, k) => ({ type: 'minute', minute: 46 + k, outId: l.playerId, inId: t.bench[k] })),
      ];
    }
    const r = simulateMatch(input);
    for (const side of ['home', 'away']) {
      const subs = r.events.filter((e) => e.type === 'sub' && e.side === side);
      assert.ok(subs.length <= MAX_SUBS, `${subs.length} değişiklik`);
      assert.equal(subs.length, r.subsUsed[side]);
      // nobody comes back after leaving, nobody comes on twice
      const ins = subs.map((s) => s.in), outs = subs.map((s) => s.out);
      assert.equal(new Set(ins).size, ins.length);
      for (const p of ins) assert.ok(!input[side].lineup.some((l) => l.playerId === p));
      for (const o of outs) assert.ok(!ins.includes(o));
      const onPitchAtEnd = Object.values(r.playerStats).filter((x) => x.side === side && x.played).length;
      assert.equal(onPitchAtEnd, 11 + subs.length);
    }
  }
});

test('a pre-match minute rule is executed at its minute', () => {
  const input = firstInput('rule');
  const t = input.home;
  const out = t.lineup[9].playerId, inn = t.bench.find((b) => groupOf(byId[b]) === 'FWD') || t.bench[0];
  t.autoManage = false;
  t.subRules = [{ type: 'minute', minute: 63, outId: out, inId: inn }];
  const r = simulateMatch(input);
  const sub = r.events.find((e) => e.type === 'sub' && e.side === 'home' && e.reason === 'rule:minute');
  if (r.playerStats[out].red || r.playerStats[out].injured) return; // edge case: left earlier
  assert.ok(sub, 'kural çalışmalı');
  assert.equal(sub.minute, 63);
  assert.equal(sub.out, out);
  assert.equal(sub.in, inn);
});

test('engine calibration: realistic averages over many matches', () => {
  let goals = 0, shots = 0, sot = 0, n = 0, home = 0;
  for (let i = 0; i < 160; i++) {
    const r = simulateMatch(firstInput('cal' + (i % 40)) && { ...firstInput('cal' + (i % 40)), seed: 'x' + i });
    n++; goals += r.homeGoals + r.awayGoals;
    shots += r.teamStats.home.shots + r.teamStats.away.shots;
    sot += r.teamStats.home.shotsOnTarget + r.teamStats.away.shotsOnTarget;
    if (r.homeGoals > r.awayGoals) home++;
  }
  const gpm = goals / n;
  assert.ok(gpm > 2.1 && gpm < 3.5, `maç başı gol ${gpm}`);
  assert.ok(shots / n / 2 > 8 && shots / n / 2 < 17, `şut ${shots / n / 2}`);
  assert.ok(sot / shots > 0.28 && sot / shots < 0.5, `isabet ${sot / shots}`);
});

test('stronger squads win clearly more often than weak squads', () => {
  let strongWins = 0, weakWins = 0, sg = 0, wg = 0;
  for (let i = 0; i < 120; i++) {
    const homeStrong = i % 2 === 0;
    const H = team('H', homeStrong), A = team('A', !homeStrong);
    const r = simulateMatch({ seed: 'str' + i, matchId: 'x', home: H, away: A, form: {} });
    const s = homeStrong ? r.homeGoals : r.awayGoals, w = homeStrong ? r.awayGoals : r.homeGoals;
    sg += s; wg += w;
    if (s > w) strongWins++; else if (w > s) weakWins++;
  }
  assert.ok(strongWins > weakWins * 2.5, `güçlü ${strongWins} / zayıf ${weakWins}`);
  assert.ok(weakWins > 0, 'sürprizler mümkün olmalı (rastgelelik)');
  assert.ok(sg > wg * 1.6);
});

test('low condition lowers performance and results', () => {
  const base = { player: pool.find((p) => p.pos === 'ST'), slot: 'ST', form: null, style: 'balanced', opp: null, randomU: 0 };
  const fresh = performanceScore({ ...base, condition: 100 }).total;
  const tired = performanceScore({ ...base, condition: 40 }).total;
  assert.ok(Math.abs(fresh - tired - 0.1 * 60) < 1e-9, 'kondisyon ağırlığı %10');
  let freshPts = 0, tiredPts = 0;
  for (let i = 0; i < 120; i++) {
    const F = team('F', true, 100), T = team('T', true, 35);
    const r = simulateMatch({ seed: 'cond' + i, matchId: 'x', home: i % 2 ? F : T, away: i % 2 ? T : F, form: {} });
    const f = i % 2 ? r.homeGoals : r.awayGoals, t = i % 2 ? r.awayGoals : r.homeGoals;
    if (f > t) freshPts += 3; else if (f === t) { freshPts++; tiredPts++; } else tiredPts += 3;
  }
  assert.ok(freshPts > tiredPts, `dinç ${freshPts} / yorgun ${tiredPts}`);
});

test('missing form is neutral; form data moves performance by its weight', () => {
  const base = { player: pool.find((p) => p.pos === 'CM'), slot: 'CM', style: 'balanced', opp: null, randomU: 0, condition: 100 };
  const none = performanceScore({ ...base, form: null }).total;
  const neutral = performanceScore({ ...base, form: 50 }).total;
  const hot = performanceScore({ ...base, form: 70 }).total;
  const cold = performanceScore({ ...base, form: 30 }).total;
  assert.equal(none, neutral);
  assert.ok(hot > none && cold < none);
  assert.ok(Math.abs((hot - none) - 0.3 * 20 * 0.4) < 1e-6);
});

test('out-of-position players are penalised by tactic fit', () => {
  const cb = pool.find((p) => p.pos === 'CB');
  const asCb = performanceScore({ player: cb, slot: 'CB', form: null, style: 'balanced', opp: null, randomU: 0, condition: 100 });
  const asSt = performanceScore({ player: cb, slot: 'ST', form: null, style: 'balanced', opp: null, randomU: 0, condition: 100 });
  assert.ok(asCb.total > asSt.total + 5);
  assert.equal(asCb.fit, 1);
});
