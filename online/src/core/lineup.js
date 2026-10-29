// Automatic lineups and availability.
import { formationSlots, positionFit } from './positions.js';

export function isAvailable(st) {
  return !st || ((st.injuredWeeks || 0) <= 0 && (st.banned || 0) <= 0);
}

export function autoLineup({ squad, formation, byId, state = {}, levelOf, rotation = 1, keep = null, slots: customSlots = null }) {
  const slots = customSlots || formationSlots(formation);
  const avail = squad.filter((id) => isAvailable(state[id]));
  const chosen = new Array(slots.length).fill(null);
  const used = new Set();
  // keep the manager's choices where still possible
  if (keep) keep.forEach((pid, i) => { if (pid && avail.includes(pid) && !used.has(pid) && i < slots.length) { chosen[i] = pid; used.add(pid); } });
  const pairs = [];
  slots.forEach((s, i) => {
    if (chosen[i]) return;
    for (const id of avail) {
      if (used.has(id)) continue;
      const p = byId[id];
      const cond = state[id] ? state[id].condition : 100;
      const pen = cond >= 82 ? 0 : (82 - cond) * (cond < 65 ? 0.6 : 0.4);
      pairs.push({ i, id, v: levelOf(p) * positionFit(s.code, p) - pen * rotation });
    }
  });
  pairs.sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  for (const pr of pairs) {
    if (chosen[pr.i] || used.has(pr.id)) continue;
    chosen[pr.i] = pr.id; used.add(pr.id);
  }
  return { lineup: chosen, bench: avail.filter((id) => !used.has(id)) };
}

export function lineupError(lineup, formation, squad, state) {
  const slots = formationSlots(formation);
  if (!Array.isArray(lineup) || lineup.length !== slots.length) return 'İlk 11 tam değil.';
  const seen = new Set();
  for (const pid of lineup) {
    if (!pid) return 'Boş pozisyon var.';
    if (!squad.includes(pid)) return 'Kadroda olmayan oyuncu var.';
    if (seen.has(pid)) return 'Aynı oyuncu iki kez seçilmiş.';
    if (!isAvailable(state[pid])) return 'Sakat veya cezalı oyuncu ilk 11\'de.';
    seen.add(pid);
  }
  return null;
}
