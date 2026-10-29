// Stress test: many 4-team leagues with random squads and random tactics.
// Reports crashes, broken invariants and tactical features that over/under-perform
// once squad strength is accounted for.
import { PLAYERS } from '../data/players.js';
import { buildMarketModel } from '../src/core/abilities.js';
import { snakeOrder, squads } from '../src/core/draft.js';
import { createSeason, weekUpdate, levelFn, finishedMatches } from '../src/core/season.js';
import { createRng } from '../src/core/rng.js';
import { FORMATIONS, formationSlots, SLOT_VARIANTS, roleOf } from '../src/core/positions.js';
import { INSTRUCTIONS } from '../src/core/tactics.js';
import { rolesFor } from '../src/core/roles.js';
import { autoLineup } from '../src/core/lineup.js';
import { tacticSlots } from '../src/core/season.js';

const byId = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
const model = buildMarketModel(PLAYERS);
const lv = levelFn(model);
const LEAGUES = +(process.argv[2] || 25), TEAMS = +(process.argv[3] || 4), SEED = process.argv[4] || 'stress';
const problems = [];
const feat = {}; // feature -> { n, resid }
const record = (k, resid) => { const f = feat[k] || (feat[k] = { n: 0, resid: 0, pts: 0 }); f.n++; f.resid += resid; };
let matches = 0, goals = 0, maxGoals = 0, possClampHits = 0;
const big = [];

