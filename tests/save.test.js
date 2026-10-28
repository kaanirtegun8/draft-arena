import test from 'node:test';
import assert from 'node:assert/strict';
import { draftedLeague, byId, clone } from './helpers.js';
import { playRemaining } from '../src/core/league.js';
import { serialize, deserialize, memoryStorage, saveToSlot, loadFromSlot, slotInfo } from '../src/core/save.js';
import { standings, seasonPlayerStats } from '../src/core/stats.js';

test('save/load keeps every piece of data mid-season', () => {
  const s = draftedLeague('save');
  playRemaining(s, byId, 4);
  const store = memoryStorage();
  saveToSlot(store, '1', s);
  const loaded = loadFromSlot(store, '1');
  assert.deepEqual(loaded, s);
  assert.deepEqual(standings(loaded), standings(s));
  assert.deepEqual(seasonPlayerStats(loaded), seasonPlayerStats(s));
  assert.equal(slotInfo(store, '1').week, 5);
});

test('continuing after a load gives exactly the same season', () => {
  const a = draftedLeague('cont');
  playRemaining(a, byId, 3);
  const b = deserialize(serialize(a));
  playRemaining(a, byId);
  playRemaining(b, byId);
  const strip = (s) => { const c = clone(s); for (const m of Object.values(c.matches)) delete m.playedAt; c.log.forEach((l) => delete l.at); return c; };
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(standings(a), standings(b));
});

test('finished season keeps awards and bonuses after reload', () => {
  const s = draftedLeague('fin');
  playRemaining(s, byId);
  const l = deserialize(serialize(s));
  assert.equal(l.phase, 'finished');
  assert.deepEqual(l.awards, s.awards);
  assert.deepEqual(standings(l), standings(s));
});

test('invalid saves are rejected with a message', () => {
  assert.throws(() => deserialize('not json'), /okunamadı/);
  assert.throws(() => deserialize(JSON.stringify({ format: 'x' })), /Draft Arena/);
  assert.throws(() => deserialize(JSON.stringify({ format: 'draft-arena-save', version: 1, state: { seed: 1 } })), /eksik/);
});
