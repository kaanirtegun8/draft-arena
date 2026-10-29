import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, startLeague, playAll, byId } from './helpers.js';
import { finishedMatches } from '../src/core/season.js';
import { matchReport, seasonReport } from '../src/core/report.js';

test('every match gets a readable post-match report and the season gets an analysis', async () => {
  const ctx = await makeRoom(4);
  await startLeague(ctx);
  const room = await playAll(ctx);
  const ms = finishedMatches(room.season);
  for (const m of ms) {
    const names = { home: room.members[m.home].team, away: room.members[m.away].team };
    const r = matchReport(m, names, byId);
    assert.ok(r.sections.length >= 4, 'en az 4 bölüm');
    for (const s of r.sections) for (const it of s.items) assert.equal(typeof it, 'string');
    assert.ok(r.sections.some((s) => s.title === 'Pozisyonlar nereden geldi?'));
  }
  const sr = seasonReport(room, byId);
  assert.equal(sr.teams.length, 4);
  assert.ok(sr.lines.length >= 1);
  if (process.env.SHOW) {
    const m = ms[ms.length - 1];
    const r = matchReport(m, { home: room.members[m.home].team, away: room.members[m.away].team }, byId);
    for (const s of r.sections) { console.log('##', s.title); for (const it of s.items) console.log('-', it); }
    console.log('## SEZON'); for (const l of sr.lines) console.log(l);
  }
});
