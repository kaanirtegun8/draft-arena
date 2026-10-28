// Lineup helpers: automatic best XI, validation, rotation-aware choices.
import { FORMATIONS, positionFit } from './config.js';
import { eaScore } from './players.js';

export function availablePlayers(squad, playerState) {
  return squad.filter((id) => !(playerState[id] && playerState[id].injuredWeeks > 0));
}

// Global greedy assignment of players to slots.
// rotation: 0..1, how much low condition is penalised (CPU uses ~1).
export function autoLineup({ squad, formation, playerById, playerState, formMap = {}, rotation = 1 }) {
  const slots = FORMATIONS[formation] || FORMATIONS['4-3-3'];
  const avail = availablePlayers(squad, playerState);
  const pairs = [];
  slots.forEach((slot, si) => {
    for (const id of avail) {
      const p = playerById[id];
      const cond = playerState[id] ? playerState[id].condition : 100;
      const f = formMap[id] && typeof formMap[id].value === 'number' ? formMap[id].value : 50;
      const fit = positionFit(slot, p);
      let v = eaScore(p, slot) * fit + (f - 50) * 0.1;
      // condition penalty grows quickly below 70
      const condPenalty = cond >= 82 ? 0 : (82 - cond) * (cond < 65 ? 0.6 : 0.4);
      v -= condPenalty * rotation;
      pairs.push({ si, id, v });
    }
  });
  pairs.sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  const slotTaken = new Array(slots.length).fill(null);
  const used = new Set();
  for (const pr of pairs) {
    if (slotTaken[pr.si] || used.has(pr.id)) continue;
    slotTaken[pr.si] = pr.id;
    used.add(pr.id);
  }
  const lineup = slots.map((slot, i) => ({ slot, playerId: slotTaken[i] }));
  const bench = avail.filter((id) => !used.has(id));
  return { lineup, bench };
}

export function validateLineup({ lineup, squad, playerState, formation }) {
  const slots = FORMATIONS[formation];
  if (!slots) return 'Geçersiz diziliş.';
  if (!Array.isArray(lineup) || lineup.length !== 11) return 'İlk 11 tam değil.';
  const seen = new Set();
  for (let i = 0; i < 11; i++) {
    const l = lineup[i];
    if (!l || !l.playerId) return 'Boş pozisyon var.';
    if (l.slot !== slots[i]) return 'Pozisyonlar dizilişle uyuşmuyor.';
    if (!squad.includes(l.playerId)) return 'Kadroda olmayan oyuncu.';
    if (seen.has(l.playerId)) return 'Aynı oyuncu iki kez seçildi.';
    if (playerState[l.playerId] && playerState[l.playerId].injuredWeeks > 0) return 'Sakat oyuncu ilk 11\'de.';
    seen.add(l.playerId);
  }
  return null;
}

// Rebuild a lineup into a new formation keeping the same players when possible.
export function reshapeLineup({ lineup, formation, squad, playerById, playerState, formMap }) {
  const keep = lineup.map((l) => l.playerId).filter(Boolean);
  const res = autoLineup({ squad: keep.length === 11 ? keep : squad, formation, playerById, playerState, formMap, rotation: 0 });
  if (keep.length === 11) {
    const benchFull = availablePlayers(squad, playerState).filter((id) => !keep.includes(id));
    return { lineup: res.lineup, bench: benchFull };
  }
  return res;
}
