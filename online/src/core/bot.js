// Bot managers. A bot is a room member with `bot: true`. It has no phone of its own:
// the admin's device plays for it (draft picks, sealed picks, auction bids, tactics),
// so every decision goes through the same API and server rules as a human's.
//
// How the "hard" bot thinks:
// - Squad value: the best XI over several formations (level x position fit), the
//   backup for every place (older players need rest, so backups play more), team
//   chemistry and the captain's lift: the same multipliers the match engine uses.
// - Draft: for its best candidates it plays the draft forward (rivals pick like a
//   sensible manager) up to its next two turns and keeps the pick that leaves the
//   best squad. Scarce positions and bargains come out of this on their own.
// - Budget: money left is worth what it can still buy (price ~ doubles every 4 level
//   points), and it always keeps enough to fill the squad.
// - Sealed picks: avoids players the others are likely to pick unless they are worth
//   an auction. Bidding: pays up to what the player is worth over the best
//   alternative, never into the money kept back for the rest of the squad.
// - Tactics: every week it reads the next opponent's line-up and tactics and searches
//   formations, position variants, roles and instructions on a model of the match
//   engine (zone strengths, possession, chance rate and quality, keeper), picking
//   the set-up with the most expected points. The XI is chosen on condition, so
//   tired and old players are rested.
import { FORMATIONS, SLOT_VARIANTS, formationSlots, positionFit, roleOf, isGK, quotaError, unmetNeeds } from './positions.js';
import { cheapestFill, MIN_RAISE } from './auction.js';
import { teamChemistry } from './chemistry.js';
import { leadership, realRate, STYLE, TUNING } from './engine.js';
import { teamUnits, analyse, INSTRUCTIONS, defaultInstructions } from './tactics.js';
import { ROLES, rolesFor, roleFit } from './roles.js';
import { abilities } from './abilities.js';
import { ageDrain } from './fitness.js';
import { isAvailable } from './lineup.js';
import { createRng } from './rng.js';

export const BOT_LEVELS = {
  easy: { key: 'easy', label: 'Kolay', icon: '🙂', desc: 'İyi oyuncuları tanır ama plan yapmaz, taktiği basittir. Yeni başlayanlar için.', lookahead: 0, noise: 3.5, chem: false, tactics: 'basic', bid: 'list' },
  normal: { key: 'normal', label: 'Orta', icon: '😎', desc: 'Kadro ihtiyaçlarını, bütçeyi ve kimyayı hesaplar; dizilişi rakibe göre seçer.', lookahead: 0, noise: 0.6, chem: true, tactics: 'formation', bid: 'value' },
  hard: { key: 'hard', label: 'Zor', icon: '🧠', desc: 'Draftı ileriye doğru hesaplar, kıt mevkileri ve kelepirleri kaçırmaz, artırmada değerini bilir; her hafta rakibin taktiğine göre diziliş, rol ve talimat seçer, yorgunları dinlendirir.', lookahead: 2, noise: 0, chem: true, tactics: 'full', bid: 'smart' },
};
export const DEFAULT_BOT_LEVEL = 'hard';
export function botLevelOf(m) { return BOT_LEVELS[(m && m.botLevel) || DEFAULT_BOT_LEVEL] || BOT_LEVELS[DEFAULT_BOT_LEVEL]; }

export const BOT_NAMES = [
  ['Robo Hoca', 'Algoritma FC'], ['Taktik Makinesi', 'Silikon Spor'], ['Bay Veri', 'Veri United'], ['Çip Hoca', 'Devre Arası FK'],
  ['Profesör Bit', 'Binary SK'], ['Demir Teknik', 'Robot Gücü'], ['Yapay Hoca', 'Yapay Zeka FK'], ['Matris Hoca', 'Matrix United'],
  ['Kod Ustası', 'Kod Spor'], ['Sinir Ağı', 'Nöral FC'], ['Hesap Hoca', 'Olasılık SK'], ['Bot Baba', 'Elektrik Spor'],
];

export function isBot(room, seat) { const m = room && room.members && room.members[seat]; return !!(m && m.bot); }
export function botSeats(room) { return Object.entries((room && room.members) || {}).filter(([, m]) => m && m.bot).map(([s]) => s); }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// share of the matches a starter can play at full strength (age: tires fast, recovers slowly)
const DUR = (age = 27) => (age <= 26 ? 1 : age <= 27 ? 0.98 : age <= 29 ? 0.93 : age <= 31 ? 0.84 : age <= 32 ? 0.74 : age <= 33 ? 0.66 : age <= 34 ? 0.58 : 0.52);
const EVAL_FORMS = ['4-3-3', '4-2-3-1', '4-4-2 Elmas', '3-5-2', '4-1-4-1'];
const W_START = 0.82; // minutes share of a fit outfield starter (the rest: rotation, subs, injuries)
const W_BENCH = 0.18; // weight of a pick that only adds depth (in the money value)

// ---------- squad evaluation (one "brain" per pool / level function)
const BRAINS = new WeakMap();
export function brainFor(pool, byId, levelOf) {
  let b = BRAINS.get(levelOf);
  if (!b || b.pool !== pool) { b = makeBrain(pool, byId, levelOf); BRAINS.set(levelOf, b); }
  return b;
}

