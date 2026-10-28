// Season statistics are always derived from the stored match results, so they
// can never drift from what happened in the matches.
import { POINTS } from './config.js';

export function emptyPlayerStats() {
  return {
    apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, shots: 0, shotsOnTarget: 0,
    yellow: 0, red: 0, ratingSum: 0, avgRating: 0, motm: 0,
    saves: 0, conceded: 0, cleanSheets: 0, injuries: 0, xg: 0,
  };
}

export function finishedMatches(state) {
  return state.schedule.flatMap((w) => w.matches).map((m) => state.matches[m.id]).filter((m) => m && m.status === 'finished');
}

export function seasonPlayerStats(state) {
  const out = {};
  for (const mgr of state.managers) for (const pid of mgr.squad) out[pid] = { ...emptyPlayerStats(), managerId: mgr.id };
  for (const m of finishedMatches(state)) {
    for (const [pid, x] of Object.entries(m.result.playerStats)) {
      if (!x.played) continue;
      const s = out[pid] || (out[pid] = emptyPlayerStats());
      s.apps += 1;
      if (x.started) s.starts += 1;
      s.minutes += x.minutes;
      s.goals += x.goals; s.assists += x.assists;
      s.shots += x.shots; s.shotsOnTarget += x.shotsOnTarget;
      s.yellow += x.yellow; s.red += x.red;
      s.ratingSum += x.rating;
      s.saves += x.saves; s.conceded += x.conceded;
      if (x.cleanSheet) s.cleanSheets += 1;
      if (x.injured) s.injuries += 1;
      s.xg += x.xg || 0;
      if (m.result.motm === pid) s.motm += 1;
    }
  }
  for (const s of Object.values(out)) {
    s.avgRating = s.apps ? Math.round((s.ratingSum / s.apps) * 100) / 100 : 0;
    s.xg = Math.round(s.xg * 100) / 100;
  }
  return out;
}

export function standings(state) {
  const rows = {};
  for (const m of state.managers) {
    rows[m.id] = { managerId: m.id, name: m.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, bonus: 0, total: 0, form: [] };
  }
  for (const m of finishedMatches(state)) {
    const h = rows[m.home], a = rows[m.away];
    const hg = m.result.homeGoals, ag = m.result.awayGoals;
    h.played++; a.played++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.won++; a.lost++; h.points += POINTS.win; h.form.push('G'); a.form.push('M'); }
    else if (hg < ag) { a.won++; h.lost++; a.points += POINTS.win; h.form.push('M'); a.form.push('G'); }
    else { h.drawn++; a.drawn++; h.points += POINTS.draw; a.points += POINTS.draw; h.form.push('B'); a.form.push('B'); }
  }
  // bonus points only after the season has been completed
  if (state.bonusApplied && state.awards) {
    for (const b of state.awards.bonuses) rows[b.managerId].bonus += b.points;
  }
  const list = Object.values(rows);
  for (const r of list) { r.gd = r.gf - r.ga; r.total = r.points + r.bonus; r.form = r.form.slice(-5); }
  const order = state.managers.map((m) => m.id);
  list.sort((x, y) => y.total - x.total || y.gd - x.gd || y.gf - x.gf || y.won - x.won || order.indexOf(x.managerId) - order.indexOf(y.managerId));
  list.forEach((r, i) => { r.rank = i + 1; });
  return list;
}
