import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, startLeague, playAll, draftAll, byId, POOL } from './helpers.js';
import { squads } from '../src/core/draft.js';
import { buildSchedule, weeksFor } from '../src/core/schedule.js';
import { standings, seasonStats, playerStateBefore, finishedMatches, weeksOf, BONUS, DISCIPLINE } from '../src/core/season.js';
import { toArray } from '../src/core/draft.js';
import { fingerprint } from '../src/core/engine.js';

test('schedule: double round robin for 2..10 teams, home/away balanced, byes for odd counts', () => {
  for (let n = 2; n <= 10; n++) {
    const ids = Array.from({ length: n }, (_, i) => `t${i}`);
    const weeks = buildSchedule(ids);
    const all = weeks.flatMap((w) => w.matches);
    assert.equal(all.length, n * (n - 1), `n=${n}`);
    assert.equal(weeks.length, n % 2 ? 2 * n : 2 * (n - 1));
    for (const t of ids) {
      assert.equal(all.filter((m) => m.home === t).length, n - 1, `${t} home`);
      assert.equal(all.filter((m) => m.away === t).length, n - 1, `${t} away`);
      if (n % 2) assert.equal(weeks.filter((w) => w.bye === t).length, 2);
    }
    for (const w of weeks) {
      const ts = w.matches.flatMap((m) => [m.home, m.away]);
      assert.equal(new Set(ts).size, ts.length, 'max one match per team per week');
    }
    for (const a of ids) for (const b of ids) if (a !== b) assert.equal(all.filter((m) => m.home === a && m.away === b).length, 1);
  }
});

test('schedule: 1, 3 and 4 legs (every pair meets that many times, ids unique)', () => {
  for (const legs of [1, 3, 4, 8]) for (let n = 2; n <= 7; n++) {
    const ids = Array.from({ length: n }, (_, i) => `t${i}`);
    const weeks = buildSchedule(ids, legs);
    const all = weeks.flatMap((w) => w.matches);
    assert.equal(weeks.length, weeksFor(n, legs), `n=${n} legs=${legs}`);
    assert.equal(all.length, legs * n * (n - 1) / 2);
    assert.equal(new Set(all.map((m) => m.id)).size, all.length);
    for (const a of ids) for (const b of ids) if (a < b) assert.equal(all.filter((m) => (m.home === a && m.away === b) || (m.home === b && m.away === a)).length, legs);
    for (const t of ids) {
      const home = all.filter((m) => m.home === t).length, away = all.filter((m) => m.away === t).length;
      assert.ok(Math.abs(home - away) <= (legs % 2 ? 1 : 0), `n=${n} legs=${legs} ${t} ${home}/${away}`);
    }
    for (const w of weeks) { const ts = w.matches.flatMap((m) => [m.home, m.away]); assert.equal(new Set(ts).size, ts.length); }
  }
});

test('room league format: chosen legs decide the season length', async () => {
  const ctx = await makeRoom(3);
  await ctx.admin.updateSettings(ctx.code, { legs: 1 });
  let room = await ctx.read();
  assert.equal(room.public.legs, 1);
  room = await startLeague(ctx);
  assert.equal(room.season.legs, 1);
  assert.equal(weeksOf(room.season).length, 3);
  room = await playAll(ctx);
  assert.equal(room.season.finished, true);
  assert.equal(finishedMatches(room.season).length, 3);
});

test('league can only start after the draft and when everyone is ready', async () => {
  const ctx = await makeRoom(3);
  let room = await ctx.read();
  await ctx.admin.startDraft(ctx.code, room);
  room = await ctx.read();
  await assert.rejects(ctx.admin.startSeason(ctx.code, room), /Draft bitmeden/);
  const { draftAll } = await import('./helpers.js');
  room = await draftAll(ctx);
  await assert.rejects(ctx.admin.startSeason(ctx.code, room), /hazır/);
});

