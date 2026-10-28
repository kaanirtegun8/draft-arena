import test from 'node:test';
import assert from 'node:assert/strict';
import { newLeague, draftedLeague, byId, pool } from './helpers.js';
import { POSITION_QUOTAS, SQUAD_SIZE } from '../src/core/config.js';
import { makePick, currentPickSlot, runCpuPicks, suggestPick } from '../src/core/league.js';
import { squadGroupCounts, snakeOrder } from '../src/core/draft.js';
import { groupOf } from '../src/core/players.js';
import { PLAYER_DATA_META } from '../src/data/players.js';

test('player pool is valid and big enough for every quota', () => {
  assert.ok(pool.length >= 90);
  assert.equal(new Set(pool.map((p) => p.id)).size, pool.length);
  const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of pool) c[groupOf(p)]++;
  for (const g of Object.keys(POSITION_QUOTAS)) assert.ok(c[g] >= POSITION_QUOTAS[g] * 5, `${g} havuzu yetersiz`);
  for (const p of pool) {
    const keys = p.pos === 'GK' ? ['div', 'han', 'kic', 'ref', 'spd', 'gkp'] : ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
    for (const k of ['ovr', ...keys]) assert.ok(Number.isInteger(p[k]) && p[k] >= 1 && p[k] <= 99, `${p.name} ${k}`);
  }
  assert.ok(PLAYER_DATA_META.version);
});

test('quotas add up to the squad size', () => {
  assert.equal(Object.values(POSITION_QUOTAS).reduce((a, b) => a + b, 0), SQUAD_SIZE);
});

test('5 managers each draft 18 different players (90 unique)', () => {
  for (const seed of ['a', 'b', 'c']) {
    const s = draftedLeague(seed);
    assert.equal(s.phase, 'season');
    const all = [];
    for (const m of s.managers) {
      assert.equal(m.squad.length, 18);
      assert.equal(new Set(m.squad).size, 18);
      all.push(...m.squad);
    }
    assert.equal(all.length, 90);
    assert.equal(new Set(all).size, 90);
    assert.equal(s.draft.picks.length, 90);
  }
});

test('draft order is fair: snake order, one pick per round, equal pick-number sums', () => {
  const s = newLeague('fair');
  const order = s.draft.order;
  assert.equal(order.length, 90);
  const sums = {};
  for (let r = 1; r <= 18; r++) {
    const row = order.filter((o) => o.round === r);
    assert.equal(row.length, 5);
    assert.equal(new Set(row.map((o) => o.managerId)).size, 5);
    const ids = row.map((o) => o.managerId);
    const expected = r % 2 ? s.draft.firstRoundOrder : s.draft.firstRoundOrder.slice().reverse();
    assert.deepEqual(ids, expected);
  }
  for (const o of order) sums[o.managerId] = (sums[o.managerId] || 0) + o.pick;
  assert.equal(new Set(Object.values(sums)).size, 1, 'pick toplamları eşit olmalı');
  assert.deepEqual(new Set(s.draft.firstRoundOrder), new Set(s.managers.map((m) => m.id)));
  // first-round order is seeded and changes with the seed
  const orders = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((x) => newLeague(x).draft.firstRoundOrder.join()));
  assert.ok(orders.size > 1);
  assert.equal(snakeOrder(['x', 'y'], 2).map((p) => p.managerId).join(), 'x,y,y,x');
});

test('position quotas are respected for every squad', () => {
  const s = draftedLeague('quota');
  for (const m of s.managers) assert.deepEqual(squadGroupCounts(m.squad, byId), POSITION_QUOTAS);
});

test('illegal picks are rejected', () => {
  const s = newLeague('illegal', [0, 1, 2, 3, 4]);
  const slot = currentPickSlot(s);
  const other = s.managers.find((m) => m.id !== slot.managerId);
  assert.throws(() => makePick(s, other.id, pool[0].id, byId), /Sıra/);
  makePick(s, slot.managerId, pool[0].id, byId);
  const next = currentPickSlot(s);
  assert.throws(() => makePick(s, next.managerId, pool[0].id, byId), /zaten/);
  // fill the GK quota of one manager via forced sequence, then ensure a 3rd GK is refused
  const gks = pool.filter((p) => p.pos === 'GK');
  const s2 = newLeague('gk', [0, 1, 2, 3, 4]);
  const target = currentPickSlot(s2).managerId;
  let gi = 0;
  while (s2.managers.find((m) => m.id === target).squad.length < 2) {
    const cur = currentPickSlot(s2);
    if (cur.managerId === target) makePick(s2, cur.managerId, gks[gi++].id, byId);
    else makePick(s2, cur.managerId, suggestPick(s2, cur.managerId, byId, pool.filter((p) => p.pos !== 'GK')), byId);
  }
  while (currentPickSlot(s2).managerId !== target) {
    const cur = currentPickSlot(s2);
    makePick(s2, cur.managerId, suggestPick(s2, cur.managerId, byId, pool.filter((p) => p.pos !== 'GK')), byId);
  }
  const freeGk = gks.find((g) => !s2.draft.taken[g.id]);
  assert.throws(() => makePick(s2, target, freeGk.id, byId), /kontenjan/);
});

test('CPU picks stop when a human is on the clock', () => {
  const s = newLeague('human', [2]);
  runCpuPicks(s, byId, pool);
  const slot = currentPickSlot(s);
  assert.equal(slot.managerId, 'm3');
});
