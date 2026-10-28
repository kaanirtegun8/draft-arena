// Player helpers: groups, EA-based role ratings, form handling.
import { POSITION_GROUP } from './config.js';

export function groupOf(player) {
  return POSITION_GROUP[player.pos] || 'MID';
}

export function isGK(player) {
  return player.pos === 'GK';
}

export function gkRating(p) {
  if (!isGK(p)) return Math.round(p.ovr * 0.3);
  return 0.22 * p.div + 0.2 * p.han + 0.3 * p.ref + 0.2 * p.gkp + 0.08 * p.kic;
}

// Role weights on EA face stats [pac, sho, pas, dri, def, phy]
const ROLE_WEIGHTS = {
  ST: [0.2, 0.45, 0.05, 0.2, 0, 0.1],
  CF: [0.15, 0.35, 0.15, 0.3, 0, 0.05],
  LW: [0.3, 0.2, 0.15, 0.3, 0, 0.05],
  RW: [0.3, 0.2, 0.15, 0.3, 0, 0.05],
  CAM: [0.1, 0.2, 0.35, 0.3, 0, 0.05],
  CM: [0.05, 0.1, 0.35, 0.2, 0.15, 0.15],
  CDM: [0.05, 0, 0.25, 0.1, 0.35, 0.25],
  LM: [0.25, 0.1, 0.3, 0.25, 0.05, 0.05],
  RM: [0.25, 0.1, 0.3, 0.25, 0.05, 0.05],
  CB: [0.1, 0, 0.05, 0, 0.55, 0.3],
  LB: [0.3, 0, 0.15, 0.1, 0.35, 0.1],
  RB: [0.3, 0, 0.15, 0.1, 0.35, 0.1],
  LWB: [0.3, 0, 0.2, 0.15, 0.25, 0.1],
  RWB: [0.3, 0, 0.2, 0.15, 0.25, 0.1],
};

export function roleRating(p, slot) {
  if (slot === 'GK') return gkRating(p);
  if (isGK(p)) return p.ovr * 0.3;
  const w = ROLE_WEIGHTS[slot] || ROLE_WEIGHTS.CM;
  return w[0] * p.pac + w[1] * p.sho + w[2] * p.pas + w[3] * p.dri + w[4] * p.def + w[5] * p.phy;
}

// EA component (0-100): half overall, half role-specific face stats.
export function eaScore(p, slot) {
  return 0.5 * p.ovr + 0.5 * roleRating(p, slot);
}

export function staminaOf(p) {
  return isGK(p) ? 85 : p.phy;
}

// Form value 0-100 where 50 = normal level for this player. Missing => neutral (null).
export function formValue(formMap, pid) {
  const f = formMap && formMap[pid];
  if (!f || typeof f.value !== 'number' || Number.isNaN(f.value)) return null;
  return Math.max(0, Math.min(100, f.value));
}

// Convert an average match rating (e.g. 6.0-8.5 scale) into the 0-100 form index.
export function formFromMatchRating(avg) {
  // 6.8 ~ normal (50); each 0.1 above/below moves 4 points
  return Math.max(0, Math.min(100, Math.round(50 + (avg - 6.8) * 40)));
}

export function shortName(name) {
  const parts = name.split(' ');
  if (parts.length === 1) return name;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}