for (let L = 0; L < LEAGUES; L++) {
  const rng = createRng(`${SEED}|${L}`);
  const seats = Array.from({ length: TEAMS }, (_, i) => `t${i}`);
  // random draft: each pick = one of the top-6 legal options (adds variety in squad strength)
  const room = { public: { squadSize: 18 }, members: Object.fromEntries(seats.map((s) => [s, { name: s, team: s }])), draft: { firstRound: rng.shuffle(seats), current: 0, picks: [], taken: {} } };
  room.draft.order = snakeOrder(room.draft.firstRound, 18); room.draft.total = room.draft.order.length;
  const { quotaError } = await import('../src/core/positions.js');
  while (room.draft.current < room.draft.total) {
    const seat = room.draft.order[room.draft.current];
    const sq = squads(room.draft)[seat] || [];
    const legal = PLAYERS.filter((p) => !room.draft.taken[p.id] && !quotaError(sq, p, 18, byId)).sort((a, b) => lv(b) - lv(a));
    const pick = legal[Math.min(legal.length - 1, Math.floor(rng.next() ** 2 * 8))];
    room.draft.picks.push({ seat, pid: pick.id }); room.draft.taken[pick.id] = seat; room.draft.current++;
  }
  // random tactics
  room.tactics = {};
  const sqs = squads(room.draft);
  for (const s of seats) {
    const formation = rng.pick(Object.keys(FORMATIONS));
    const instructions = {};
    for (const [k, d] of Object.entries(INSTRUCTIONS)) instructions[k] = process.env.NOINS ? d.def : rng.pick(Object.keys(d.options));
    const slotCodes = {}, roles = {};
    formationSlots(formation).forEach((sl, i) => {
      if (!process.env.NOVAR && rng.chance(0.3)) slotCodes[i] = rng.pick(SLOT_VARIANTS[sl.code] || [sl.code]);
      const code = slotCodes[i] || sl.code;
      if (!process.env.NOROLES && rng.chance(0.6)) roles[i] = rng.pick(rolesFor(code));
    });
    const tac = { formation, instructions, slotCodes, roles, subPlan: { threshold: rng.int(50, 72), fromMinute: rng.int(55, 75), exceptions: [] }, autoManage: true };
    const slots = tacticSlots(tac);
    tac.lineup = autoLineup({ squad: sqs[s], formation, byId, state: {}, levelOf: lv, slots }).lineup;
    room.tactics[s] = tac;
  }
  room.season = createSeason(seats, `${SEED}-${L}`);
  try {
    while (!room.season.finished) {
      const { updates, sim } = weekUpdate(room, byId, model);
      room.season.matches = { ...room.season.matches, ...sim.summaries };
      room.season.currentWeek = updates['season/currentWeek'];
      if (updates['season/finished']) { room.season.finished = true; room.season.awards = updates['season/awards']; }
      for (const [id, m] of Object.entries(sim.summaries)) {
        const log = sim.logs[id];
        matches++; const g = m.homeGoals + m.awayGoals; goals += g; maxGoals = Math.max(maxGoals, g);
        if (g >= 9) big.push({ g, score: `${m.homeGoals}-${m.awayGoals}`, h: log.input.home, a: log.input.away, rep: m.report, red: m.teamStats.home.red + m.teamStats.away.red });
        const ts = m.teamStats;
        if (ts.home.possession <= 30 || ts.home.possession >= 70) possClampHits++;
        // invariants
        if (!Number.isFinite(ts.home.xg) || !Number.isFinite(ts.away.xg)) problems.push(`L${L} ${id}: xG NaN`);
        if (g > 10) problems.push(`L${L} ${id}: ${g} gol`);
        if (ts.home.subs > 5 || ts.away.subs > 5) problems.push(`L${L} ${id}: 5'ten fazla değişiklik`);
        for (const gl of m.goals) {
          const x = m.players[gl.playerId];
          if (!x || !x.played) problems.push(`L${L} ${id}: oynamayan oyuncu gol attı`);
          if (gl.assistId && gl.assistId === gl.playerId) problems.push(`L${L} ${id}: kendine asist`);
        }
        const onEnd = { home: 0, away: 0 };
        for (const e of log.events) if (e.type === 'red') onEnd[e.side]++;
        // strength-adjusted features
        const str = (side) => { const t = log.input[side]; return t.lineup.reduce((a, pid) => a + t.players[pid].level, 0) / 11; };
        const d = str('home') - str('away') + 0.6; // home advantage in level points
        const expH = 1 / (1 + Math.exp(-d / 2.2));
        const resH = (m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0) - expH;
        for (const [side, r] of [['home', resH], ['away', -resH]]) {
          const t = log.input[side];
          record(`diziliş ${t.formation}`, r);
          for (const [k, v] of Object.entries(t.instructions)) record(`${k}=${v}`, r);
          for (const sl of t.slots) { if (sl.role) record(`rol ${sl.role}`, r); if (sl.code !== 'GK') record(`mevki ${sl.code}`, r / 3); }
        }
      }
    }
  } catch (e) {
    problems.push(`L${L}: ÇÖKME ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
  }
}
console.log(`ligler ${LEAGUES} × ${TEAMS} takım, maç ${matches}, gol/maç ${(goals / matches).toFixed(2)}, en çok gol ${maxGoals}, topa sahip olma sınırına dayanan maç %${(possClampHits / matches * 100).toFixed(1)}`);
console.log('SORUNLAR', problems.length ? problems.slice(0, 20) : 'yok');
const dist = {}; for (const b of big) dist[b.g] = (dist[b.g] || 0) + 1; console.log('9+ gollü maçlar', big.length, JSON.stringify(dist));
if (process.env.BIG) for (const b of big.sort((x, y) => y.g - x.g).slice(0, 4)) {
  const desc = (t) => `${t.formation} ${JSON.stringify(t.instructions)} roles:${t.slots.filter((x) => x.role).map((x) => x.code + ':' + x.role).join(',')}`;
  console.log(b.score, 'kırmızı', b.red, '\n  H', desc(b.h), '\n   units', JSON.stringify(b.rep.home.units), '\n  A', desc(b.a), '\n   units', JSON.stringify(b.rep.away.units));
}
const rows = Object.entries(feat).filter(([, f]) => f.n >= 30).map(([k, f]) => ({ k, n: f.n, avg: f.resid / f.n, se: 0.45 / Math.sqrt(f.n) }));
rows.sort((a, b) => b.avg - a.avg);
const fmt = (r) => `${r.k.padEnd(28)} n=${String(r.n).padStart(4)}  beklenene göre ${(r.avg >= 0 ? '+' : '') + (r.avg * 100).toFixed(1)} puan%  ${Math.abs(r.avg) > 2.5 * r.se ? (r.avg > 0 ? '⚠ GÜÇLÜ' : '⚠ ZAYIF') : ''}`;
console.log('\nEN İYİ'); rows.slice(0, 12).forEach((r) => console.log(fmt(r)));
console.log('\nEN KÖTÜ'); rows.slice(-12).forEach((r) => console.log(fmt(r)));