test('full season: weekly results with scorers/assists, stats consistent, bonus only at the end', async () => {
  const ctx = await makeRoom(5);
  let room = await startLeague(ctx);
  assert.equal(room.public.status, 'season');
  // play half the season
  const total = weeksOf(room.season).length;
  for (let i = 0; i < total - 1; i++) { await ctx.admin.playWeek(ctx.code, room); room = await ctx.read(); }
  assert.ok(!room.season.finished);
  for (const r of standings(room)) assert.equal(r.bonus, 0);
  room = await playAll(ctx);
  assert.equal(room.public.status, 'finished');
  const ms = finishedMatches(room.season);
  assert.equal(ms.length, 5 * 4);
  const stats = seasonStats(room);
  let goals = 0, assists = 0;
  for (const m of ms) {
    goals += m.homeGoals + m.awayGoals;
    assert.equal(toArray(m.goals).length, m.homeGoals + m.awayGoals, 'every goal has a scorer');
    for (const g of toArray(m.goals)) assert.ok(byId[g.playerId], 'scorer is a real player');
    assists += toArray(m.goals).filter((g) => g.assistId).length;
  }
  assert.equal(Object.values(stats).reduce((a, s) => a + s.goals, 0), goals);
  assert.equal(Object.values(stats).reduce((a, s) => a + s.assists, 0), assists);
  const aw = room.season.awards;
  const maxG = Math.max(...Object.values(stats).map((s) => s.goals));
  assert.equal(stats[aw.topScorer.pid].goals, maxG);
  const exp = {};
  for (const s of Object.keys(room.members)) exp[s] = 0;
  exp[aw.topScorer.seat] += BONUS.topScorer;
  exp[aw.topAssist.seat] += BONUS.topAssist;
  for (const r of standings(room)) { assert.equal(r.bonus, exp[r.seat]); assert.equal(r.total, r.points + exp[r.seat]); }
  assert.equal(room.season.champion, standings(room)[0].seat);
  assert.equal(toArray(aw.karma).length, 11, 'sezonun karması 11 kişi');
  assert.deepEqual(toArray(aw.karma).map((k) => k.slot), ['KL', 'SĞB', 'STP', 'STP', 'SLB', 'DOS', 'MO', 'OOS', 'SĞK', 'FV', 'SLK']);
});

test('replay from the stored log reproduces the stored result', async () => {
  const ctx = await makeRoom(4);
  let room = await startLeague(ctx);
  await ctx.admin.playWeek(ctx.code, room);
  room = await ctx.read();
  const { replayFromLog } = await import('../src/core/season.js');
  for (const id of Object.keys(room.season.matches)) {
    const log = await ctx.admin.getLog(ctx.code, id);
    assert.equal(fingerprint(replayFromLog(log)), room.season.matches[id].fp);
  }
});

test('discipline: yellow accumulation and red cards create bans that are served', () => {
  // synthetic room: 2 teams, results with cards
  const p = POOL.filter((x) => x.pos !== 'GK').slice(0, 2);
  let room = {
    members: { a: { name: 'A' }, b: { name: 'B' } },
    draft: { firstRound: ['a', 'b'], picks: [{ seat: 'a', pid: p[0].id }, { seat: 'b', pid: p[1].id }] },
    season: { schedule: buildSchedule(['a', 'b']).concat(buildSchedule(['a', 'b']).map((w) => ({ ...w, week: w.week + 2, matches: w.matches.map((m) => ({ ...m, id: m.id + 'x' })) }))), matches: {} },
  };
  const weeks = weeksOf(room.season);
  const card = (week, pid, k) => {
    const m = weeks[week - 1].matches[0];
    room.season.matches[m.id] = { id: m.id, week, home: m.home, away: m.away, homeGoals: 0, awayGoals: 0, players: { [pid]: { played: true, minutes: 90, endCondition: 80, yellow: k === 'y' ? 1 : 0, red: k === 'r' ? 1 : 0, secondYellow: 0 } } };
  };
  for (let w = 1; w <= DISCIPLINE.yellowsForBan; w++) card(w, p[0].id, 'y');
  const st = playerStateBefore(room, DISCIPLINE.yellowsForBan + 1);
  assert.equal(st[p[0].id].banned, DISCIPLINE.yellowBan, '3 sarı = 1 maç ceza');
  assert.equal(st[p[0].id].totalYellow, 3);
  const room2 = JSON.parse(JSON.stringify(room)); room2.season.matches = {};
  room = room2; card(1, p[1].id, 'r');
  assert.equal(playerStateBefore(room, 2)[p[1].id].banned, DISCIPLINE.redBan, 'kırmızı = 2 maç');
});

