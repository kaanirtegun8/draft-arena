// Snake draft for any number of managers (2..10). With an even squad size every
// manager ends up with exactly the same sum of pick numbers.
import { quotaError, unmetNeeds, roleOf, ROLE_MIN } from './positions.js';

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

// null when legal, otherwise a Turkish reason
export function pickError(draft, seat, pid, squadSize, byId) {
  if (!draft) return 'Draft başlamadı.';
  if (draftDone(draft)) return 'Draft bitti.';
  if (onClock(draft) !== seat) return 'Sıra sende değil.';
  const p = byId[pid];
  if (!p) return 'Oyuncu bulunamadı.';
  if (draft.taken && draft.taken[pid]) return 'Bu oyuncu alındı.';
  const sq = squads(draft)[seat] || [];
  return quotaError(sq, p, squadSize, byId);
}

// Best legal pick for a seat (auto-pick / timeout / suggestion).
export function suggestPick(draft, seat, squadSize, pool, levelOf, byId) {
  const sq = squads(draft)[seat] || [];
  const need = unmetNeeds(sq, byId);
  const left = squadSize - sq.length;
  const needTotal = Object.values(need).reduce((a, b) => a + b, 0);
  let best = null, bv = -Infinity;
  for (const p of pool) {
    if (draft.taken && draft.taken[p.id]) continue;
    if (quotaError(sq, p, squadSize, byId)) continue;
    const r = roleOf(p);
    let v = levelOf(p);
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
