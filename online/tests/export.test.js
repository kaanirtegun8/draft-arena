import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, startLeague, playAll, byId } from './helpers.js';
import { finishedMatches, weeksOf, standings } from '../src/core/season.js';
import { buildSeasonReport, reportDoc, reportFileName } from '../src/core/export.js';

const allText = (node) => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(allText).join(' ');
  if (typeof node === 'object') return ['text', 'stack', 'columns', 'table', 'body', 'content'].map((k) => allText(node[k])).join(' ');
  return '';
};

test('season report lists the table, awards and every match of a finished season', async () => {
  const ctx = await makeRoom(4);
  await startLeague(ctx);
  const room = await playAll(ctx);
  room.public.name = 'Çarşı Şampiyonlar Ligi';
  const data = buildSeasonReport(room, byId, { seasonNo: 3 });
  assert.equal(data.finished, true);
  assert.equal(data.table.length, 4);
  assert.deepEqual(data.table.map((r) => r.total), standings(room).map((r) => r.total));
  assert.equal(data.weeks.length, weeksOf(room.season).length);
  const ms = finishedMatches(room.season);
  assert.equal(data.matchesPlayed, ms.length);
  const listed = data.weeks.flatMap((w) => w.matches).filter((m) => m.played);
  assert.equal(listed.length, ms.length);
  const goals = ms.reduce((a, m) => a + m.homeGoals + m.awayGoals, 0);
  assert.equal(listed.reduce((a, m) => a + m.homeScorers.length + m.awayScorers.length, 0), goals, 'her gol listelenmeli');
  assert.ok(data.champion && data.champion.team);
  assert.ok(data.awards.some((a) => a.title === 'Gol kralı'));
  assert.equal(data.teams.length, 4);
  for (const t of data.teams) assert.equal(t.players.length, 16);
  const doc = reportDoc(data);
  const text = allText(doc.content);
  assert.ok(text.includes('Çarşı Şampiyonlar Ligi · 3. sezon'));
  assert.ok(text.includes('Tüm maçlar') && text.includes('Puan durumu'));
  assert.equal(reportFileName(data), 'carsi-sampiyonlar-ligi-sezon-3.pdf');
  assert.doesNotThrow(() => JSON.stringify(doc));
});

test('season report works in the middle of a season (no awards, open fixtures)', async () => {
  const ctx = await makeRoom(3);
  let room = await startLeague(ctx);
  await ctx.admin.playWeek(ctx.code, room);
  room = await ctx.read();
  const data = buildSeasonReport(room, byId, { seasonNo: 1 });
  assert.equal(data.finished, false);
  assert.equal(data.champion, null);
  assert.equal(data.awards.length, 0);
  assert.equal(data.weeksPlayed, 1);
  assert.ok(data.weeks.slice(1).flatMap((w) => w.matches).every((m) => !m.played));
  assert.ok(reportDoc(data).content.length > 5);
});
