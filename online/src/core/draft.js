// Snake draft for any number of managers (2..10). With an even squad size every
// manager ends up with exactly the same sum of pick numbers.
import { quotaError, unmetNeeds, roleOf, ROLE_MIN } from './positions.js';
import { cheapestFill } from './auction.js';

export function snakeOrder(firstRound, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? firstRound : firstRound.slice().reverse();
    for (const seat of row) order.push(seat);
  }
  return order;
}

export function toArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
}

export function squads(draft) {
  const out = {};
  for (const s of toArray(draft && draft.firstRound)) out[s] = [];
  for (const p of toArray(draft && draft.picks)) if (p) (out[p.seat] = out[p.seat] || []).push(p.pid);
  return out;
}

export function onClock(draft) {
  if (!draft) return null;
  const order = toArray(draft.order);
  return draft.current < order.length ? order[draft.current] : null;
}

export function draftDone(draft) {
  return !!draft && draft.current >= (draft.total || toArray(draft.order).length);
}

// Budget mode: money left and the minimum needed to fill the rest of the squad.
// budget = { total, prices } or null for the classic draft.
export function budgetState(draft, seat, squadSize, budget) {
  if (!budget) return null;
  const sq = squads(draft)[seat] || [];
  const spentNow = sq.reduce((a, id) => a + (budget.prices[id] || 0), 0);
  return { total: budget.total, spent: spentNow, left: budget.total - spentNow, slots: squadSize - sq.length };
}
// the most a seat may pay for one player and still fill the squad (needed positions first)
export function maxSpend(draft, seat, squadSize, budget, exclude = null, byId = null) {
  const st = budgetState(draft, seat, squadSize, budget);
  if (!st) return Infinity;
  const sq = squads(draft)[seat] || [];
  const ids = byId || budget.byId;
  const after = exclude ? [...sq, exclude] : sq;
  return st.left - cheapestFill(budget.prices, ids, after, st.slots - 1, (id) => id === exclude || !!(draft.taken && draft.taken[id]), toArray(draft.firstRound).length);
}
// cheapest legal player for a seat (so a budget draft can never get stuck)
export function cheapestLegal(draft, seat, squadSize, budget, byId) {
  const sq = squads(draft)[seat] || [];
  let best = null, bp = Infinity;
  for (const [id, pr] of Object.entries(budget.prices)) {
    if (!byId[id] || (draft.taken && draft.taken[id]) || quotaError(sq, byId[id], squadSize, byId)) continue;
    if (pr < bp || (pr === bp && id < best)) { bp = pr; best = id; }
  }
  return best;
}

// null when legal, otherwise a Turkish reason
export function pickError(draft, seat, pid, squadSize, byId, budget = null) {
  if (!draft) return 'Draft başlamadı.';
  if (draftDone(draft)) return 'Draft bitti.';
  if (onClock(draft) !== seat) return 'Sıra sende değil.';
  const p = byId[pid];
  if (!p) return 'Oyuncu bulunamadı.';
  if (draft.taken && draft.taken[pid]) return 'Bu oyuncu alındı.';
  const sq = squads(draft)[seat] || [];
  const q = quotaError(sq, p, squadSize, byId);
  if (q) return q;
  if (budget) {
    const price = budget.prices[pid] || 0;
    const st = budgetState(draft, seat, squadSize, budget);
    const lastResort = pid === cheapestLegal(draft, seat, squadSize, budget, byId);
    if (price > st.left && !lastResort) return 'Bütçe yetmiyor.';
    if (price > maxSpend(draft, seat, squadSize, budget, pid, byId) && !lastResort) return 'Kalan kadroyu tamamlayacak para kalmaz.';
  }
  return null;
}

// Best legal pick for a seat (auto-pick / timeout / suggestion).
export function suggestPick(draft, seat, squadSize, pool, levelOf, byId, budget = null) {
  const sq = squads(draft)[seat] || [];
  const st = budgetState(draft, seat, squadSize, budget);
  // in budget mode spend roughly evenly: a target price per remaining slot, stars allowed early
  const target = st ? (st.left / Math.max(1, st.slots)) * (st.slots > squadSize * 0.6 ? 1.8 : 1.2) : null;
  const fallback = st ? cheapestLegal(draft, seat, squadSize, budget, byId) : null;
  const need = unmetNeeds(sq, byId);
  const left = squadSize - sq.length;
  const needTotal = Object.values(need).reduce((a, b) => a + b, 0);
  let best = null, bv = -Infinity;
  for (const p of pool) {
    if (draft.taken && draft.taken[p.id]) continue;
    if (quotaError(sq, p, squadSize, byId)) continue;
    const r = roleOf(p);
    let v = levelOf(p);
    if (st) {
      const price = budget.prices[p.id] || 0;
      if (p.id !== fallback && (price > st.left || price > maxSpend(draft, seat, squadSize, budget, p.id, byId))) continue;
      if (price > target) v -= (price - target) / 8e6; // over the plan costs points
    }
    if (need[r] > 0) v += 2 + 6 * (needTotal / Math.max(1, left)); // fill needs as the draft goes on
    if (r === 'GK' && sq.filter((id) => roleOf(byId[id]) === 'GK').length >= 1) v -= 4;
    if (r === 'GK' && left > squadSize - 4) v -= 3; // keepers rarely in the first rounds
    if (ROLE_MIN[r] === 0 && need[r] === 0) v -= 0.5;
    // versatile players (2-3 positions) are worth a little more in a small squad
    v += Math.min(1.2, 0.4 * (Array.isArray(p.alt) ? p.alt.length : Object.keys(p.alt || {}).length));
    if (v > bv) { bv = v; best = p; }
  }
  return best ? best.id : null;
}