function makeBrain(pool, byId, levelOf) {
  const LV = new Map(), FIT = new Map(), LEAD = new Map();
  const lv = (id) => { let v = LV.get(id); if (v === undefined) { v = levelOf(byId[id]); LV.set(id, v); } return v; };
  const fitF = (id, code) => {
    const k = `${id}|${code}`;
    let v = FIT.get(k);
    if (v === undefined) { v = 0.55 + 0.45 * positionFit(code, byId[id]); FIT.set(k, v); } // same as the engine's effective()
    return v;
  };
  const lead = (id) => { let v = LEAD.get(id); if (v === undefined) { v = leadership({ ...byId[id], level: lv(id) }); LEAD.set(id, v); } return v; };
  const sorted = pool.map((p) => p.id).filter((id) => byId[id]).sort((a, b) => lv(b) - lv(a) || (a < b ? -1 : 1));
  const SL = Object.fromEntries(Object.keys(FORMATIONS).map((f) => [f, formationSlots(f)]));

  // XI + one backup per place for a formation. Returns the weighted value.
  function xiEval(ids, formation, chem) {
    const slots = SL[formation];
    const n = slots.length;
    const pairs = [];
    for (let i = 0; i < n; i++) { const c = slots[i].code; for (const id of ids) pairs.push([lv(id) * fitF(id, c), i, id]); }
    pairs.sort((a, b) => b[0] - a[0] || (a[2] < b[2] ? -1 : 1));
    const xi = new Array(n).fill(null), sv = new Array(n).fill(0);
    const used = new Set();
    let filled = 0;
    for (const [v, i, id] of pairs) {
      if (filled >= n) break;
      if (xi[i] || used.has(id)) continue;
      xi[i] = id; sv[i] = v; used.add(id); filled++;
    }
    // a bench player can cover at most two places
    const bv = new Array(n).fill(0), uses = new Map();
    let bf = 0;
    if (ids.length > filled) {
      for (const [v, i, id] of pairs) {
        if (bf >= n) break;
        if (used.has(id) || bv[i]) continue;
        const u = uses.get(id) || 0;
        if (u >= 2) continue;
        bv[i] = v; uses.set(id, u + 1); bf++;
      }
    }
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (!xi[i]) continue;
      const a = slots[i].code === 'GK' ? 0.96 : W_START * DUR(byId[xi[i]].age);
      total += a * sv[i] + (1 - a) * bv[i];
    }
    if (chem && filled >= 4) {
      const view = [];
      let L = 0;
      for (let i = 0; i < n; i++) if (xi[i]) { view.push({ slot: slots[i], player: byId[xi[i]] }); L = Math.max(L, lead(xi[i])); }
      total *= teamChemistry(view).mult * (1.01 + 0.06 * L / 100);
    }
    return { value: total, xi, filled };
  }
  function value(ids, chem = true, forms = EVAL_FORMS) {
    let best = null;
    for (const f of forms) { const r = xiEval(ids, f, chem); if (!best || r.value > best.value) best = { ...r, formation: f }; }
    return best || { value: 0, xi: [], filled: 0, formation: '4-3-3' };
  }
  return { pool, byId, lv, fitF, lead, sorted, SL, xiEval, value };
}

// value of one € for a squad that still has `slots` places and `money` (level points per €)
function muFor(brain, ids, money, slots, chem) {
  if (!slots || money <= 0) return 0;
  const e = Math.max(0, 11 - brain.value(ids, chem).filled);
  const w = (Math.min(e, slots) * W_START + Math.max(0, slots - e) * W_BENCH) / slots;
  const per = Math.max(1e6, money / slots);
  return (w * 4) / (Math.LN2 * per);
}
// what the money left will still buy (same scale as the squad value)
function moneyValue(brain, ids, money, slots, chem, capLevel) {
  if (!slots || money == null) return 0;
  const e = Math.max(0, 11 - brain.value(ids, chem).filled);
  const w = Math.min(e, slots) * W_START + Math.max(0, slots - e) * W_BENCH;
  const per = Math.max(0.5e6, money / slots);
  return w * clamp(70 + 4 * Math.log2(per / 4e6), 52, capLevel || 92);
}

// ---------- draft simulation state (classic / budget snake, auction snake phase)
// sim = { order: [seat on the clock, then the following seats], sq: {seat: ids}, taken: Set,
//         money: {seat: €} | null, prices | null, squadSize, nSeats }
function cloneSim(s) {
  const sq = {};
  for (const [k, v] of Object.entries(s.sq)) sq[k] = v.slice();
  return { ...s, sq, taken: new Set(s.taken), money: s.money ? { ...s.money } : null };
}
function applyPick(s, seat, id) {
  (s.sq[seat] = s.sq[seat] || []).push(id);
  s.taken.add(id);
  if (s.money) s.money[seat] -= (s.prices[id] || 0);
}

