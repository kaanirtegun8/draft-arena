// Round-robin (Berger tables) for any number of teams. Odd numbers get a
// BAY (bye) each week. legs = how many times every pair meets (1-8); each
// later leg repeats the first with home/away swapped on alternate legs.
export const LEG_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
export const DEFAULT_LEGS = 2;
export function legsOf(v) { const n = Number(v); return LEG_OPTIONS.includes(n) ? n : DEFAULT_LEGS; }
export function weeksFor(teams, legs) { return (teams % 2 ? teams : teams - 1) * legsOf(legs); }

export function buildSchedule(teamIds, legs = DEFAULT_LEGS) {
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
  // balance venues inside one leg: the team with fewer home games so far hosts
  const homes = {};
  for (const pairs of rounds) pairs.forEach((pr, k) => {
    const [a, b] = pr;
    if (!a || !b) return;
    if ((homes[b] || 0) < (homes[a] || 0)) pairs[k] = [b, a];
    homes[pairs[k][0]] = (homes[pairs[k][0]] || 0) + 1;
  });
  const weeks = [];
  for (let leg = 0; leg < legsOf(legs); leg++) {
    rounds.forEach((pairs, r) => {
      const week = leg * rounds.length + r + 1;
      const w = { week, matches: [], bye: null };
      for (const [a, b] of pairs) {
        if (!a || !b) { w.bye = a || b; continue; }
        const [home, away] = leg % 2 === 0 ? [a, b] : [b, a];
        w.matches.push({ id: `w${week}m${w.matches.length + 1}`, home, away });
      }
      weeks.push(w);
    });
  }
  return weeks;
}

export const LEG_LABEL = { 1: 'Tek devre (herkes 1 maç)', 2: 'Çift devre (herkes 2 maç)' };
for (let n = 3; n <= 8; n++) LEG_LABEL[n] = `${n} devre (herkes ${n} maç)`;
