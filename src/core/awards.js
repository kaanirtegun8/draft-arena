// End-of-season awards. Bonus points: top scorer +2, top assist +1 (to the owning manager).
import { AWARD_BONUS } from './config.js';
import { seasonPlayerStats } from './stats.js';
import { groupOf } from './players.js';

const MIN_MINUTES_POTS = 300;

function byKeys(...fns) {
  return (a, b) => { for (const f of fns) { const d = f(a, b); if (d) return d; } return 0; };
}

export function computeAwards(state, playerById) {
  const stats = seasonPlayerStats(state);
  const owner = {};
  for (const m of state.managers) for (const pid of m.squad) owner[pid] = m.id;
  const rows = Object.entries(stats).filter(([pid]) => owner[pid]).map(([pid, s]) => ({ pid, ...s, managerId: owner[pid], player: playerById[pid] }));
  const idCmp = (a, b) => (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);

  // Top scorer: goals, then fewer minutes, then assists, then id (deterministic)
  const scorers = rows.filter((r) => r.goals > 0).sort(byKeys((a, b) => b.goals - a.goals, (a, b) => a.minutes - b.minutes, (a, b) => b.assists - a.assists, idCmp));
  const assisters = rows.filter((r) => r.assists > 0).sort(byKeys((a, b) => b.assists - a.assists, (a, b) => a.minutes - b.minutes, (a, b) => b.goals - a.goals, idCmp));
  const keepers = rows.filter((r) => groupOf(r.player) === 'GK' && r.apps >= 3)
    .sort(byKeys((a, b) => b.avgRating - a.avgRating, (a, b) => b.cleanSheets - a.cleanSheets, (a, b) => a.conceded - b.conceded, idCmp));

  const perfIndex = (r) => r.avgRating + 0.12 * r.goals + 0.08 * r.assists + (groupOf(r.player) === 'GK' ? 0.08 * r.cleanSheets : 0) + 0.05 * r.motm;
  const qualified = rows.filter((r) => r.minutes >= MIN_MINUTES_POTS);
  const pots = qualified.slice().sort(byKeys((a, b) => perfIndex(b) - perfIndex(a), idCmp));

  // Team of the season, 4-3-3 by average rating (min 270 minutes)
  const tos = [];
  const pool = rows.filter((r) => r.minutes >= 270).sort(byKeys((a, b) => perfIndex(b) - perfIndex(a), idCmp));
  const need = { GK: 1, DEF: 4, MID: 3, FWD: 3 };
  for (const r of pool) {
    const g = groupOf(r.player);
    if (need[g] > 0) { need[g]--; tos.push({ pid: r.pid, group: g, managerId: r.managerId, avgRating: r.avgRating }); }
  }

  // Best draft pick: biggest gap between pick number and performance rank
  const pickNo = {};
  for (const p of state.draft.picks) pickNo[p.playerId] = p.pick;
  const ranked = qualified.slice().sort(byKeys((a, b) => perfIndex(b) - perfIndex(a), idCmp));
  let bestPick = null;
  ranked.forEach((r, i) => {
    const steal = (pickNo[r.pid] || 0) - (i + 1);
    if (!bestPick || steal > bestPick.steal) bestPick = { pid: r.pid, managerId: r.managerId, pick: pickNo[r.pid], perfRank: i + 1, steal };
  });

  const award = (r, extra = {}) => (r ? { pid: r.pid, managerId: r.managerId, ...extra } : null);
  const topScorer = award(scorers[0], scorers[0] && { goals: scorers[0].goals });
  const topAssist = award(assisters[0], assisters[0] && { assists: assisters[0].assists });
  const bonuses = [];
  if (topScorer) bonuses.push({ managerId: topScorer.managerId, points: AWARD_BONUS.topScorer, reason: 'Gol kralı' });
  if (topAssist) bonuses.push({ managerId: topAssist.managerId, points: AWARD_BONUS.topAssist, reason: 'Asist kralı' });

  return {
    topScorer, topAssist,
    bestKeeper: award(keepers[0], keepers[0] && { avgRating: keepers[0].avgRating, cleanSheets: keepers[0].cleanSheets }),
    playerOfSeason: award(pots[0], pots[0] && { avgRating: pots[0].avgRating, goals: pots[0].goals, assists: pots[0].assists }),
    teamOfSeason: tos,
    bestPick,
    bonuses,
  };
}
