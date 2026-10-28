// Double round-robin for an odd number of teams with a BAY (bye) each week.
// 5 teams => 10 weeks, 2 matches per week, 20 matches, 8 matches + 2 byes per team,
// 4 home + 4 away for every team.

export function roundRobin(teamIds) {
  const ids = teamIds.slice();
  if (ids.length % 2 === 1) ids.push(null); // null = BAY
  const n = ids.length;
  const rounds = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()); // rotate all but first
  }
  return rounds;
}

// Choose home/away for the first half so that every team has an equal split,
// then mirror for the second half.
export function buildSchedule(teamIds) {
  const rounds = roundRobin(teamIds);
  const matches = [];
  rounds.forEach((pairs, r) => pairs.forEach(([a, b]) => { if (a && b) matches.push({ r, a, b }); }));
  const n = matches.length;
  let chosen = null;
  // deterministic search (2^10 options for 5 teams) for a balanced first half,
  // preferring no team playing 3 home/away in a row.
  for (let mask = 0; mask < 1 << n; mask++) {
    const home = {}, seq = {};
    teamIds.forEach((t) => { home[t] = 0; seq[t] = []; });
    matches.forEach((m, i) => {
      const h = mask & (1 << i) ? m.b : m.a;
      const aw = h === m.a ? m.b : m.a;
      home[h] += 1; seq[h][m.r] = 'H'; seq[aw][m.r] = 'A';
    });
    const counts = Object.values(home);
    if (Math.max(...counts) - Math.min(...counts) > 0) continue;
    const streakOk = teamIds.every((t) => !/HHH|AAA/.test(seq[t].filter(Boolean).join('')));
    if (streakOk) { chosen = mask; break; }
    if (chosen == null) chosen = mask;
  }
  const weeks = [];
  const half = rounds.length;
  for (let leg = 0; leg < 2; leg++) {
    rounds.forEach((pairs, r) => {
      const week = leg * half + r + 1;
      const wk = { week, matches: [], bye: null };
      pairs.forEach(([a, b]) => {
        if (!a || !b) { wk.bye = a || b; return; }
        const i = matches.findIndex((m) => m.r === r && m.a === a && m.b === b);
        let home = chosen & (1 << i) ? b : a;
        let away = home === a ? b : a;
        if (leg === 1) [home, away] = [away, home];
        wk.matches.push({ id: `w${week}m${wk.matches.length + 1}`, home, away });
      });
      weeks.push(wk);
    });
  }
  return weeks;
}
