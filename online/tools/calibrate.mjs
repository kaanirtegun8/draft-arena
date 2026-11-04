// Engine calibration: simulates whole seasons with auto-drafted squads.
// node tools/calibrate.mjs <seasons> <teams>
import { buildMarketModel } from '../src/core/abilities.js';
import { snakeOrder, suggestPick } from '../src/core/draft.js';
import { createSeason, weekUpdate, levelFn } from '../src/core/season.js';
const POOL_PATH = process.env.POOL || '../data/players.js';
const { PLAYERS } = await import(POOL_PATH);
const byId = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
const model = buildMarketModel(PLAYERS);
const N = +(process.argv[2] || 10), M = +(process.argv[3] || 6);
let goals = 0, n = 0, hw = 0, dr = 0, shots = 0, sot = 0, yel = 0, red = 0, inj = 0, subs = 0, corners = 0, pens = 0, penGoals = 0;
const endCond = {}; // age group -> [sum, count] of end-of-match condition for 90-minute players
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
  room.season = createSeason(seats, 'cal' + s);
  while (!room.season.finished) {
    const { updates, sim } = weekUpdate(room, byId, model);
    room.season.matches = { ...room.season.matches, ...sim.summaries };
    room.season.currentWeek = updates['season/currentWeek'];
    if (updates['season/finished']) { room.season.finished = true; room.season.awards = updates['season/awards']; }
    for (const [id, m] of Object.entries(sim.summaries)) {
      n++; goals += m.homeGoals + m.awayGoals;
      if (m.homeGoals > m.awayGoals) hw++; else if (m.homeGoals === m.awayGoals) dr++;
      for (const side of ['home', 'away']) { const t = m.teamStats[side]; shots += t.shots; sot += t.sot; yel += t.yellow; red += t.red; subs += t.subs; corners += t.corners; }
      inj += Object.values(m.players).filter((x) => x.injured).length;
      const ev = (sim.logs[id] && sim.logs[id].events) || [];
      pens += ev.filter((e) => e.type === 'penalty').length;
      penGoals += ev.filter((e) => e.type === 'goal' && e.penalty).length;
      for (const [pid, x] of Object.entries(m.players)) {
        if (!x.played || x.minutes < 88 || byId[pid].pos === 'GK') continue;
        const a = byId[pid].age, g = a <= 24 ? '<=24' : a <= 28 ? '25-28' : a <= 31 ? '29-31' : a <= 33 ? '32-33' : '34+';
        const e = endCond[g] || (endCond[g] = [0, 0]); e[0] += x.endCondition; e[1] += 1;
      }
    }
  }
}
const f = (x) => (x / n).toFixed(2);
const ec = Object.fromEntries(Object.entries(endCond).sort().map(([k, [s, c]]) => [k, Math.round(s / c)]));
console.log({ matches: n, goals: f(goals), homeWin: f(hw), draw: f(dr), shotsTeam: (shots / n / 2).toFixed(1), sotTeam: (sot / n / 2).toFixed(1), yellow: f(yel), red: f(red), penalties: f(pens), penGoals: f(penGoals), injuries: f(inj), subsTeam: (subs / n / 2).toFixed(1), cornersTeam: (corners / n / 2).toFixed(1), ms: Date.now() - t0 });
console.log('end-of-match condition (90 min players) by age:', ec);
