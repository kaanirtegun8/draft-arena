// Engine calibration: simulates whole seasons with auto-drafted squads.
// ROLES=best gives every slot its best-fitting role (how most managers play), default none.
import { simulateMatch } from '../src/core/engine.js';
import { buildMarketModel, abilities } from '../src/core/abilities.js';
import { formationSlots } from '../src/core/positions.js';
import { rolesFor, roleFit } from '../src/core/roles.js';
import { autoLineup } from '../src/core/lineup.js';
import { snakeOrder, suggestPick, squads } from '../src/core/draft.js';
import { createSeason, weekUpdate, levelFn } from '../src/core/season.js';
import { createRng } from '../src/core/rng.js';
const POOL_PATH = process.env.POOL || '../data/players.js';
const { PLAYERS } = await import(POOL_PATH);
const byId = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
const model = buildMarketModel(PLAYERS);
const N = +(process.argv[2] || 10), M = +(process.argv[3] || 6);
let goals = 0, n = 0, hw = 0, dr = 0, shots = 0, sot = 0, yel = 0, red = 0, inj = 0, subs = 0, corners = 0;
const t0 = Date.now();
for (let s = 0; s < N; s++) {
  const seats = Array.from({ length: M }, (_, i) => `s${i}`);
  const room = { public: { squadSize: 18 }, members: Object.fromEntries(seats.map((x) => [x, { name: x }])), draft: { firstRound: seats, order: snakeOrder(seats, 18), current: 0, picks: [], taken: {} } };
  room.draft.total = room.draft.order.length;
  const lv = levelFn(model);
  while (room.draft.current < room.draft.total) {
    const seat = room.draft.order[room.draft.current];
    const pid = suggestPick(room.draft, seat, 18, PLAYERS, lv, byId);
    room.draft.picks.push({ seat, pid }); room.draft.taken[pid] = seat; room.draft.current++;
  }
  if (process.env.ROLES === 'best') {
    room.tactics = {};
    for (const seat of seats) {
      const sq = room.draft.picks.filter((p) => p.seat === seat).map((p) => p.pid);
      const { lineup } = autoLineup({ squad: sq, formation: '4-3-3', byId, levelOf: lv });
      const roles = {};
      formationSlots('4-3-3').forEach((sl, i) => { const ab = abilities(byId[lineup[i]]); const best = rolesFor(sl.code).slice().sort((a, b) => roleFit(b, ab) - roleFit(a, ab))[0]; if (best) roles[i] = best; });
      room.tactics[seat] = { formation: '4-3-3', roles, lineup };
    }
  }
  room.season = createSeason(seats, 'cal' + s);
  while (!room.season.finished) {
    const { updates, sim } = weekUpdate(room, byId, model);
    room.season.matches = { ...room.season.matches, ...sim.summaries };
    room.season.currentWeek = updates['season/currentWeek'];
    if (updates['season/finished']) { room.season.finished = true; room.season.awards = updates['season/awards']; }
    for (const m of Object.values(sim.summaries)) {
      n++; goals += m.homeGoals + m.awayGoals;
      if (m.homeGoals > m.awayGoals) hw++; else if (m.homeGoals === m.awayGoals) dr++;
      for (const side of ['home', 'away']) { const t = m.teamStats[side]; shots += t.shots; sot += t.sot; yel += t.yellow; red += t.red; subs += t.subs; corners += t.corners; }
      inj += Object.values(m.players).filter((x) => x.injured).length;
    }
  }
}
const f = (x) => (x / n).toFixed(2);
console.log({ matches: n, goals: f(goals), homeWin: f(hw), draw: f(dr), shotsTeam: (shots / n / 2).toFixed(1), sotTeam: (sot / n / 2).toFixed(1), yellow: f(yel), red: f(red), injuries: f(inj), subsTeam: (subs / n / 2).toFixed(1), cornersTeam: (corners / n / 2).toFixed(1), ms: Date.now() - t0 });
