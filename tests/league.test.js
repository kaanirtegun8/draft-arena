import test from 'node:test';
import assert from 'node:assert/strict';
import { draftedLeague, fullSeason, byId, clone } from './helpers.js';
import { playMatch, nextMatch, replayMatch, playRemaining, setTactics, autoPickLineup } from '../src/core/league.js';
import { resultFingerprint } from '../src/core/engine.js';
import { seasonPlayerStats, standings, finishedMatches } from '../src/core/stats.js';
import { computeAwards } from '../src/core/awards.js';
import { FITNESS } from '../src/core/config.js';

test('every team plays 8 matches over a full season', () => {
  const s = fullSeason('season8');
  assert.equal(s.phase, 'finished');
  const st = standings(s);
  for (const r of st) assert.equal(r.played, 8);
  assert.equal(finishedMatches(s).length, 20);
  const pts = st.reduce((a, r) => a + r.points, 0);
  const draws = finishedMatches(s).filter((m) => m.result.homeGoals === m.result.awayGoals).length;
  assert.equal(pts, 20 * 3 - draws);
});

test('a match result is finalised only once', () => {
  const s = draftedLeague('once');
  const mt = nextMatch(s);
  const played = playMatch(s, mt.id, byId);
  const fp = resultFingerprint(played.result);
  assert.throws(() => playMatch(s, mt.id, byId), /zaten/);
  assert.equal(resultFingerprint(s.matches[mt.id].result), fp);
  // replay reproduces the exact same match and does not change state
  const before = JSON.stringify(s);
  const replay = replayMatch(s, mt.id);
  assert.equal(resultFingerprint(replay), fp);
  assert.equal(JSON.stringify(s), before);
});

test('future-week matches cannot be played early', () => {
  const s = draftedLeague('early');
  const later = s.schedule[3].matches[0];
  assert.throws(() => playMatch(s, later.id, byId), /haftanın/);
});

test('season goals and assists equal the sum of match events', () => {
  const s = fullSeason('consist');
  const stats = seasonPlayerStats(s);
  const goalEvents = finishedMatches(s).flatMap((m) => m.result.events.filter((e) => e.type === 'goal'));
  const totalGoals = finishedMatches(s).reduce((a, m) => a + m.result.homeGoals + m.result.awayGoals, 0);
  assert.equal(goalEvents.length, totalGoals);
  assert.equal(Object.values(stats).reduce((a, x) => a + x.goals, 0), totalGoals);
  assert.equal(Object.values(stats).reduce((a, x) => a + x.assists, 0), goalEvents.filter((e) => e.assistId).length);
  for (const [pid, x] of Object.entries(stats)) {
    assert.equal(x.goals, goalEvents.filter((e) => e.playerId === pid).length);
    assert.equal(x.assists, goalEvents.filter((e) => e.assistId === pid).length);
    assert.ok(x.shotsOnTarget <= x.shots && x.goals <= x.shotsOnTarget);
    assert.ok(x.starts <= x.apps && x.apps <= 8 && x.minutes <= x.apps * 90);
  }
  const st = standings(s);
  assert.equal(st.reduce((a, r) => a + r.gf, 0), totalGoals);
  // goalkeeper conceded = goals against while on pitch
  const gkConceded = Object.values(stats).reduce((a, x) => a + x.conceded, 0);
  assert.ok(gkConceded <= totalGoals);
});

test('bonus points are applied only after the season, and correctly', () => {
  const s = draftedLeague('bonus');
  playRemaining(s, byId, 9);
  assert.equal(s.bonusApplied, false);
  assert.equal(s.awards, null);
  for (const r of standings(s)) { assert.equal(r.bonus, 0); assert.equal(r.total, r.points); }
  playRemaining(s, byId);
  assert.equal(s.phase, 'finished');
  assert.equal(s.bonusApplied, true);
  const a = s.awards;
  const stats = seasonPlayerStats(s);
  const maxGoals = Math.max(...Object.values(stats).map((x) => x.goals));
  const maxAssists = Math.max(...Object.values(stats).map((x) => x.assists));
  assert.equal(stats[a.topScorer.pid].goals, maxGoals);
  assert.equal(stats[a.topAssist.pid].assists, maxAssists);
  const owner = (pid) => s.managers.find((m) => m.squad.includes(pid)).id;
  assert.equal(a.topScorer.managerId, owner(a.topScorer.pid));
  const expected = {};
  for (const m of s.managers) expected[m.id] = 0;
  expected[owner(a.topScorer.pid)] += 2;
  expected[owner(a.topAssist.pid)] += 1;
  for (const r of standings(s)) {
    assert.equal(r.bonus, expected[r.managerId]);
    assert.equal(r.total, r.points + expected[r.managerId]);
  }
  assert.equal(s.champion, standings(s)[0].managerId);
  // awards are stable/deterministic
  assert.deepEqual(computeAwards(s, byId), a);
  assert.equal(a.teamOfSeason.length, 11);
  assert.ok(a.bestKeeper && a.playerOfSeason && a.bestPick);
});

test('condition: drops with minutes, bench rests more, BAY week recovers', () => {
  const s = draftedLeague('fit');
  const w1 = s.schedule[0];
  const byeTeam = s.managers.find((m) => m.id === w1.bye);
  // tire the bye team artificially to see recovery
  for (const pid of byeTeam.squad) s.playerState[pid].condition = 50;
  const snap = clone(s.playerState);
  for (const m of w1.matches) playMatch(s, m.id, byId);
  for (const pid of byeTeam.squad) assert.equal(s.playerState[pid].condition, Math.min(100, 50 + FITNESS.recoverBye));
  const r = s.matches[w1.matches[0].id].result;
  for (const [pid, x] of Object.entries(r.playerStats)) {
    if (x.played && x.minutes >= 80) assert.ok(x.endCondition < snap[pid].condition, 'oynayan yorulur');
    if (!x.played && !s.playerState[pid].injuredWeeks) assert.equal(s.playerState[pid].condition, Math.min(100, snap[pid].condition + FITNESS.recoverBench));
  }
  assert.ok(FITNESS.recoverBench > FITNESS.recoverAfterPlaying);
  for (const st of Object.values(s.playerState)) assert.ok(st.condition >= 0 && st.condition <= 100);
});

test('CPU teams rotate tired players', () => {
  const s = draftedLeague('rot');
  playRemaining(s, byId, 6);
  const stats = seasonPlayerStats(s);
  const m = s.managers[0];
  const starters = m.squad.filter((pid) => stats[pid].starts > 0).length;
  assert.ok(starters > 11, `rotasyon: ${starters} farklı oyuncu ilk 11'de`);
});

test('human tactics: lineup validation, formation change and sub rules', () => {
  const s = draftedLeague('human', [0]);
  const m = s.managers[0];
  m.isHuman = true;
  setTactics(s, m.id, { formation: '4-4-2' }, byId);
  assert.equal(m.tactics.lineup.length, 11);
  assert.equal(m.tactics.lineup[5].slot, 'LM');
  const bad = m.tactics.lineup.map((l) => ({ ...l }));
  bad[1].playerId = bad[2].playerId;
  assert.throws(() => setTactics(s, m.id, { lineup: bad }, byId), /iki kez/);
  setTactics(s, m.id, { subRules: [{ type: 'fatigue', threshold: 500, fromMinute: 10 }, { type: 'bogus' }] }, byId);
  assert.deepEqual(m.tactics.subRules, [{ type: 'fatigue', threshold: 90, fromMinute: 46 }]);
  autoPickLineup(s, m.id, byId);
  playRemaining(s, byId, 2);
  assert.equal(s.currentWeek, 3);
});
