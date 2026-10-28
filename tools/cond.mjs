import { PLAYERS } from '../src/data/players.js';
import { createLeague, indexPlayers, autoDraftAll, playRemaining } from '../src/core/league.js';
import { seasonPlayerStats } from '../src/core/stats.js';
const byId = indexPlayers(PLAYERS);
const st = createLeague({ seed: 'rot', managers: Array.from({ length: 5 }, (_, k) => ({ name: 'M' + k })) });
autoDraftAll(st, byId, PLAYERS);
for (let w = 1; w <= 10; w++) {
  playRemaining(st, byId, w);
  const m = st.managers[0];
  const c = m.squad.map((p) => st.playerState[p].condition);
  console.log('w', w, 'bye', st.schedule[w-1].bye, 'avg', (c.reduce((a,b)=>a+b,0)/c.length).toFixed(1), 'min', Math.min(...c), 'inj', Object.values(st.playerState).filter(x=>x.injuredWeeks>0).length);
}
const s = seasonPlayerStats(st);
console.log(st.managers[0].squad.map((p) => `${byId[p].name.split(' ').pop()}:${s[p].starts}/${s[p].apps}`).join(' '));