test('suspended or injured players are replaced automatically and never play', async () => {
  const ctx = await makeRoom(4);
  let room = await startLeague(ctx);
  const total = weeksOf(room.season).length;
  for (let w = 1; w <= total; w++) {
    const before = playerStateBefore(room, room.season.currentWeek);
    const week = room.season.currentWeek;
    await ctx.admin.playWeek(ctx.code, room);
    room = await ctx.read();
    for (const m of finishedMatches(room.season).filter((x) => x.week === week)) {
      for (const [pid, x] of Object.entries(m.players)) {
        if (!x.played) continue;
        assert.ok(!(before[pid].banned > 0), 'cezalı oyuncu oynamamalı');
        assert.ok(!(before[pid].injuredWeeks > 0), 'sakat oyuncu oynamamalı');
      }
    }
    if (room.season.finished) break;
  }
});

test('new season with the same squads, and a fresh redraft', async () => {
  const ctx = await makeRoom(3);
  await startLeague(ctx);
  let room = await playAll(ctx);
  await ctx.admin.newSeason(ctx.code, room);
  room = await ctx.read();
  assert.equal(room.public.status, 'season');
  assert.equal(Object.keys(room.history).length, 1);
  assert.equal(toArray(room.history[1].table).length, 3);
  assert.equal(Object.keys(room.season.matches || {}).length, 0);
  room = await playAll(ctx);
  await ctx.admin.redraft(ctx.code, room);
  room = await ctx.read();
  assert.equal(room.public.status, 'lobby');
  assert.ok(!room.draft && !room.season && !room.tactics);
  assert.equal(Object.keys(room.history).length, 2);
});

test('tactics with position variants, roles and a substitution plan are saved and used', async () => {
  const ctx = await makeRoom(2);
  let room = await draftAll(ctx);
  const seat = Object.keys(room.members)[0];
  const api = ctx.apis[room.members[seat].uid];
  const sq = squads(room.draft)[seat];
  const { autoLineup } = await import('../src/core/lineup.js');
  const lineup = autoLineup({ squad: sq, formation: '4-3-3', byId, state: {}, levelOf: api.levelOf }).lineup;
  await api.saveTactics(ctx.code, room, seat, {
    formation: '4-3-3', lineup, instructions: { style: 'direct' },
    slotCodes: { 5: 'CDM', 9: 'CF', 1: 'CB' }, // CB is not a valid variant for LB -> dropped
    roles: { 9: 'f9', 6: 'anchor', 0: 'notarole' },
    subPlan: { threshold: 55, fromMinute: 65, exceptions: [{ pid: lineup[9], threshold: 0, fromMinute: 90 }] },
  });
  room = await ctx.read();
  const t = room.tactics[seat];
  assert.deepEqual(t.slotCodes, { 5: 'CDM', 9: 'CF' });
  assert.deepEqual(t.roles, { 6: 'anchor', 9: 'f9' });
  assert.equal(t.subPlan.threshold, 55);
  const { tacticSlots } = await import('../src/core/season.js');
  const slots = tacticSlots(t);
  assert.equal(slots[9].code, 'CF'); assert.equal(slots[9].role, 'f9'); assert.equal(slots[5].code, 'CDM');
});
