// Positions, detailed roles, squad quotas and formations.

export const POS_CODES = ['GK', 'CB', 'RB', 'LB', 'RWB', 'LWB', 'CDM', 'CM', 'CAM', 'RM', 'LM', 'RW', 'LW', 'ST', 'CF'];

// Detailed role used for filters and squad quotas
export const ROLE_OF = {
  GK: 'GK', CB: 'CB', RB: 'RB', RWB: 'RB', LB: 'LB', LWB: 'LB',
  CDM: 'CDM', CM: 'CM', CAM: 'CAM', RM: 'RW', RW: 'RW', LM: 'LW', LW: 'LW', ST: 'ST', CF: 'ST',
};
export const ROLES = ['GK', 'CB', 'RB', 'LB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
export const ROLE_LABEL = {
  GK: 'Kaleci', CB: 'Stoper', RB: 'Sağ Bek', LB: 'Sol Bek', CDM: 'Ön Libero (DOS)', CM: 'Merkez Orta Saha',
  CAM: 'On Numara', LW: 'Sol Kanat', RW: 'Sağ Kanat', ST: 'Forvet',
};
export const ROLE_SHORT = { GK: 'KL', CB: 'STP', RB: 'SĞB', LB: 'SLB', CDM: 'DOS', CM: 'MO', CAM: 'OOS', LW: 'SLK', RW: 'SĞK', ST: 'FV' };
export const LINE_OF_ROLE = { GK: 'GK', CB: 'DEF', RB: 'DEF', LB: 'DEF', CDM: 'MID', CM: 'MID', CAM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT' };

export function roleOf(p) { return ROLE_OF[p.pos] || 'CM'; }
export function isGK(p) { return p.pos === 'GK'; }

// Minimum players per role in every squad (the rest are free picks).
export const ROLE_MIN = { GK: 2, CB: 3, RB: 1, LB: 1, CDM: 1, CM: 2, CAM: 0, LW: 1, RW: 1, ST: 2 };
export const ROLE_MAX = { GK: 3 };
export const SQUAD_SIZES = [16, 18, 20];
export const DEFAULT_SQUAD = 18;
export const MIN_MANAGERS = 2;
export const MAX_MANAGERS = 10;

export function roleCounts(ids, byId) {
  const c = {};
  for (const r of ROLES) c[r] = 0;
  for (const id of ids) c[roleOf(byId[id])] += 1;
  return c;
}

// Returns null if the pick keeps the squad completable, else a Turkish reason.
export function quotaError(squadIds, player, squadSize, byId) {
  if (squadIds.length >= squadSize) return 'Kadro dolu.';
  const c = roleCounts(squadIds, byId);
  const r = roleOf(player);
  if (ROLE_MAX[r] != null && c[r] >= ROLE_MAX[r]) return `${ROLE_LABEL[r]} sınırı (${ROLE_MAX[r]}) dolu.`;
  c[r] += 1;
  let unmet = 0;
  for (const role of ROLES) unmet += Math.max(0, ROLE_MIN[role] - c[role]);
  const left = squadSize - squadIds.length - 1;
  if (unmet > left) {
    const need = ROLES.filter((role) => ROLE_MIN[role] - c[role] + (role === r ? 1 : 0) > 0)
      .map((role) => `${ROLE_SHORT[role]} ${ROLE_MIN[role] - c[role] + (role === r ? 1 : 0)}`);
    return `Bu seçim kadroyu tamamlanamaz yapar. Önce eksikleri seç: ${need.join(', ')}`;
  }
  return null;
}

export function unmetNeeds(squadIds, byId) {
  const c = roleCounts(squadIds, byId);
  const out = {};
  for (const r of ROLES) out[r] = Math.max(0, ROLE_MIN[r] - c[r]);
  return out;
}

// ---------- formations
// Each slot: [code, side] where side is L, C or R. Order = display order (back to front).
export const FORMATIONS = {
  '4-3-3': [['GK', 'C'], ['LB', 'L'], ['CB', 'L'], ['CB', 'R'], ['RB', 'R'], ['CM', 'L'], ['CDM', 'C'], ['CM', 'R'], ['LW', 'L'], ['ST', 'C'], ['RW', 'R']],
  '4-2-3-1': [['GK', 'C'], ['LB', 'L'], ['CB', 'L'], ['CB', 'R'], ['RB', 'R'], ['CDM', 'L'], ['CDM', 'R'], ['LW', 'L'], ['CAM', 'C'], ['RW', 'R'], ['ST', 'C']],
  '4-1-4-1': [['GK', 'C'], ['LB', 'L'], ['CB', 'L'], ['CB', 'R'], ['RB', 'R'], ['CDM', 'C'], ['LM', 'L'], ['CM', 'L'], ['CM', 'R'], ['RM', 'R'], ['ST', 'C']],
  '4-4-2': [['GK', 'C'], ['LB', 'L'], ['CB', 'L'], ['CB', 'R'], ['RB', 'R'], ['LM', 'L'], ['CM', 'L'], ['CM', 'R'], ['RM', 'R'], ['ST', 'L'], ['ST', 'R']],
  '4-4-2 Elmas': [['GK', 'C'], ['LB', 'L'], ['CB', 'L'], ['CB', 'R'], ['RB', 'R'], ['CDM', 'C'], ['CM', 'L'], ['CM', 'R'], ['CAM', 'C'], ['ST', 'L'], ['ST', 'R']],
  '3-5-2': [['GK', 'C'], ['CB', 'L'], ['CB', 'C'], ['CB', 'R'], ['LWB', 'L'], ['CM', 'L'], ['CDM', 'C'], ['CM', 'R'], ['RWB', 'R'], ['ST', 'L'], ['ST', 'R']],
  '3-4-3': [['GK', 'C'], ['CB', 'L'], ['CB', 'C'], ['CB', 'R'], ['LM', 'L'], ['CM', 'L'], ['CM', 'R'], ['RM', 'R'], ['LW', 'L'], ['ST', 'C'], ['RW', 'R']],
  '5-3-2': [['GK', 'C'], ['LWB', 'L'], ['CB', 'L'], ['CB', 'C'], ['CB', 'R'], ['RWB', 'R'], ['CM', 'L'], ['CDM', 'C'], ['CM', 'R'], ['ST', 'L'], ['ST', 'R']],
};

export function formationSlots(name) {
  return (FORMATIONS[name] || FORMATIONS['4-3-3']).map(([code, side]) => ({ code, side }));
}

// Position familiarity compat[slot][playerPos] (0..1). Missing pairs fall back by line.
const COMPAT = {
  GK: { GK: 1 },
  CB: { CB: 1, CDM: 0.8, RB: 0.76, LB: 0.76, RWB: 0.68, LWB: 0.68 },
  RB: { RB: 1, RWB: 0.95, CB: 0.74, LB: 0.72, RM: 0.72, LWB: 0.66, CDM: 0.62 },
  LB: { LB: 1, LWB: 0.95, CB: 0.74, RB: 0.72, LM: 0.72, RWB: 0.66, CDM: 0.62 },
  RWB: { RWB: 1, RB: 0.94, RM: 0.86, RW: 0.74, LWB: 0.74, LB: 0.68 },
  LWB: { LWB: 1, LB: 0.94, LM: 0.86, LW: 0.74, RWB: 0.74, RB: 0.68 },
  CDM: { CDM: 1, CM: 0.88, CB: 0.78, CAM: 0.62 },
  CM: { CM: 1, CDM: 0.9, CAM: 0.88, LM: 0.74, RM: 0.74 },
  CAM: { CAM: 1, CM: 0.86, CF: 0.86, LW: 0.78, RW: 0.78, ST: 0.72, LM: 0.74, RM: 0.74 },
  LM: { LM: 1, LW: 0.94, LWB: 0.8, RM: 0.82, CM: 0.74, RW: 0.78, CAM: 0.74 },
  RM: { RM: 1, RW: 0.94, RWB: 0.8, LM: 0.82, CM: 0.74, LW: 0.78, CAM: 0.74 },
  LW: { LW: 1, LM: 0.94, RW: 0.86, CF: 0.8, ST: 0.76, CAM: 0.78 },
  RW: { RW: 1, RM: 0.94, LW: 0.86, CF: 0.8, ST: 0.76, CAM: 0.78 },
  ST: { ST: 1, CF: 0.96, LW: 0.76, RW: 0.76, CAM: 0.72 },
  CF: { CF: 1, ST: 0.96, CAM: 0.88, LW: 0.8, RW: 0.8 },
};
const LINE = { GK: 'G', CB: 'D', RB: 'D', LB: 'D', RWB: 'D', LWB: 'D', CDM: 'M', CM: 'M', CAM: 'M', RM: 'M', LM: 'M', RW: 'A', LW: 'A', ST: 'A', CF: 'A' };

export function altOf(p) {
  const a = p.alt;
  if (!a) return [];
  return Array.isArray(a) ? a : Object.values(a);
}

export function positionFit(slotCode, p) {
  const positions = [p.pos, ...altOf(p)];
  let best = 0;
  positions.forEach((pos, i) => {
    let v = (COMPAT[slotCode] && COMPAT[slotCode][pos]) || 0;
    if (!v) {
      if (slotCode === 'GK' || pos === 'GK') v = 0.2;
      else if (LINE[slotCode] === LINE[pos]) v = 0.68;
      else v = 0.5;
    }
    if (i > 0) v *= 0.97; // alternative position slightly less natural
    if (v > best) best = v;
  });
  // weak-side full-back / wing-back: a right-footer at left-back (when not natural there) loses a bit
  const natural = positions.includes(slotCode);
  if (!natural && p.foot) {
    if (['LB', 'LWB'].includes(slotCode) && p.foot === 'R') best *= 0.94;
    if (['RB', 'RWB'].includes(slotCode) && p.foot === 'L') best *= 0.94;
  }
  return Math.round(best * 1000) / 1000;
}
