// Double round-robin (Berger tables) for any number of teams. Odd numbers get a
// BAY (bye) each week. Second half mirrors the first with home/away swapped, so
// every pair meets once at home and once away.
export function buildSchedule(teamIds) {
  const ids = teamIds.slice();
  if (ids.length % 2) ids.push(null);
  const n = ids.length;
  const rounds = [];
  let arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      let a = arr[i], b = arr[n - 1 - i];
      if (i === 0 && r % 2 === 1) [a, b] = [b, a]; // alternate the fixed team's venue
      else if (i > 0 && (i + r) % 2 === 1) [a, b] = [b, a];
      pairs.push([a, b]);
    }
    rounds.push(pairs);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  const weeks = [];
  for (let leg = 0; leg < 2; leg++) {
    rounds.forEach((pairs, r) => {
      const week = leg * rounds.length + r + 1;
      const w = { week, matches: [], bye: null };
      for (const [a, b] of pairs) {
        if (!a || !b) { w.bye = a || b; continue; }
        const [home, away] = leg === 0 ? [a, b] : [b, a];
        w.matches.push({ id: `w${week}m${w.matches.length + 1}`, home, away });
      }
      weeks.push(w);
    });
  }
  return weeks;
}
