import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, draftAll, POOL, byId } from './helpers.js';
import { snakeOrder, squads, toArray, pickError } from '../src/core/draft.js';
import { roleCounts, ROLE_MIN, ROLE_MAX, quotaError, ROLES, roleOf } from '../src/core/positions.js';
import { poolCheck } from '../src/backend/api.js';

test('snake order is fair for any number of managers (even squad size => equal pick sums)', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const seats = Array.from({ length: n }, (_, i) => `s${i}`);
    for (const size of [16, 18, 20]) {
      const order = snakeOrder(seats, size);
      assert.equal(order.length, n * size);
      const sums = {};
      order.forEach((s, i) => { sums[s] = (sums[s] || 0) + i + 1; });
      assert.equal(new Set(Object.values(sums)).size, 1, `n=${n} size=${size}`);
      for (let r = 0; r < size; r++) assert.equal(new Set(order.slice(r * n, r * n + n)).size, n, 'everyone once per round');
    }
  }
});

test('draft with the real API: everyone gets a full, legal, unique squad', async () => {
  const n = POOL.length >= 250 ? 8 : 4;
  const ctx = await makeRoom(n, { squadSize: 16 });
  const room = await draftAll(ctx);
  const sq = squads(room.draft);
  const all = [];
  assert.equal(Object.keys(sq).length, n);
  for (const ids of Object.values(sq)) {
    assert.equal(ids.length, 16);
    const c = roleCounts(ids, byId);
    for (const r of ROLES) {
      assert.ok(c[r] >= ROLE_MIN[r], `${r} min`);
      if (ROLE_MAX[r]) assert.ok(c[r] <= ROLE_MAX[r], `${r} max`);
    }
    all.push(...ids);
  }
  assert.equal(new Set(all).size, all.length, 'no duplicates');
  assert.equal(toArray(room.draft.picks).length, n * 16);
});

test('quota guard: a pick that makes the squad impossible to complete is rejected', () => {
  const gks = POOL.filter((p) => roleOf(p) === 'GK');
  const sts = POOL.filter((p) => roleOf(p) === 'ST');
  // 3 keepers is the max
  assert.match(quotaError(gks.slice(0, 3).map((p) => p.id), gks[3], 16, byId), /sınırı/);
  // 14 strikers in a 16 squad leaves no room for the minimums
  const many = sts.slice(0, 2).map((p) => p.id);
  const cms = POOL.filter((p) => roleOf(p) === 'CM').slice(0, 12).map((p) => p.id);
  const err = quotaError([...many, ...cms], sts[2], 16, byId);
  assert.match(err, /tamamlanamaz/);
});

test('turn order is enforced by the client API too', async () => {
  const ctx = await makeRoom(3, { squadSize: 16 });
  let room = await ctx.read();
  await ctx.admin.startDraft(ctx.code, room);
  room = await ctx.read();
  const onClockSeat = toArray(room.draft.order)[0];
  const other = Object.keys(room.members).find((s) => s !== onClockSeat);
  assert.match(pickError(room.draft, other, POOL[0].id, 16, byId), /Sıra/);
});

test('pool check warns when the pool cannot serve all managers', () => {
  assert.equal(poolCheck(POOL, 2, 16).length, 0);
  assert.ok(poolCheck(POOL, 30, 20).length > 0);
});
