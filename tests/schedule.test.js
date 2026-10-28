import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule } from '../src/core/schedule.js';
import { draftedLeague } from './helpers.js';

const teams = ['m1', 'm2', 'm3', 'm4', 'm5'];

function check(weeks, ids) {
  assert.equal(weeks.length, 10);
  const all = weeks.flatMap((w) => w.matches);
  assert.equal(all.length, 20, '20 maç');
  for (const w of weeks) {
    assert.equal(w.matches.length, 2);
    const inWeek = w.matches.flatMap((m) => [m.home, m.away]);
    assert.equal(new Set(inWeek).size, 4, 'bir takım haftada bir kez oynar');
    assert.ok(w.bye && !inWeek.includes(w.bye));
  }
  for (const t of ids) {
    const played = all.filter((m) => m.home === t || m.away === t);
    assert.equal(played.length, 8, `${t} 8 maç`);
    assert.equal(weeks.filter((w) => w.bye === t).length, 2, `${t} 2 BAY`);
    assert.equal(all.filter((m) => m.home === t).length, 4, `${t} 4 iç saha`);
    assert.equal(all.filter((m) => m.away === t).length, 4, `${t} 4 deplasman`);
    // one BAY in each half
    assert.equal(weeks.slice(0, 5).filter((w) => w.bye === t).length, 1);
  }
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    assert.equal(all.filter((m) => m.home === a && m.away === b).length, 1, `${a}-${b} bir kez iç sahada`);
  }
  assert.equal(new Set(all.map((m) => m.id)).size, 20);
}

test('double round robin: 20 matches, 8 per team, 2 byes, home/away balance', () => {
  check(buildSchedule(teams), teams);
  check(buildSchedule(['m3', 'm1', 'm5', 'm2', 'm4']), teams);
});

test('league uses a valid schedule after the draft', () => {
  const s = draftedLeague('sched');
  check(s.schedule, s.managers.map((m) => m.id));
  assert.equal(Object.keys(s.matches).length, 20);
});
