import test from 'node:test';
import assert from 'node:assert/strict';
import { POOL, byId } from './helpers.js';
import { teamChemistry, chemMultiplier, CHEM_NEUTRAL } from '../src/core/chemistry.js';
import { tacticSlots } from '../src/core/season.js';
import { autoLineup } from '../src/core/lineup.js';
import { simulateMatch } from '../src/core/engine.js';

const slots = tacticSlots({ formation: '4-3-3' });
const xiOf = (ids) => autoLineup({ squad: ids, formation: '4-3-3', byId, levelOf: (p) => p.ovr, slots }).lineup.map((pid, i) => ({ slot: slots[i], player: byId[pid] }));

test('chemistry: a club-heavy XI gels better than a random one and plays better', () => {
  const clubs = {};
  for (const p of POOL) (clubs[p.club] = clubs[p.club] || []).push(p.id);
  const [club, ids] = Object.entries(clubs).sort((a, b) => b[1].length - a[1].length)[0];
  const rest = POOL.filter((p) => p.club !== club).map((p) => p.id);
  const stacked = teamChemistry(xiOf([...ids, ...rest.slice(0, 30)]));
  const mixed = teamChemistry(xiOf(rest.filter((_, i) => i % 7 === 0).slice(0, 25)));
  assert.ok(stacked.team > mixed.team + 20, `${club}: ${stacked.team} vs ${mixed.team}`);
  assert.ok(stacked.players.every((x) => x.chem >= 0 && x.chem <= 3));
  assert.ok(chemMultiplier(100) > 1.07 && chemMultiplier(CHEM_NEUTRAL) === 1 && chemMultiplier(0) < 0.95);
  assert.ok(stacked.links.some((l) => l.why.includes('club')));
});

test('chemistry is part of the match analysis and report', () => {
  const ids = POOL.slice(0, 18).map((p) => p.id);
  const mk = (name, sq) => { const xi = xiOf(sq); const players = {}; for (const x of xi) players[x.player.id] = { ...x.player, level: x.player.ovr, condition: 100 }; return { id: name, name, formation: '4-3-3', slots, instructions: {}, lineup: xi.map((x) => x.player.id), bench: [], players }; };
  const r = simulateMatch({ seed: 'c', matchId: 'm', home: mk('A', ids), away: mk('B', POOL.slice(18, 36).map((p) => p.id)) });
  assert.equal(typeof r.report.home.units.chem, 'number');
});
