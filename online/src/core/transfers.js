// Mid-season transfer window. When half of the weeks are played every manager gets one
// transfer: an offer to another team (players + money for players). The other manager
// accepts or rejects; an accepted offer swaps the players at once. The window closes
// when the admin plays the next week.
// Squads are always derived: draft picks + accepted transfers, so every phone agrees.
import { squads, toArray } from './draft.js';
import { roleCounts, ROLE_MIN, ROLE_MAX, ROLES } from './positions.js';

export const CLASSIC_TRANSFER_MONEY = 150e6;
// player index (set once by the API) so season helpers need not pass it around
let BYID = null;
export function setPlayerIndex(byId) { BYID = byId; }
export const MAX_SWAP = 3;

// the week whose matches come right after the window
export function windowWeek(season) {
  const total = toArray(season && season.schedule).length;
  if (total < 2) return null;
  return Math.floor(total / 2) + 1;
}
export function windowOpen(room) {
  const s = room && room.season;
  if (!s || s.finished || (room.public && room.public.status !== 'season')) return false;
  const w = windowWeek(s);
  return w != null && s.currentWeek === w;
}

export function proposals(room) {
  const t = room && room.transfers;
  if (!t) return [];
  return Object.entries(t).map(([id, x]) => ({ id, ...x, give: toArray(x.give), want: toArray(x.want), money: Number(x.money) || 0 }));
}

function squadOk(ids, byId) {
  const c = roleCounts(ids, byId);
  return ROLES.every((r) => (c[r] || 0) >= (ROLE_MIN[r] || 0) && (ROLE_MAX[r] == null || (c[r] || 0) <= ROLE_MAX[r]));
}

// why a deal is not possible on these squads (null = fine). Money is checked by the API.
export function dealError(sq, deal, byId) {
  const { from, to, give, want } = deal;
  if (!sq[from] || !sq[to] || from === to) return 'Takım bulunamadı.';
  if (!give.length || !want.length) return 'En az bir oyuncu ver, bir oyuncu iste.';
  if (give.length !== want.length) return 'Verdiğin ve aldığın oyuncu sayısı eşit olmalı.';
  if (give.length > MAX_SWAP) return `En fazla ${MAX_SWAP}'e ${MAX_SWAP} takas yapılabilir.`;
  if (new Set(give).size !== give.length || new Set(want).size !== want.length) return 'Aynı oyuncu iki kez seçilmiş.';
  if (!give.every((p) => sq[from].includes(p))) return 'Verdiğin oyunculardan biri artık sende değil.';
  if (!want.every((p) => sq[to].includes(p))) return 'İstediğin oyunculardan biri artık o takımda değil.';
  const a = sq[from].filter((p) => !give.includes(p)).concat(want);
  const b = sq[to].filter((p) => !want.includes(p)).concat(give);
  if (!squadOk(a, byId)) return 'Bu takastan sonra senin kadron mevki kurallarını (en az 2 kaleci, 3 stoper…) karşılamıyor.';
  if (!squadOk(b, byId)) return 'Bu takastan sonra rakibin kadrosu mevki kurallarını karşılamıyor.';
  return null;
}

// Accepted deals in the order they were accepted, applied to the draft squads.
export function applyTransfers(room, byId0, uptoWeek = Infinity) {
  const byId = byId0 || BYID;
  const sq = {};
  for (const [s, l] of Object.entries(squads(room.draft))) sq[s] = l.slice();
  const ww = room.season ? windowWeek(room.season) : null;
  const used = {}, done = [];
  const closedAt = room.season && room.season.weeksPlayed && room.season.weeksPlayed[ww];
  const acc = proposals(room).filter((d) => d.status === 'accepted' && d.week === ww && d.week <= uptoWeek && (!closedAt || (Number(d.acceptedAt) || 0) < Number(closedAt)))
    .sort((a, b) => (Number(a.acceptedAt) || 0) - (Number(b.acceptedAt) || 0) || (a.id < b.id ? -1 : 1));
  for (const d of acc) {
    if (used[d.from] || dealError(sq, d, byId)) continue;
    sq[d.from] = sq[d.from].filter((p) => !d.give.includes(p)).concat(d.want);
    sq[d.to] = sq[d.to].filter((p) => !d.want.includes(p)).concat(d.give);
    used[d.from] = true;
    done.push(d);
  }
  return { squads: sq, used, done };
}
export function currentSquads(room, byId) {
  if (!room.transfers) return squads(room.draft);
  return applyTransfers(room, byId).squads;
}
// squads that played a given week (transfers count from the window week on)
export function squadsAt(room, week, byId) {
  if (!room.transfers) return squads(room.draft);
  return applyTransfers(room, byId, week).squads;
}

// money a manager can still spend in the window
export function transferMoney(room, seat, budget, byId) {
  let base;
  if (budget) {
    const spent = toArray(room.draft && room.draft.picks).filter((p) => p && p.seat === seat).reduce((a, p) => a + (p.paid != null ? Number(p.paid) : (budget.prices[p.pid] || 0)), 0);
    base = budget.total - spent;
  } else base = CLASSIC_TRANSFER_MONEY;
  for (const d of applyTransfers(room, byId).done) {
    if (d.from === seat) base -= d.money;
    if (d.to === seat) base += d.money;
  }
  return Math.max(0, base);
}
