import { PLAYERS } from '../src/data/players.js';
import { createLeague, indexPlayers, autoDraftAll, playRemaining } from '../src/core/league.js';
import { standings, seasonPlayerStats } from '../src/core/stats.js';
const byId = indexPlayers(PLAYERS);
const N = +process.argv[2] || 20;
let goals = 0, matches = 0, hw = 0, dr = 0, shots = 0, sot = 0, yel = 0, red = 0, inj = 0, subs = 0, draws00 = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const st = createLeague({ seed: 'cal' + i, managers: Array.from({ length: 5 }, (_, k) => ({ name: 'M' + k, isHuman: false })) });
  autoDraftAll(st, byId, PLAYERS);
  playRemaining(st, byId);
  for (const m of Object.values(st.matches)) {
    const r = m.result; matches++;
    goals += r.homeGoals + r.awayGoals;
    if (r.homeGoals > r.awayGoals) hw++; else if (r.homeGoals === r.awayGoals) dr++;
    if (r.homeGoals + r.awayGoals === 0) draws00++;
    for (const s of ['home', 'away']) { shots += r.teamStats[s].shots; sot += r.teamStats[s].shotsOnTarget; yel += r.teamStats[s].yellow; red += r.teamStats[s].red; subs += r.teamStats[s].subs; }
    inj += Object.values(r.playerStats).filter((x) => x.injured).length;
  }
  if (i === 0) { console.log(standings(st).map(r => `${r.name} ${r.total}`).join(' | ')); const ps = seasonPlayerStats(st); const top = Object.entries(ps).sort((a,b)=>b[1].goals-a[1].goals).slice(0,3).map(([id,s])=>byId[id].name+' '+s.goals); console.log(top, st.awards.bonuses); }
}
const f = (x) => (x / matches).toFixed(2);
console.log({ matches, goalsPerMatch: f(goals), homeWin: f(hw), draw: f(dr), nil: f(draws00), shotsPerTeam: (shots / matches / 2).toFixed(1), sotPerTeam: (sot / matches / 2).toFixed(1), yellow: f(yel), red: f(red), injuries: f(inj), subsPerTeam: (subs / matches / 2).toFixed(1), ms: Date.now() - t0 });
