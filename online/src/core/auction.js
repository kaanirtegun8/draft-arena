// Budget draft with sealed picks and auctions.
// Everybody secretly picks up to 3 players at once (a hash is committed first, the picks
// are revealed only when every manager has committed, so nobody can react to the others).
// A player picked by one manager is bought at his list price. A player picked by several
// managers goes to an auction between them: they bid in turn, whoever passes drops out,
// the last one standing pays his bid. After the sealed rounds the rest of the squad is
// filled in snake order with the budget rule.
// All state is derived from an append-only action log, so every phone computes the same
// result and invalid actions (out of turn, over budget, unknown player) are simply ignored.
import { quotaError, unmetNeeds, roleOf } from './positions.js';

// Money to keep back for k more players. The squad's missing positions come first, then
// anyone. Rival managers will be buying the cheap players too, so with n managers only
// every n-th cheapest player is counted as "ours" (stride = number of managers).
export function cheapestFill(prices, byId, sq, k, isBusy, stride = 1) {
  if (k <= 0) return 0;
  const st = Math.max(1, Math.round(stride));
  const need = unmetNeeds(sq, byId);
  const free = Object.keys(prices).filter((id) => byId[id] && !isBusy(id) && !sq.includes(id)).sort((a, b) => prices[a] - prices[b] || (a < b ? -1 : 1));
  const at = (list, j) => list[Math.min(list.length - 1, j * st + st - 1)];
  let cost = 0, n = 0;
  const used = new Set();
  for (const [r, c] of Object.entries(need)) {
    if (c <= 0) continue;
    const list = free.filter((id) => roleOf(byId[id]) === r);
    for (let j = 0; j < c && n < k && list.length; j++) { const id = at(list, j); cost += prices[id]; used.add(id); n += 1; }
  }
  let gk = sq.filter((id) => roleOf(byId[id]) === 'GK').length + [...used].filter((id) => roleOf(byId[id]) === 'GK').length;
  const rest = free.filter((id) => !used.has(id) && (roleOf(byId[id]) !== 'GK' || gk < 3));
  for (let j = 0; n < k && rest.length; j++, n++) cost += prices[at(rest, j)];
  void gk;
  return cost;
}

export const SEALED_PICKS = 3;
export const MIN_RAISE = 1e6;
export const SEALED_ROUND_OPTIONS = [
  { rounds: 1, label: 'Sadece ilk tur (herkes 3 oyuncu), sonra sıralı + bütçe' },
  { rounds: 2, label: 'İlk 2 tur gizli (6 oyuncu), sonra sıralı + bütçe' },
  { rounds: 99, label: 'Tüm draft gizli seçim + açık artırma' },
];

// small sync hash (cyrb53) used for the sealed-pick commitment
export function sealHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function sealOf(round, seat, picks, salt) { return sealHash(`${round}|${seat}|${picks.join(',')}|${salt}`); }

const arr = (v) => (!v ? [] : Array.isArray(v) ? v : Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]));

/**
 * cfg = { seats (draft order of the first round), squadSize, total (budget), prices, byId, pool,
 *         levelOf, sealedRounds }
 * Returns the full derived state.
 */
