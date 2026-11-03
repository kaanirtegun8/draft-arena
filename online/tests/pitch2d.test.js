import test from 'node:test';
import assert from 'node:assert/strict';
import { tickItems, createDirector } from '../src/ui/pitch2d.js';

const EV = [
  { type: 'foul', side: 'home', minute: 10, playerId: 'a' },
  { type: 'yellow', side: 'home', minute: 10, playerId: 'a' },
  { type: 'freekick', side: 'away', minute: 10, playerId: 'b', foulerId: 'a' },
  { type: 'save', side: 'away', minute: 10, playerId: 'b', chance: 'freekick', xg: 0.05 },
  { type: 'miss', side: 'home', minute: 10, playerId: 'c', chance: 'long', xg: 0.03 },
  { type: 'sub', side: 'home', minute: 11, in: 'd', out: 'c' },
];
const EVT = [5, 5, 5, 5, 5, 6];
const kinds = (items) => items.map((x) => (x.raw ? x.raw.type : x.mo ? 'moment' : 'minor'));

test('2D view: the events of a tick in log order, the card after the free kick it belongs to', () => {
  const mo = { ei: 3, event: EV[3] };
  const items = tickItems(EV, EVT, 5, (k) => (k === 3 ? mo : null));
  assert.deepEqual(kinds(items), ['foul', 'freekick', 'yellow', 'moment', 'minor']);
  assert.equal(items[3].mo, mo);
  assert.deepEqual(kinds(tickItems(EV, EVT, 6, () => null)), ['sub']);
});

test('2D view director: one thing at a time, each waits for the one before', async () => {
  const calls = [];
  const pitch = {
    readyIn: () => 0,
    event: (e) => { calls.push(e.type); return e.type === 'freekick' ? 0.05 : 0; },
    minorShot: (e) => { calls.push(`minor:${e.type}`); return 0.02; },
    skip: () => {},
  };
  let resolve;
  const finished = new Promise((r) => { resolve = r; });
  const director = createDirector({
    pitch, speed: () => 1,
    moment: (mo, opts, done) => { calls.push(`moment:${mo.event.type}`); setTimeout(() => { calls.push('outcome'); done(0.03); }, 20); },
    onIdle: () => resolve(),
  });
  const mo = { ei: 3, event: EV[3] };
  director.push(tickItems(EV, EVT, 5, (k) => (k === 3 ? mo : null)));
  assert.ok(director.busy());
  await finished;
  assert.deepEqual(calls, ['foul', 'freekick', 'yellow', 'moment:save', 'outcome', 'minor:miss']);
  assert.equal(director.busy(), false);
  director.stop();
});
