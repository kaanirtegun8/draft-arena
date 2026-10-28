// Snake draft: round 1 = order, round 2 = reversed, ...
// With an even number of rounds every manager gets the same total of pick numbers.
import { POSITION_QUOTAS, SQUAD_SIZE } from './config.js';
import { groupOf } from './players.js';

export function snakeOrder(order, rounds = SQUAD_SIZE) {
  const picks = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? order : order.slice().reverse();
    row.forEach((managerId, i) => picks.push({ pick: picks.length + 1, round: r + 1, inRound: i + 1, managerId }));
  }
  return picks;
}

export function squadGroupCounts(squadIds, playerById) {
  const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of squadIds) c[groupOf(playerById[id])] += 1;
  return c;
}

export function remainingNeeds(squadIds, playerById) {
  const c = squadGroupCounts(squadIds, playerById);
  const need = {};
  for (const g of Object.keys(POSITION_QUOTAS)) need[g] = POSITION_QUOTAS[g] - c[g];
  return need;
}

// Returns null if allowed, otherwise a Turkish reason string.
export function pickError(state, managerId, playerId, playerById) {
  const d = state.draft;
  if (state.phase !== 'draft') return 'Draft tamamlandı.';
  const slot = d.order[d.current];
  if (!slot) return 'Draft tamamlandı.';
  if (slot.managerId !== managerId) return 'Sıra bu menajerde değil.';
  const p = playerById[playerId];
  if (!p) return 'Oyuncu bulunamadı.';
  if (d.taken[playerId]) return 'Bu oyuncu zaten seçildi.';
  const m = state.managers.find((x) => x.id === managerId);
  const need = remainingNeeds(m.squad, playerById);
  if (need[groupOf(p)] <= 0) return `${groupOf(p)} kontenjanı dolu.`;
  return null;
}

// CPU pick: best value in a needed group, with scarcity and a little seeded noise.
export function cpuChoosePick(state, managerId, playerById, pool, rng, formMap = {}) {
  const m = state.managers.find((x) => x.id === managerId);
  const need = remainingNeeds(m.squad, playerById);
  const left = SQUAD_SIZE - m.squad.length;
  let best = null, bestV = -Infinity;
  for (const p of pool) {
    if (state.draft.taken[p.id]) continue;
    const g = groupOf(p);
    if (need[g] <= 0) continue;
    const f = formMap[p.id] && typeof formMap[p.id].value === 'number' ? formMap[p.id].value : 50;
    let v = p.ovr + (f - 50) * 0.08;
    v += 4 * (need[g] / left);              // fill scarce needs
    if (g === 'GK' && need.GK === 2 && left > 10) v -= 3; // keepers rarely go first
    if (p.age >= 33) v -= 0.6;
    v += rng.float(-1.5, 1.5);
    if (v > bestV) { bestV = v; best = p; }
  }
  return best ? best.id : null;
}