// a sensible human (the app's own suggestion logic): best level, fill needs, plan the money
function rivalPick(brain, s, seat) {
  const { byId, lv, sorted } = brain;
  const sq = s.sq[seat] || [];
  const left = s.squadSize - sq.length;
  if (left <= 0) return null;
  const need = unmetNeeds(sq, byId);
  const needTotal = Object.values(need).reduce((a, b) => a + b, 0);
  const money = s.money ? s.money[seat] : null;
  const target = money != null ? (money / left) * (left > s.squadSize * 0.6 ? 1.8 : 1.2) : null;
  const gks = sq.filter((id) => isGK(byId[id])).length;
  let best = null, bv = -Infinity;
  for (const id of sorted) {
    const l = lv(id);
    if (l + 9 < bv) break;
    if (s.taken.has(id)) continue;
    let v = l;
    if (money != null) {
      const pr = s.prices[id] || 0;
      if (pr > money) continue;
      if (pr > target) v -= (pr - target) / 8e6;
    }
    const r = roleOf(byId[id]);
    if (need[r] > 0) v += 2 + 6 * (needTotal / Math.max(1, left));
    if (r === 'GK' && gks >= 1) v -= 4;
    if (r === 'GK' && left > s.squadSize - 4) v -= 3;
    if (v <= bv) continue;
    if (quotaError(sq, byId[id], s.squadSize, byId)) continue;
    bv = v; best = id;
  }
  return best;
}

// legal players for a seat, best level first; in budget modes only those that still
// leave enough money to fill the squad (fallback: the cheapest legal one)
function legalList(brain, s, seat, limit = 40, extraBargains = 0) {
  const { byId, lv, sorted } = brain;
  const sq = s.sq[seat] || [];
  const slots = s.squadSize - sq.length;
  if (slots <= 0) return [];
  const money = s.money ? s.money[seat] : null;
  const busy = (id) => s.taken.has(id);
  const reserveAll = money != null ? cheapestFill(s.prices, byId, sq, slots - 1, busy, s.nSeats) : 0;
  const ok = (id) => {
    if (s.taken.has(id) || quotaError(sq, byId[id], s.squadSize, byId)) return false;
    if (money == null) return true;
    const pr = s.prices[id] || 0;
    if (pr > money) return false;
    if (pr <= money - reserveAll) return true;
    return pr + cheapestFill(s.prices, byId, [...sq, id], slots - 1, (x) => x === id || busy(x), s.nSeats) <= money;
  };
  const out = [];
  const perRole = {};
  for (const id of sorted) {
    if (out.length >= limit) break;
    if (!ok(id)) continue;
    out.push(id);
    const r = roleOf(byId[id]); perRole[r] = (perRole[r] || 0) + 1;
  }
  // scarce positions: the best two of every role, and the best value for money
  const set = new Set(out);
  const need = unmetNeeds(sq, byId);
  for (const id of sorted) {
    const r = roleOf(byId[id]);
    if ((perRole[r] || 0) >= (need[r] > 0 ? 3 : 2) || set.has(id) || !ok(id)) continue;
    set.add(id); out.push(id); perRole[r] = (perRole[r] || 0) + 1;
  }
  if (money != null && extraBargains) {
    const bargains = sorted.filter((id) => !set.has(id) && !s.taken.has(id))
      .map((id) => ({ id, v: lv(id) - 4 * Math.log2(Math.max(1e6, s.prices[id] || 1e6) / 4e6) }))
      .sort((a, b) => b.v - a.v);
    let k = 0;
    for (const b of bargains) { if (k >= extraBargains) break; if (ok(b.id)) { out.push(b.id); set.add(b.id); k++; } }
  }
  if (!out.length && money != null) {
    // nothing fits the plan any more: the cheapest legal player he can still pay for
    const cheap = sorted.filter((id) => !s.taken.has(id) && (s.prices[id] || 0) <= money && !quotaError(sq, byId[id], s.squadSize, byId))
      .sort((a, b) => (s.prices[a] || 0) - (s.prices[b] || 0) || lv(b) - lv(a));
    if (cheap.length) out.push(cheap[0]);
  }
  return out;
}

function scoreNow(brain, s, seat, ids, chem) {
  const sq = s.sq[seat] || [];
  const base = brain.value(sq, chem).value;
  const money = s.money ? s.money[seat] : null;
  const mu = money != null ? muFor(brain, sq, money, s.squadSize - sq.length, chem) : 0;
  return ids.map((id) => {
    const d = brain.value([...sq, id], chem).value - base;
    return { id, d, s: d - (money != null ? mu * (s.prices[id] || 0) : 0) };
  }).sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
}

function greedyPick(brain, s, seat, chem) {
  const c = legalList(brain, s, seat, 18, s.money ? 4 : 0);
  if (!c.length) return null;
  return scoreNow(brain, s, seat, c, chem)[0].id;
}

/**
 * Pick for a bot in a snake draft (classic, budget, or the snake phase of an auction).
 * Returns a player id, or null if the bot cannot pay for anybody (its turn is passed).
 */
