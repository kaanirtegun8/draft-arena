// Team chemistry. Players who know each other play better together: club team-mates
// most, then players of the same national team, then of the same league. A link counts
// more between players who play close to each other on the pitch, and a player out of
// his position gels less. Each player gets 0..3 chemistry, the XI 0..100.
// The engine turns it into a team-wide multiplier (about -7% .. +8%).
import { positionFit } from './positions.js';

export const CHEM_LINK = { club: 1.0, nation: 0.7, league: 0.35 };
export const CHEM_EFFECT = 0.08;
export const CHEM_NEUTRAL = 45; // a typical drafted XI

const LINE = { GK: 0, CB: 1, LB: 1.3, RB: 1.3, LWB: 1.8, RWB: 1.8, CDM: 2, CM: 2.5, LM: 2.6, RM: 2.6, CAM: 3, LW: 3.5, RW: 3.5, CF: 3.6, ST: 4 };
const SIDE = { L: -1, C: 0, R: 1 };

export function linkOf(a, b) {
  let v = 0;
  const why = [];
  if (a.club && a.club === b.club) { v += CHEM_LINK.club; why.push('club'); }
  else if (a.league && a.league === b.league) { v += CHEM_LINK.league; why.push('league'); }
  if (a.nat && a.nat === b.nat) { v += CHEM_LINK.nation; why.push('nation'); }
  return { v, why };
}
function proximity(sa, sb) {
  const d = Math.abs((LINE[sa.code] ?? 2.5) - (LINE[sb.code] ?? 2.5)) + 0.8 * Math.abs((SIDE[sa.side] ?? 0) - (SIDE[sb.side] ?? 0));
  return d <= 1.3 ? 1 : d <= 2.4 ? 0.6 : 0.3;
}

// xi: [{ slot: {code, side}, player }]
export function teamChemistry(xi) {
  const n = xi.length;
  const per = new Array(n).fill(0);
  const links = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const l = linkOf(xi[i].player, xi[j].player);
      if (!l.v) continue;
      const w = l.v * proximity(xi[i].slot, xi[j].slot);
      per[i] += w; per[j] += w;
      links.push({ a: xi[i].player.id, b: xi[j].player.id, why: l.why, w });
    }
  }
  const players = xi.map((x, i) => {
    let c = Math.min(3, per[i] * 1.2);
    const fit = positionFit(x.slot.code, x.player);
    if (fit < 0.9) c *= fit < 0.75 ? 0.4 : 0.7; // out of position
    return { pid: x.player.id, chem: Math.round(c * 10) / 10 };
  });
  const sum = players.reduce((a, p) => a + p.chem, 0);
  const team = Math.round((sum / (3 * Math.max(1, n))) * 100);
  return { team, players, links, mult: chemMultiplier(team) };
}

// 45 is neutral; 95+ gives +8%, 0 gives about -7%
export function chemMultiplier(team) {
  return 1 + Math.max(-1, Math.min(1, (team - CHEM_NEUTRAL) / 50)) * CHEM_EFFECT;
}
export function chemLabel(team) { return team >= 75 ? 'Mükemmel' : team >= 58 ? 'Yüksek' : team >= 38 ? 'Orta' : team >= 22 ? 'Düşük' : 'Çok düşük'; }
