import { PLAYERS } from '../src/data/players.js';
import { createLeague, indexPlayers, autoDraftAll, playRemaining } from '../src/core/league.js';

export const pool = PLAYERS;
export const byId = indexPlayers(PLAYERS);

export function newLeague(seed = 'test-seed', humans = []) {
  return createLeague({
    name: 'Test Ligi', seed,
    managers: Array.from({ length: 5 }, (_, i) => ({ name: `Menajer ${i + 1}`, isHuman: humans.includes(i) })),
  });
}

export function draftedLeague(seed = 'test-seed', humans = []) {
  const s = newLeague(seed, humans);
  autoDraftAll(s, byId, pool);
  return s;
}

export function fullSeason(seed = 'test-seed') {
  const s = draftedLeague(seed);
  playRemaining(s, byId);
  return s;
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