export function botSnakePick(brain, sim, seat, levelKey = DEFAULT_BOT_LEVEL, seed = 'bot') {
  const L = BOT_LEVELS[levelKey] || BOT_LEVELS.hard;
  const cands = legalList(brain, sim, seat, L.lookahead ? 34 : 24, sim.money ? 8 : 0);
  if (!cands.length) return null;
  const scored = scoreNow(brain, sim, seat, cands, L.chem);
  if (L.noise) {
    // a less careful manager: a bit of randomness among the good options
    const rng = createRng(`${seed}|${seat}|${(sim.sq[seat] || []).length}`);
    let best = null, bv = -Infinity;
    for (const x of scored.slice(0, 6)) { const v = x.s + rng.normal() * L.noise; if (v > bv) { bv = v; best = x.id; } }
    return best;
  }
  if (!L.lookahead || scored.length === 1) return scored[0].id;
  const capLevel = brain.lv(brain.sorted.find((id) => !sim.taken.has(id)) || brain.sorted[0]);
  let best = null, bv = -Infinity;
  for (const x of scored.slice(0, 8)) {
    const s2 = cloneSim(sim);
    applyPick(s2, seat, x.id);
    let mine = 0;
    for (let i = 1; i < s2.order.length; i++) {
      const who = s2.order[i];
      if (who === seat) {
        if (mine >= L.lookahead) break;
        const pid = greedyPick(brain, s2, seat, L.chem);
        if (pid) applyPick(s2, seat, pid);
        mine++;
      } else {
        const pid = rivalPick(brain, s2, who);
        if (pid) applyPick(s2, who, pid);
      }
    }
    const sq = s2.sq[seat];
    let v = brain.value(sq, L.chem).value;
    if (s2.money) v += moneyValue(brain, sq, s2.money[seat], s2.squadSize - sq.length, L.chem, capLevel);
    if (v > bv + 1e-9) { bv = v; best = x.id; }
  }
  return best;
}

// ---------- sealed picks + auctions (auction mode). st = auctionState(...)
function auctionSim(st, prices, squadSize) {
  const order = st.phase === 'snake' && st.snake ? st.snake.order.slice(st.snake.i) : [];
  return { order, sq: Object.fromEntries(Object.entries(st.own).map(([k, v]) => [k, v.slice()])), taken: new Set(Object.keys(st.taken)), money: { ...st.left }, prices, squadSize, nSeats: Object.keys(st.own).length };
}

export function botAuctionPick(brain, st, seat, { prices, squadSize, level = DEFAULT_BOT_LEVEL, seed } = {}) {
  const sim = auctionSim(st, prices, squadSize);
  const pid = botSnakePick(brain, sim, seat, level, seed);
  return pid && !st.pickError(seat, pid) ? pid : null;
}

export function botSealedPicks(brain, st, seat, { prices, squadSize, level = DEFAULT_BOT_LEVEL, seed = 'bot' } = {}) {
  const L = BOT_LEVELS[level] || BOT_LEVELS.hard;
  const k = st.picksAllowed[seat] || 0;
  if (!k) return [];
  const own = st.own[seat] || [];
  const money = st.moneyLeft(seat);
  const slots = st.slots[seat] || 0;
  const seats = Object.keys(st.own);
  const rivals = seats.filter((s) => s !== seat && (st.slots[s] || 0) > 0 && st.canBuy(s));
  // who else is likely to pick whom: the app's suggestion for each rival, plus the stars
  const want = {};
  if (L.key !== 'easy') {
    for (const s of rivals) {
      const busy = [];
      for (let i = 0; i < (st.picksAllowed[s] || 0); i++) { const p = st.suggest(s, busy); if (!p) break; busy.push(p); want[p] = (want[p] || 0) + 0.8; }
    }
    const avail = brain.sorted.filter((id) => !st.taken[id]);
    avail.slice(0, rivals.length * 2).forEach((id, i) => { want[id] = (want[id] || 0) + (i < rivals.length ? 0.6 : 0.3); });
  }
  const contest = (id) => 1 - Math.exp(-(want[id] || 0));
  const sim = { sq: { [seat]: own.slice() }, taken: new Set(Object.keys(st.taken)), money: { [seat]: money }, prices, squadSize, nSeats: seats.length };
  const cands = legalList(brain, sim, seat, 40, 10);
  const rng = createRng(`${seed}|sealed|${st.round}|${seat}`);
  const chosen = [];
  for (let step = 0; step < k; step++) {
    const sq = [...own, ...chosen];
    const base = brain.value(sq, L.chem).value;
    const spent = chosen.reduce((a, id) => a + (prices[id] || 0), 0);
    const mu = muFor(brain, sq, money - spent, slots - chosen.length, L.chem);
    let best = null, bv = -Infinity;
    for (const id of cands) {
      if (chosen.includes(id) || st.sealedError(seat, chosen, id)) continue; // also skips picks that eat the reserve
      const d = brain.value([...sq, id], L.chem).value - base;
      const pr = prices[id] || 0;
      const c = contest(id);
      let v = (1 - c) * (d - mu * pr) + c * 0.4 * (d - mu * pr * 1.4);
      if (L.noise) v += rng.normal() * L.noise;
      if (v > bv) { bv = v; best = id; }
    }
    if (!best) break;
    chosen.push(best);
  }
  if (!chosen.length) { const p = st.suggest(seat); if (p) chosen.push(p); }
  return st.validSealed(seat, chosen);
}

