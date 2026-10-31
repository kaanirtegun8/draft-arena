import test from 'node:test';
import assert from 'node:assert/strict';
import { POOL, byId, makeRoom, startLeague } from './helpers.js';
import { simulateMatch } from '../src/core/engine.js';
import { teamUnits, defaultInstructions } from '../src/core/tactics.js';
import { FORMATIONS, isGK } from '../src/core/positions.js';
import { tacticSlots, playerStateBefore } from '../src/core/season.js';
import { autoLineup } from '../src/core/lineup.js';
import { squads, toArray } from '../src/core/draft.js';

const lv = (p) => p.ovr;
const sorted = POOL.slice().sort((a, b) => b.ovr - a.ovr);
const squadA = sorted.filter((_, i) => i % 2 === 0).slice(0, 18).map((p) => p.id);
const squadB = sorted.filter((_, i) => i % 2 === 1).slice(0, 18).map((p) => p.id);

function snap(sq, tac, name) {
  const slots = tacticSlots(tac);
  const lineup = autoLineup({ squad: sq, formation: tac.formation, byId, levelOf: lv, slots }).lineup;
  const bench = sq.filter((id) => !lineup.includes(id)).slice(0, 7);
  const players = {};
  for (const id of [...lineup, ...bench]) players[id] = { ...byId[id], level: byId[id].ovr, condition: 100 };
  return { id: name, name, formation: tac.formation, slots, instructions: {}, lineup, bench, players, setPieces: tac.setPieces || {} };
}

test('chosen penalty, free-kick and corner takers take them; every shot can name its creator', () => {
  const base = snap(squadA, { formation: '4-3-3' }, 'A');
  const outfield = base.lineup.filter((id) => !isGK(byId[id]));
  const pick = { penalty: outfield[9], freekick: outfield[8], corner: outfield[7] };
  const home = { ...base, setPieces: pick };
  const away = snap(squadB, { formation: '4-3-3' }, 'B');
  let pens = 0, fks = 0, corners = 0, creators = 0;
  for (let k = 0; k < 60; k++) {
    const r = simulateMatch({ seed: 'sp' + k, matchId: 'm', home, away });
    for (const e of r.events) {
      if (e.side !== 'home') continue;
      // the chosen taker is on the pitch at kick-off; after a substitution someone else may take over
      const onPitch = !r.events.some((x) => x.type === 'sub' && x.out && x.minute <= e.minute && Object.values(pick).includes(x.out));
      if (e.type === 'penalty' && onPitch) { pens++; assert.equal(e.playerId, pick.penalty); }
      if (e.type === 'freekick' && onPitch) { fks++; assert.equal(e.playerId, pick.freekick); }
      if (e.type === 'corner' && onPitch) { corners++; assert.equal(e.playerId, pick.corner); }
      if (['goal', 'save', 'miss'].includes(e.type) && e.creatorId) creators++;
      if (e.type === 'goal' && e.creatorId) assert.equal(e.assistId, e.creatorId);
    }
    assert.ok(r.events[0].captains && r.events[0].captains.home, 'kick-off names the captains');
  }
  assert.ok(pens > 0 && fks > 0 && corners > 0 && creators > 0, `${pens} ${fks} ${corners} ${creators}`);
});

test('nudging a player moves his work into the neighbouring zone', () => {
  const tac = { formation: '4-3-3' };
  const sq = snap(squadA, tac, 'A');
  const view = (slots) => slots.map((s, i) => ({ slot: s, player: byId[sq.lineup[i]], level: byId[sq.lineup[i]].ovr, cond: 100, day: 1 }));
  const plain = teamUnits(view(tacticSlots(tac)), defaultInstructions());
  // move the left central midfielder (index 5) and the striker (index 9) to the left
  const moved = teamUnits(view(tacticSlots({ ...tac, shifts: { 5: -1, 9: -1 } })), defaultInstructions());
  assert.ok(moved.att.L > plain.att.L * 1.03, 'left attack grows');
  assert.ok(moved.att.C < plain.att.C, 'centre gets thinner');
  assert.ok(moved.def.L > plain.def.L, 'left defence grows');
  assert.equal(moved.shifts.length, 2);
});

test('every formation plays a full match', () => {
  for (const f of Object.keys(FORMATIONS)) {
    const r = simulateMatch({ seed: 'f', matchId: f, home: snap(squadA, { formation: f }, 'A'), away: snap(squadB, { formation: '4-3-3' }, 'B') });
    assert.ok(Number.isFinite(r.teamStats.home.xg) && r.homeGoals >= 0, f);
  }
  assert.ok(Object.keys(FORMATIONS).length >= 15);
});

test('a suspended player in the saved XI does not block other tactic changes', async () => {
  const ctx = await makeRoom(2);
  let room = await startLeague(ctx);
  const seat = Object.keys(room.members).find((s) => room.members[s].uid === 'u1');
  const sq = squads(room.draft)[seat];
  const tac = room.tactics && room.tactics[seat];
  const lineup = tac ? toArray(tac.lineup) : autoLineup({ squad: sq, formation: '4-3-3', byId, levelOf: lv }).lineup;
  // fake a red card for the first outfield starter in a finished week-1 match
  const banned = lineup.find((id) => !isGK(byId[id]));
  const fakeRoom = { ...room, season: { ...room.season, currentWeek: 2, matches: { w1m1: { id: 'w1m1', week: 1, home: seat, away: 'x', players: { [banned]: { side: 'home', played: true, minutes: 30, red: 1, yellow: 0 } }, homeGoals: 0, awayGoals: 0, goals: [], cards: [] } } } };
  const st = playerStateBefore(fakeRoom, 2);
  assert.ok(st[banned] && st[banned].banned > 0, 'player is suspended');
  await ctx.admin.saveTactics(ctx.code, fakeRoom, seat, { formation: '4-3-3', lineup, instructions: { ...defaultInstructions(), press: 'high' }, setPieces: { captain: banned, penalty: 'not-in-squad' }, shifts: { 5: -1, 0: 1, 3: 7 } });
  room = await ctx.read();
  assert.equal(room.tactics[seat].instructions.press, 'high');
  assert.equal(room.tactics[seat].setPieces.captain, banned);
  assert.equal(room.tactics[seat].setPieces.penalty, undefined, 'unknown players are dropped');
  assert.deepEqual(room.tactics[seat].shifts, { 5: -1 }, 'keeper and invalid nudges are dropped');
});
