import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, startLeague, byId } from './helpers.js';
import { windowOpen, windowWeek, currentSquads, CLASSIC_TRANSFER_MONEY } from '../src/core/transfers.js';
import { prepareWeek } from '../src/core/season.js';
import { roleOf, isGK } from '../src/core/positions.js';

test('mid-season transfer window: one deal per manager, players + money, squads update, window closes', async () => {
  const ctx = await makeRoom(3);
  await ctx.admin.updateSettings(ctx.code, { transferWindow: true });
  let room = await startLeague(ctx);
  const seats = Object.keys(room.members);
  const [a, b] = seats;
  const apiOf = (s) => ctx.apis[room.members[s].uid];
  assert.equal(windowWeek(room.season), 4, '6 weeks -> window before week 4');
  while (!windowOpen(room)) {
    await assert.rejects(apiOf(a).proposeTransfer(ctx.code, room, a, { to: b, give: [], want: [], money: 0 }), /kapalı/);
    await ctx.admin.playWeek(ctx.code, room);
    room = await ctx.read();
  }
  const sq = currentSquads(room, byId);
  // same position swap keeps both squads legal
  const giveP = sq[a].find((p) => roleOf(byId[p]) === 'CM');
  const wantP = sq[b].find((p) => roleOf(byId[p]) === 'CM');
  // illegal: giving away a keeper for a midfielder leaves a with one keeper
  const gk = sq[a].filter((p) => isGK(byId[p]));
  if (gk.length === 2) await assert.rejects(apiOf(a).proposeTransfer(ctx.code, room, a, { to: b, give: [gk[0]], want: [wantP], money: 0 }), /mevki/);
  await assert.rejects(apiOf(a).proposeTransfer(ctx.code, room, a, { to: b, give: [giveP], want: [wantP], money: CLASSIC_TRANSFER_MONEY + 1e6 }), /En fazla/);
  const id = await apiOf(a).proposeTransfer(ctx.code, room, a, { to: b, give: [giveP], want: [wantP], money: 20e6 });
  room = await ctx.read();
  await assert.rejects(apiOf(a).respondTransfer(ctx.code, room, a, id, true), /bulunamadı/, 'only the other side answers');
  await apiOf(b).respondTransfer(ctx.code, room, b, id, true);
  room = await ctx.read();
  const after = currentSquads(room, byId);
  assert.ok(after[a].includes(wantP) && !after[a].includes(giveP));
  assert.ok(after[b].includes(giveP) && !after[b].includes(wantP));
  assert.equal(ctx.admin.transferInfo(room, a).money, CLASSIC_TRANSFER_MONEY - 20e6);
  assert.equal(ctx.admin.transferInfo(room, b).money, CLASSIC_TRANSFER_MONEY + 20e6);
  assert.ok(ctx.admin.transferInfo(room, a).used);
  await assert.rejects(apiOf(a).proposeTransfer(ctx.code, room, a, { to: b, give: [wantP], want: [giveP], money: 0 }), /kullandın/);
  // the next match uses the new squads
  const { inputs } = prepareWeek(room, byId, ctx.admin.model);
  const mine = inputs.map((x) => x.input).flatMap((inp) => [inp.home, inp.away]).find((t) => t.id === a);
  if (mine) assert.ok(!Object.keys(mine.players).includes(giveP), 'a sold player does not play for his old team');
  // a pending offer dies when the window closes
  const c = seats[2];
  const sqc = currentSquads(room, byId);
  const id2 = await apiOf(c).proposeTransfer(ctx.code, room, c, { to: b, give: [sqc[c].find((p) => roleOf(byId[p]) === 'ST')], want: [sqc[b].find((p) => roleOf(byId[p]) === 'ST')], money: 0 });
  await ctx.admin.playWeek(ctx.code, room);
  room = await ctx.read();
  assert.ok(!windowOpen(room));
  await assert.rejects(apiOf(b).respondTransfer(ctx.code, room, b, id2, true), /kapandı/);
});

test('transfer window is off unless the admin switches it on', async () => {
  const ctx = await makeRoom(2);
  let room = await startLeague(ctx);
  while (!room.season.finished) {
    assert.ok(!windowOpen(room));
    await ctx.admin.playWeek(ctx.code, room);
    room = await ctx.read();
  }
});