// { amount } to bid, or { pass: true }
export function botBid(brain, st, seat, { prices, squadSize, level = DEFAULT_BOT_LEVEL } = {}) {
  const L = BOT_LEVELS[level] || BOT_LEVELS.hard;
  const a = st.auction;
  if (!a || a.turn !== seat) return { pass: true };
  const pid = a.pid;
  const min = a.bid == null ? a.base : a.bid + MIN_RAISE;
  const money = st.moneyLeft(seat);
  const limitHard = Math.min(money, st.maxPay(seat, pid));
  if (min > limitHard) return { pass: true };
  if (L.bid === 'list') return a.bid == null ? { amount: a.base } : { pass: true };
  const own = st.own[seat] || [];
  const slots = st.slots[seat] || 0;
  const base = brain.value(own, L.chem).value;
  const dP = brain.value([...own, pid], L.chem).value - base;
  const mu = Math.max(1e-12, muFor(brain, own, money, slots, L.chem));
  // what he is worth over the best substitute of the same position at list price
  // (players waiting for their own auction do not count; the substitute may be gone later)
  const queued = new Set([pid, ...st.queue.map((q) => q.pid)]);
  const sim = { sq: { [seat]: own.slice() }, taken: new Set([...Object.keys(st.taken), ...queued]), money: { [seat]: money }, prices, squadSize, nSeats: Object.keys(st.own).length };
  const role = roleOf(brain.byId[pid]);
  const subs = brain.sorted.filter((id) => !sim.taken.has(id) && roleOf(brain.byId[id]) === role && (prices[id] || 0) <= money && !quotaError(own, brain.byId[id], squadSize, brain.byId)).slice(0, 8);
  const scored = scoreNow(brain, sim, seat, subs, L.chem);
  // second best substitute counts a little too: the best one may be bought by someone else first
  const subSurplus = scored.length ? (scored.length > 1 ? 0.7 * scored[0].s + 0.3 * scored[1].s : 0.85 * scored[0].s) : 0;
  let worth = (dP - Math.max(0, subSurplus)) / mu;
  if (!scored.length) worth = dP / mu; // nobody else for this position
  if (L.bid === 'value') worth = Math.min(worth, a.base * 1.25);
  const cap = Math.min(limitHard, worth);
  if (cap < min) return { pass: true };
  const room = cap - min;
  const step = a.bid == null ? 0 : room > 25e6 ? 5e6 : room > 10e6 ? 2e6 : 0;
  return { amount: Math.min(money, Math.round(min + step)) };
}

// ---------- tactics: a model of the match engine at kick-off
const XG = { cross: 0.093, cutback: 0.14, wide: 0.071, through: 0.166, long: 0.038, combo: 0.104, counter: 0.164, corner: 0.085 };
const BASE_MIX = { L: { cross: 0.5, cutback: 0.28, wide: 0.22 }, C: { through: 0.33, combo: 0.4, long: 0.27 } };
const SHOOT_W = {
  cross: { ST: 5, CF: 4, CAM: 1.4, LW: 1.2, RW: 1.2, CM: 0.9, CB: 0.5, LM: 0.8, RM: 0.8, CDM: 0.4 },
  cutback: { ST: 4, CF: 3.5, CAM: 2.5, CM: 1.6, LW: 1.5, RW: 1.5, LM: 1.1, RM: 1.1, CDM: 0.5 },
  wide: { LW: 4, RW: 4, LM: 3, RM: 3, LWB: 1.2, RWB: 1.2, LB: 0.6, RB: 0.6, ST: 1 },
  through: { ST: 5, CF: 4, LW: 2.4, RW: 2.4, CAM: 1.8, CM: 0.7, LM: 1.2, RM: 1.2 },
  combo: { ST: 4.5, CF: 4.5, CAM: 3, LW: 2, RW: 2, CM: 1.4, LM: 1.2, RM: 1.2, CDM: 0.4 },
  long: { CM: 3, CAM: 3, CDM: 1.6, LW: 1.4, RW: 1.4, ST: 1.2, LM: 1.2, RM: 1.2, CB: 0.3, LB: 0.4, RB: 0.4 },
  counter: { ST: 4, CF: 3.5, LW: 3.2, RW: 3.2, CAM: 1.6, LM: 1.6, RM: 1.6, CM: 0.6 },
  corner: { CB: 3.5, ST: 3, CF: 2, CDM: 1.4, CM: 0.9, LB: 0.5, RB: 0.5, LW: 0.5, RW: 0.5, CAM: 0.6 },
};
const roleShoot = (key, type) => {
  const r = ROLES[key];
  if (!r) return 1;
  if ((type === 'cross' || type === 'corner') && r.shootCross) return r.shootCross;
  if ((type === 'through' || type === 'counter') && r.shootThrough) return r.shootThrough;
  return r.shoot || 1;
};
const skillOf = (type, ab) => (type === 'cross' || type === 'corner' ? ab.aerialAtt : type === 'long' ? ab.longShot : ab.finishing);