export function auctionState(logIn, cfg) {
  const { seats, squadSize, total, prices, byId } = cfg;
  const log = arr(logIn).filter(Boolean);
  const own = {}; const paid = {};
  for (const s of seats) { own[s] = []; paid[s] = {}; }
  const taken = {};
  const st = { phase: 'sealed', round: 1, commits: {}, reveals: {}, skips: {}, queue: [], auction: null, snake: null, history: [], done: false };

  const slotsLeft = (s) => squadSize - own[s].length;
  const spentOf = (s) => own[s].reduce((a, pid) => a + (paid[s][pid] || 0), 0);
  // cheapest way to fill k more slots, covering the positions the squad still needs
  const fillCost = (sq, k, exclude) => cheapestFill(prices, byId, sq, k, (id) => taken[id] || exclude.has(id), seats.length);
  const cheapest = (k, exclude, sq = []) => fillCost(sq, k, exclude);
  // the most a seat may pay now and still finish the squad with the cheapest players left
  const maxPay = (s, pid, extraBusy = []) => total - spentOf(s) - fillCost([...own[s], ...extraBusy, pid], slotsLeft(s) - 1 - extraBusy.length, new Set([pid, ...extraBusy]));
  const give = (s, pid, price, how) => {
    own[s].push(pid); paid[s][pid] = price; taken[pid] = s;
    st.history.push({ seat: s, pid, price, how, round: st.round });
  };
  const sealedActive = () => seats.filter((s) => slotsLeft(s) > 0);
  const picksAllowed = (s) => Math.min(SEALED_PICKS, slotsLeft(s));

  // valid sealed picks for a seat (unknown / taken / quota / budget problems are dropped)
  const cleanPicks = (s, list) => {
    const out = [];
    let budgetUse = 0;
    for (const pid of arr(list)) {
      if (out.length >= picksAllowed(s)) break;
      if (!byId[pid] || taken[pid] || out.includes(pid)) continue;
      if (quotaError([...own[s], ...out], byId[pid], squadSize, byId)) continue;
      const price = prices[pid] || 0;
      if (spentOf(s) + budgetUse + price + fillCost([...own[s], ...out, pid], slotsLeft(s) - out.length - 1, new Set([pid, ...out])) > total) continue;
      out.push(pid); budgetUse += price;
    }
    return out;
  };
  // automatic picks for an absent manager (best value inside the budget plan)
  const autoPicks = (s, k) => {
    const out = [];
    for (let i = 0; i < k; i++) {
      const pid = bestFor(s, out);
      if (!pid) break;
      out.push(pid);
    }
    return out;
  };
  const bestFor = (s, busy = []) => {
    const sq = [...own[s], ...busy];
    const left = squadSize - sq.length;
    if (left <= 0) return null;
    const need = unmetNeeds(sq, byId);
    const needTotal = Object.values(need).reduce((a, b) => a + b, 0);
    const money = total - spentOf(s) - busy.reduce((a, id) => a + (prices[id] || 0), 0);
    const target = (money / left) * (left > squadSize * 0.6 ? 1.8 : 1.2);
    let best = null, bv = -Infinity;
    for (const p of cfg.pool) {
      if (taken[p.id] || busy.includes(p.id)) continue;
      if (quotaError(sq, p, squadSize, byId)) continue;
      const price = prices[p.id] || 0;
      if (price + fillCost([...sq, p.id], left - 1, new Set([p.id, ...busy])) > money) continue;
      let v = cfg.levelOf(p);
      if (price > target) v -= (price - target) / 8e6;
      const r = roleOf(p);
      if (need[r] > 0) v += 2 + 6 * (needTotal / Math.max(1, left));
      if (r === 'GK' && sq.filter((id) => roleOf(byId[id]) === 'GK').length >= 1) v -= 4;
      if (v > bv || (v === bv && p.id < best)) { bv = v; best = p.id; }
    }
    if (!best) best = cheapestLegal(sq);
    return best;
  };
  // last resort so the draft can never get stuck: the cheapest player the squad may take
  const cheapestLegal = (sq) => {
    let best = null, bp = Infinity;
    for (const p of cfg.pool) {
      if (taken[p.id] || sq.includes(p.id) || quotaError(sq, p, squadSize, byId)) continue;
      const pr = prices[p.id] || 0;
      if (pr < bp || (pr === bp && p.id < best)) { bp = pr; best = p.id; }
    }
    return best;
  };

  // ---------- phase transitions
  const startSealedRound = () => {
    if (st.round > (cfg.sealedRounds || 1) || !sealedActive().length) return startSnake();
    st.phase = 'sealed'; st.commits = {}; st.reveals = {}; st.skips = {};
  };
  const resolveSealed = () => {
    const wants = {}; // pid -> seats
    for (const s of seats) {
      if (slotsLeft(s) <= 0) continue;
      const list = st.skips[s] ? autoPicks(s, picksAllowed(s)) : cleanPicks(s, st.reveals[s] ? st.reveals[s].picks : []);
      st.reveals[s] = { ...(st.reveals[s] || {}), picks: list, auto: !!st.skips[s] };
      for (const pid of list) (wants[pid] = wants[pid] || []).push(s);
    }
    const ids = Object.keys(wants).sort((a, b) => (prices[b] || 0) - (prices[a] || 0) || (a < b ? -1 : 1));
    st.queue = [];
    for (const pid of ids) {
      const w = wants[pid];
      if (w.length === 1) {
        const s = w[0];
        if (slotsLeft(s) > 0 && (prices[pid] || 0) <= maxPay(s, pid)) give(s, pid, prices[pid] || 0, 'liste');
      } else st.queue.push({ pid, seats: seats.filter((s) => w.includes(s)) });
    }
    nextAuction();
  };
  const nextAuction = () => {
    while (st.queue.length) {
      const q = st.queue.shift();
      if (taken[q.pid]) continue;
      const base = prices[q.pid] || 0;
      const bidders = q.seats.filter((s) => slotsLeft(s) > 0 && base <= maxPay(s, q.pid) && !quotaError(own[s], byId[q.pid], squadSize, byId));
      if (!bidders.length) continue;
      if (bidders.length === 1) { give(bidders[0], q.pid, base, 'liste'); continue; }
      st.phase = 'auction';
      st.auction = { pid: q.pid, base, bidders, active: bidders.slice(), bid: null, leader: null, turn: bidders[0], bids: [] };
      return;
    }
    st.auction = null;
    st.round += 1;
    startSealedRound();
  };
  const advanceTurn = () => {
    const a = st.auction;
    if (a.active.length === 1) {
      const s = a.active[0];
      give(s, a.pid, a.bid != null ? a.bid : a.base, a.bid != null ? 'artırma' : 'liste');
      return nextAuction();
    }
    if (!a.active.length) return nextAuction();
    const i = a.bidders.indexOf(a.turn);
    for (let k = 1; k <= a.bidders.length; k++) {
      const s = a.bidders[(i + k) % a.bidders.length];
      if (a.active.includes(s) && s !== a.leader) { a.turn = s; return; }
    }
  };
  const startSnake = () => {
    const order = [];
    const left = Object.fromEntries(seats.map((s) => [s, slotsLeft(s)]));
    for (let r = 0; order.length < seats.reduce((a, s) => a + slotsLeft(s), 0); r++) {
      const row = r % 2 === 0 ? seats : seats.slice().reverse();
      for (const s of row) if (left[s] > 0) { order.push(s); left[s] -= 1; }
    }
    st.phase = order.length ? 'snake' : 'done';
    st.snake = { order, i: 0 };
    if (!order.length) st.done = true;
  };

  // ---------- replay the log
  startSealedRound();
  for (const e of log) {
    if (st.done) break;
    const t = e.type;
    if (st.phase === 'sealed') {
      if (e.round !== st.round || !seats.includes(e.seat) || slotsLeft(e.seat) <= 0) continue;
      const allCommitted = () => sealedActive().every((s) => st.commits[s] || st.skips[s]);
      if (t === 'commit' && !st.commits[e.seat] && !allCommitted() && typeof e.hash === 'string') st.commits[e.seat] = e.hash;
      else if (t === 'skip' && !st.reveals[e.seat]) st.skips[e.seat] = true;
      else if (t === 'reveal' && st.commits[e.seat] && !st.reveals[e.seat] && allCommitted()) {
        const picks = arr(e.picks).map(String);
        if (sealOf(st.round, e.seat, picks, String(e.salt || '')) === st.commits[e.seat]) st.reveals[e.seat] = { picks };
        else st.skips[e.seat] = true; // tampered reveal: automatic picks instead
      }
      if (allCommitted() && sealedActive().every((s) => st.reveals[s] || st.skips[s])) resolveSealed();
    } else if (st.phase === 'auction') {
      const a = st.auction;
      if (e.pid !== a.pid || e.seat !== a.turn) continue;
      if (t === 'bid') {
        const amt = Math.round(Number(e.amount));
        const min = a.bid == null ? a.base : a.bid + MIN_RAISE;
        if (!Number.isFinite(amt) || amt < min || amt > maxPay(e.seat, a.pid)) continue;
        a.bid = amt; a.leader = e.seat; a.bids.push({ seat: e.seat, amount: amt });
        advanceTurn();
      } else if (t === 'pass') {
        a.active = a.active.filter((s) => s !== e.seat);
        a.bids.push({ seat: e.seat, pass: true });
        if (a.leader == null && a.active.length === 1) a.turn = a.active[0];
        advanceTurn();
      }
    } else if (st.phase === 'snake') {
      const sn = st.snake;
      const s = sn.order[sn.i];
      if (e.seat !== s) continue;
      let pid = null;
      if (t === 'pick') {
        pid = String(e.pid);
        if (!byId[pid] || taken[pid] || quotaError(own[s], byId[pid], squadSize, byId)) continue;
        if ((prices[pid] || 0) > maxPay(s, pid) && pid !== cheapestLegal(own[s])) continue;
      } else if (t === 'skip') pid = bestFor(s);
      else continue;
      if (pid) give(s, pid, prices[pid] || 0, t === 'skip' ? 'otomatik' : 'sıralı');
      sn.i += 1;
      if (sn.i >= sn.order.length) { st.phase = 'done'; st.done = true; }
    }
  }
  if (st.phase !== 'done' && seats.every((s) => slotsLeft(s) <= 0)) { st.phase = 'done'; st.done = true; }

  const waiting = st.phase === 'sealed'
    ? sealedActive().filter((s) => !st.commits[s] && !st.skips[s]).length ? sealedActive().filter((s) => !st.commits[s] && !st.skips[s]) : sealedActive().filter((s) => !st.reveals[s] && !st.skips[s])
    : st.phase === 'auction' ? [st.auction.turn] : st.phase === 'snake' ? [st.snake.order[st.snake.i]] : [];
  return {
    ...st, own, paid, taken, waiting, logLength: log.length,
    spent: Object.fromEntries(seats.map((s) => [s, spentOf(s)])),
    left: Object.fromEntries(seats.map((s) => [s, total - spentOf(s)])),
    slots: Object.fromEntries(seats.map((s) => [s, slotsLeft(s)])),
    picksAllowed: Object.fromEntries(seats.map((s) => [s, picksAllowed(s)])),
    maxPay: (s, pid) => maxPay(s, pid),
    validSealed: (s, list) => cleanPicks(s, list),
    suggest: (s, busy = []) => bestFor(s, busy),
    sealedStep: st.phase === 'sealed' ? (sealedActive().every((s) => st.commits[s] || st.skips[s]) ? 'reveal' : 'commit') : null,
  };
}

// Final squads in snake order, ready to be written as normal draft picks.
export function finalPicks(state, order) {
  const queues = Object.fromEntries(Object.entries(state.own).map(([s, l]) => [s, l.slice()]));
  return order.map((seat) => ({ seat, pid: queues[seat].shift() }));
}