// average condition over a match for a starter (drain: stamina, age, press, mentality, role)
function matchCond(p, slot, ins, start) {
  const st = abilities(p).stamina;
  const pressF = ins.press === 'high' ? 1.14 : ins.press === 'low' ? 0.9 : 1;
  const mentF = ins.mentality === 'attacking' ? 1.04 : ins.mentality === 'defensive' ? 0.97 : 1;
  const f = (1.3 - (st / 100) * 0.6) * (slot.code === 'GK' ? 0.35 : 1) * pressF * mentF * ((ROLES[slot.role] && ROLES[slot.role].drain) || 1) * ageDrain(p.age);
  return clamp(start - 0.42 * 90 * TUNING.drain * f, 0, 100);
}

// side = { slots:[{code,side,role,shift}], lineup:[pid|''], players:{pid: player+level+condition}, ins, captain }
function sideModel(side) {
  const view = [];
  side.lineup.forEach((pid, i) => {
    const p = pid && side.players[pid];
    if (!p) return;
    view.push({ slot: side.slots[i], player: p, level: p.level ?? p.ovr, cond: matchCond(p, side.slots[i], side.ins, p.condition ?? 100), day: 1 });
  });
  const raw = teamUnits(view, side.ins);
  const chem = teamChemistry(view);
  let L = 0;
  const cap = view.find((o) => o.player.id === side.captain);
  if (cap) L = leadership(cap.player); else for (const o of view) L = Math.max(L, leadership(o.player));
  const b = (view.length ? 1.01 + 0.06 * L / 100 : 1) * chem.mult;
  for (const z of ['L', 'C', 'R']) { raw.att[z] *= b; raw.def[z] *= b; }
  raw.control *= b;
  // shooters' skill per chance type, forwards' pace, counter roles, keeper
  const skill = {};
  for (const type of Object.keys(SHOOT_W)) {
    let sw = 0, ss = 0;
    for (const o of view) {
      if (o.slot.code === 'GK') continue;
      const ab = abilities(o.player);
      const s = skillOf(type, ab);
      const w = (SHOOT_W[type][o.slot.code] || 0.25) * Math.pow(Math.max(20, s) / 70, 2) * roleShoot(o.slot.role, type) * realRate(o.player, 'goals');
      sw += w; ss += w * clamp((s + (o.level - o.player.ovr)) * (0.85 + 0.15 * o.cond / 100), 20, 110);
    }
    skill[type] = sw ? ss / sw : 60;
  }
  const fw = view.filter((o) => ['ST', 'CF', 'LW', 'RW', 'LM', 'RM'].includes(o.slot.code));
  const pace = fw.length ? fw.reduce((a, o) => a + abilities(o.player).pace, 0) / fw.length : 65;
  let cb = 1;
  for (const o of view) { const r = ROLES[o.slot.role]; if (r && r.counter) cb *= r.counter; }
  const gk = view.find((o) => o.slot.code === 'GK');
  const gkRating = gk ? (isGK(gk.player) ? abilities(gk.player).keeping + (gk.level - gk.player.ovr) : 25) * (0.85 + 0.15 * (gk.player.condition ?? 100) / 100) : 20;
  return { raw, ins: side.ins, skill, pace, counterBoost: Math.min(1.6, cb), gkRating, men: view.length };
}
function cloneRaw(u) { return { ...u, mix: { ...u.mix }, def: { ...u.def }, att: { ...u.att } }; }

function goalRate(U, D, M, O, poss, home) {
  const T = TUNING;
  const zr = { L: U.att.L / D.def.R, C: U.att.C / D.def.C, R: U.att.R / D.def.L };
  const zw = { L: U.att.L * zr.L, C: U.att.C * 1.25 * zr.C, R: U.att.R * zr.R };
  const tot = zw.L + zw.C + zw.R || 1;
  const eff = clamp((zw.L * zr.L + zw.C * zr.C + zw.R * zr.R) / tot, 0.6, 1.5);
  const st = STYLE[M.ins.style] || STYLE.balanced;
  let pCh = T.chanceBase * Math.pow(2 * poss, st.possExp) * Math.pow(eff, T.strengthPower) * (U.directness || 1) * st.chance;
  if (home) pCh *= T.homeAdvantage;
  pCh *= Math.pow(M.men / 11, 2.0) * Math.pow(11 / Math.max(7, O.men), 1.5);
  pCh = clamp(pCh, 0.008, 0.35);
  const sk = (type) => Math.pow(M.skill[type] / 80, 1.1) * 0.92;
  const duel = clamp(1 + ((M.skill.cross || 70) - 70) / 60 + (D.aerialGap || 0) / 80, 0.5, 1.7);
  const typeXg = (type, z) => {
    let x = XG[type] * sk(type);
    if (type === 'cross') x *= duel;
    else if (type === 'through') x *= clamp(1 + (M.pace - 75) / 80, 0.7, 1.4);
    return x * clamp(Math.pow(zr[z], 0.4), 0.8, 1.25);
  };
  let xgCh = 0;
  for (const z of ['L', 'C', 'R']) {
    const base = z === 'C' ? BASE_MIX.C : BASE_MIX.L;
    const w = Object.entries(base).map(([k, v]) => [k, Math.max(0.03, v + ((U.mix && U.mix[k]) || 0))]);
    const tw = w.reduce((a, [, v]) => a + v, 0);
    let x = 0;
    for (const [k, v] of w) x += (v / tw) * typeXg(k, z);
    xgCh += (zw[z] / tot) * x;
  }
  const pCorner = (1 - pCh) * T.cornerBase * Math.sqrt(2 * poss) * clamp(eff, 0.6, 1.6) * ((zw.L + zw.R) / tot) * 1.6;
  const cRatio = 1 + clamp((D.aerialGap || 0) / 60, -0.4, 0.5);
  const xgCorner = 0.28 * cRatio * XG.corner * clamp(1 + ((M.skill.corner || 70) - 70) / 60, 0.5, 1.6) * sk('corner');
  const pCtr = (1 - pCh - pCorner) * Math.min(0.045, T.counterBase * (1 - poss) * 2 * D.counterExposure * Math.pow(M.pace / 75, 2) * M.counterBoost * st.counter);
  const xgCtr = 0.55 * XG.counter * sk('counter') * clamp(Math.pow(Math.max(1, zr.C), 0.4), 0.8, 1.25);
  const gkF = Math.pow(75 / clamp(O.gkRating, 20, 99), 1.5);
  return 90 * 1.15 * (pCh * xgCh * 1.03 + pCorner * xgCorner + pCtr * xgCtr) * gkF; // 1.15: calibrated on the engine (free kicks, rebounds)
}

const POIS = (l) => { const o = [Math.exp(-l)]; for (let k = 1; k <= 10; k++) o.push((o[k - 1] * l) / k); return o; };
export function expectedPoints(la, lb) {
  const pa = POIS(la), pb = POIS(lb);
  let w = 0, d = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = pa[i] * pb[j]; if (i > j) w += p; else if (i === j) d += p; }
  return 3 * w + d;
}

// expected goals for both sides and expected points for side a
export function matchupModel(a, b, aHome = true, bModel = null) {
  const ma = sideModel(a), mb = bModel || sideModel(b);
  const ua = ma.raw, ub = cloneRaw(mb.raw);
  const A = analyse(ua, ub, a.ins, mb.ins);
  const B = analyse(ub, ua, mb.ins, a.ins);
  const ch = A.control * (1 + clamp((A.press - B.press) / 300, -0.15, 0.15));
  const cb = B.control * (1 + clamp((B.press - A.press) / 300, -0.15, 0.15));
  const pa = clamp(Math.pow(ch, TUNING.possessionPower) / (Math.pow(ch, TUNING.possessionPower) + Math.pow(cb, TUNING.possessionPower)), TUNING.possessionClamp[0], TUNING.possessionClamp[1]);
  const la = goalRate(A, B, ma, mb, pa, aHome);
  const lb = goalRate(B, A, mb, ma, 1 - pa, !aHome);
  return { la, lb, poss: pa, ep: expectedPoints(la, lb) };
}

/**
 * Tactics for a bot for its next match.
 * squad: ids; state: { pid: { condition, injuredWeeks, banned } }; opp: the opponent's match
 * snapshot (season.teamSnapshot) or null; home: plays at home.
 * Returns a tactics object for api.saveTactics.
 */
export function botTactics({ brain, squad, state = {}, opp = null, home = true, level = DEFAULT_BOT_LEVEL }) {
  const L = BOT_LEVELS[level] || BOT_LEVELS.hard;
  const { byId, lv, fitF } = brain;
  const P = {};
  for (const id of squad) P[id] = { ...byId[id], level: lv(id), condition: state[id] ? state[id].condition : 100 };
  const avail = squad.filter((id) => isAvailable(state[id]));
  const cond = (id) => P[id].condition;
  // condition at kick-off counts twice: in this match, and a tired player risks injury and the next weeks
  const pickValue = (id, code) => {
    const p = P[id];
    const c = cond(id);
    const endC = c - 90 * TUNING.drain * (1.3 - abilities(p).stamina / 100 * 0.6) * (code === 'GK' ? 0.35 : 1) * ageDrain(p.age);
    const m = 0.62 + 0.38 * clamp(c - (c - endC) * 0.42, 0, 100) / 100;
    let v = lv(id) * fitF(id, code) * m;
    if (code !== 'GK') v -= 0.12 * Math.max(0, 80 - c) + 0.1 * Math.max(0, 58 - endC);
    return v;
  };
  const assign = (codes) => {
    const pairs = [];
    codes.forEach((c, i) => { for (const id of avail) pairs.push([pickValue(id, c), i, id]); });
    pairs.sort((x, y) => y[0] - x[0] || (x[2] < y[2] ? -1 : 1));
    const xi = new Array(codes.length).fill(null);
    const used = new Set();
    for (const [, i, id] of pairs) { if (xi[i] || used.has(id)) continue; xi[i] = id; used.add(id); }
    return xi;
  };
  const bestRole = (code, pid) => {
    const keys = rolesFor(code);
    if (!pid || !keys.length) return keys[0] || null;
    const ab = abilities(byId[pid]);
    return keys.slice().sort((x, y) => roleFit(y, ab) - roleFit(x, ab))[0];
  };
  const codesOf = (f, sc) => formationSlots(f).map((s, i) => (sc && sc[i]) || s.code);
  const sideOf = (cfg) => ({
    slots: formationSlots(cfg.formation).map((s, i) => ({ code: (cfg.slotCodes[i]) || s.code, side: s.side, role: cfg.roles[i] || null, shift: 0 })),
    lineup: cfg.lineup.map((x) => x || ''), players: P, ins: cfg.ins, captain: null,
  });
  const fresh = (f, sc = {}, ins = defaultInstructions()) => {
    const codes = codesOf(f, sc);
    const lineup = assign(codes);
    const roles = {};
    codes.forEach((c, i) => { roles[i] = bestRole(c, lineup[i]); });
    return { formation: f, slotCodes: { ...sc }, roles, ins: { ...ins }, lineup };
  };

  let oppModel = null;
  if (opp) {
    const slots = (Array.isArray(opp.slots) ? opp.slots : Object.values(opp.slots || {})).map((x) => ({ code: x.code, side: x.side, role: x.role || null, shift: x.shift || 0 }));
    const lineup = (Array.isArray(opp.lineup) ? opp.lineup : Object.values(opp.lineup || {})).map((x) => x || '');
    oppModel = sideModel({ slots: slots.length ? slots : formationSlots(opp.formation), lineup, players: opp.players || {}, ins: { ...defaultInstructions(), ...(opp.instructions || {}) }, captain: (opp.setPieces || {}).captain || null });
  }
  const base = fresh('4-3-3');
  if (!oppModel) oppModel = sideModel(sideOf(base)); // no opponent yet (before the season, a bye): play against our own plain 4-3-3
  const score = (cfg) => matchupModel(sideOf(cfg), null, home, oppModel).ep;

  let best;
  if (L.tactics === 'basic') {
    // the strongest plain XI among a few common shapes
    best = ['4-3-3', '4-4-2', '4-2-3-1'].map((f) => fresh(f)).map((c) => ({ c, v: c.lineup.reduce((a, id, i) => a + (id ? pickValue(id, codesOf(c.formation, {})[i]) : 0), 0) })).sort((x, y) => y.v - x.v)[0].c;
    best.roles = {};
  } else {
    const ranked = Object.keys(FORMATIONS).map((f) => { const c = fresh(f); return { c, v: score(c) }; }).sort((x, y) => y.v - x.v);
    if (L.tactics === 'formation') best = ranked[0].c;
    else {
      let top = null, tv = -Infinity;
      for (const { c: start } of ranked.slice(0, 3)) {
        let cfg = start, v = score(cfg);
        const tryCfg = (c2) => { const v2 = score(c2); if (v2 > v + 1e-6) { cfg = c2; v = v2; return true; } return false; };
        const insPass = () => {
          for (const [k, def] of Object.entries(INSTRUCTIONS)) for (const opt of Object.keys(def.options)) if (opt !== cfg.ins[k]) tryCfg({ ...cfg, ins: { ...cfg.ins, [k]: opt } });
        };
        insPass();
        const baseSlots = formationSlots(cfg.formation);
        // position variants (a CM played as a CDM ...): the XI is rebuilt for the new shape
        baseSlots.forEach((s, i) => {
          for (const code of SLOT_VARIANTS[s.code] || []) {
            const cur = cfg.slotCodes[i] || s.code;
            if (code === cur) continue;
            const sc = { ...cfg.slotCodes };
            if (code === s.code) delete sc[i]; else sc[i] = code;
            const codes = codesOf(cfg.formation, sc);
            const lineup = assign(codes);
            const roles = {};
            codes.forEach((c, j) => { roles[j] = lineup[j] === cfg.lineup[j] && rolesFor(c).includes(cfg.roles[j]) ? cfg.roles[j] : bestRole(c, lineup[j]); });
            tryCfg({ ...cfg, slotCodes: sc, lineup, roles });
          }
        });
        // roles, slot by slot (twice: roles work together)
        for (let pass = 0; pass < 2; pass++) {
          codesOf(cfg.formation, cfg.slotCodes).forEach((code, i) => {
            for (const r of rolesFor(code)) if (r !== cfg.roles[i]) tryCfg({ ...cfg, roles: { ...cfg.roles, [i]: r } });
          });
        }
        insPass();
        if (v > tv) { tv = v; top = cfg; }
      }
      best = top;
    }
  }
  // the saved XI may not have holes while the squad is big enough: fill with unavailable players
  // (they are replaced automatically at kick-off)
  const lineup = best.lineup.slice();
  const inXI = new Set(lineup.filter(Boolean));
  const spare = squad.filter((id) => !inXI.has(id));
  for (let i = 0; i < lineup.length; i++) if (!lineup[i] && spare.length) lineup[i] = spare.shift();
  const roles = {};
  for (const [i, r] of Object.entries(best.roles || {})) if (r) roles[i] = r;
  return {
    formation: best.formation, lineup: lineup.map((x) => x || ''), slotCodes: best.slotCodes || {}, roles,
    instructions: { ...defaultInstructions(), ...best.ins }, autoManage: true, subRules: [],
    subPlan: { threshold: 64, fromMinute: 58, exceptions: [] },
  };
}
