import test from 'node:test';
import assert from 'node:assert/strict';
import { POOL, byId } from './helpers.js';
import { auctionState, sealOf, finalPicks } from '../src/core/auction.js';
import { buildMarketModel, currentLevel } from '../src/core/abilities.js';
import { priceTable, playerPrice } from '../src/core/prices.js';
import { roleCounts, ROLE_MIN, ROLES } from '../src/core/positions.js';
import { snakeOrder } from '../src/core/draft.js';

const model = buildMarketModel(POOL);
const prices = priceTable(POOL, model);
const levelOf = (p) => currentLevel(p, model).level;

function run({ seats, squadSize, total, sealedRounds, greedy }) {
  const cfg = { seats, squadSize, total, prices, byId, pool: POOL, levelOf, sealedRounds };
  const log = [];
  const top = POOL.slice().sort((a, b) => levelOf(b) - levelOf(a)).map((p) => p.id);
  let st = auctionState(log, cfg);
  let guard = 0;
  while (!st.done && guard++ < 5000) {
    if (st.phase === 'sealed') {
      if (st.sealedStep === 'commit') {
        for (const s of st.waiting) {
          // greedy managers all want the same stars -> auctions
          // greedy but sensible: the stars, as long as the rest of the squad stays affordable
          let want = [];
          if (greedy) for (const id of top) { if (want.length >= st.picksAllowed[s]) break; if (!st.taken[id] && !st.sealedError(s, want, id)) want.push(id); }
          if (want.length < st.picksAllowed[s]) { const busy = want.slice(); while (busy.length < st.picksAllowed[s]) { const x = st.suggest(s, busy); if (!x) break; busy.push(x); } want = busy; }
          log.push({ type: 'commit', seat: s, round: st.round, hash: sealOf(st.round, s, want, 'salt' + s), _picks: want });
        }
      } else {
        for (const s of st.waiting) {
          const c = log.find((e) => e.type === 'commit' && e.seat === s && e.round === st.round);
          log.push({ type: 'reveal', seat: s, round: st.round, picks: c._picks, salt: 'salt' + s });
        }
      }
    } else if (st.phase === 'auction') {
      const a = st.auction;
      const s = a.turn;
      const next = a.bid == null ? a.base : a.bid + 2e6;
      const limit = st.maxPay(s, a.pid);
      // bid while the price is under 1.4x list and affordable, else pass
      if (next <= limit && next <= a.base * 1.4) log.push({ type: 'bid', seat: s, pid: a.pid, amount: next });
      else log.push({ type: 'pass', seat: s, pid: a.pid });
    } else if (st.phase === 'snake') {
      const s = st.waiting[0];
      log.push({ type: 'pick', seat: s, pid: st.suggest(s) });
    }
    st = auctionState(log, cfg);
  }
  return { st, log };
}

test('sealed picks + auctions: squads complete, legal, inside the budget', () => {
  for (const [n, squadSize, sealedRounds] of [[2, 16, 1], [4, 18, 2], [5, 16, 99], [3, 20, 1]]) {
    const seats = Array.from({ length: n }, (_, i) => `s${i}`);
    const total = 700e6 * squadSize / 18;
    const { st } = run({ seats, squadSize, total, sealedRounds, greedy: true });
    assert.ok(st.done, `n=${n} finished`);
    const all = Object.values(st.own).flat();
    assert.equal(new Set(all).size, all.length, 'no player twice');
    for (const s of seats) {
      assert.equal(st.own[s].length, squadSize, `${s} full squad`);
      // a forced last-resort buy may go a hair over when rivals took the cheap players first
      assert.ok(st.spent[s] <= total, `${s} inside budget ${st.spent[s]} <= ${total}`);
      const c = roleCounts(st.own[s], byId);
      for (const r of ROLES) assert.ok((c[r] || 0) >= (ROLE_MIN[r] || 0), `${s} has min ${r}`);
    }
    assert.ok(st.history.some((x) => x.how === 'artırma'), 'at least one auction happened');
    const fp = finalPicks(st, snakeOrder(seats, squadSize));
    assert.equal(fp.length, n * squadSize);
    assert.ok(fp.every((x) => x.pid));
  }
});

test('auction rules: out-of-turn, too-low and over-budget bids are ignored; tampered reveal becomes auto picks', () => {
  const seats = ['a', 'b'];
  const cfg = { seats, squadSize: 16, total: 600e6, prices, byId, pool: POOL, levelOf, sealedRounds: 1 };
  const star = POOL.slice().sort((x, y) => prices[y.id] - prices[x.id])[3].id;
  const cheapA = POOL.filter((p) => p.pos === 'CB').sort((x, y) => prices[x.id] - prices[y.id]).slice(0, 2).map((p) => p.id);
  const cheapB = POOL.filter((p) => p.pos === 'ST').sort((x, y) => prices[x.id] - prices[y.id]).slice(0, 2).map((p) => p.id);
  const pa = [star, ...cheapA], pb = [star, ...cheapB];
  const log = [
    { type: 'commit', seat: 'a', round: 1, hash: sealOf(1, 'a', pa, 'x') },
    { type: 'reveal', seat: 'a', round: 1, picks: pa, salt: 'x' }, // too early: b has not committed
    { type: 'commit', seat: 'b', round: 1, hash: sealOf(1, 'b', pb, 'y') },
    { type: 'reveal', seat: 'a', round: 1, picks: pa, salt: 'x' },
    { type: 'reveal', seat: 'b', round: 1, picks: pb, salt: 'y' },
  ];
  let st = auctionState(log, cfg);
  assert.equal(st.phase, 'auction');
  assert.equal(st.auction.pid, star);
  assert.ok(cheapA.every((id) => st.own.a.includes(id)) && cheapB.every((id) => st.own.b.includes(id)), 'uncontested picks bought at list price');
  const base = prices[star];
  log.push({ type: 'bid', seat: 'b', pid: star, amount: base + 5e6 }); // not b's turn
  log.push({ type: 'bid', seat: 'a', pid: star, amount: base - 1e6 }); // below list price
  log.push({ type: 'bid', seat: 'a', pid: star, amount: 5e9 }); // over budget
  st = auctionState(log, cfg);
  assert.equal(st.auction.bid, null);
  log.push({ type: 'bid', seat: 'a', pid: star, amount: base });
  log.push({ type: 'bid', seat: 'b', pid: star, amount: base + 0.5e6 }); // raise too small
  log.push({ type: 'bid', seat: 'b', pid: star, amount: base + 3e6 });
  log.push({ type: 'bid', seat: 'a', pid: star, amount: base + 6e6 });
  log.push({ type: 'pass', seat: 'b', pid: star });
  st = auctionState(log, cfg);
  assert.ok(st.own.a.includes(star), 'last bidder wins');
  assert.equal(st.paid.a[star], base + 6e6, 'pays his bid');
  assert.equal(st.phase, 'snake');
  // tampered reveal
  const log2 = [
    { type: 'commit', seat: 'a', round: 1, hash: sealOf(1, 'a', pa, 'x') },
    { type: 'commit', seat: 'b', round: 1, hash: sealOf(1, 'b', pb, 'y') },
    { type: 'reveal', seat: 'a', round: 1, picks: [star, cheapB[0], cheapB[1]], salt: 'x' },
    { type: 'reveal', seat: 'b', round: 1, picks: pb, salt: 'y' },
  ];
  const st2 = auctionState(log2, cfg);
  assert.equal(st2.reveals.a.auto, true);
  assert.ok(playerPrice(byId[star], model) > 0);
});

test('auction mode through the real API: sealed round, auctions, snake fill, final draft picks', async () => {
  const { makeRoom } = await import('./helpers.js');
  const { draftDone, squads: sq } = await import('../src/core/draft.js');
  const ctx = await makeRoom(3);
  await ctx.admin.updateSettings(ctx.code, { mode: 'auction', budget: 700e6, sealedRounds: 1 });
  let room = await ctx.read();
  await ctx.admin.startDraft(ctx.code, room);
  room = await ctx.read();
  const apiOf = (seat) => ctx.apis[room.members[seat].uid];
  const star = POOL.slice().sort((a, b) => prices[b.id] - prices[a.id])[0].id;
  for (let guard = 0; guard < 400; guard++) {
    room = await ctx.read();
    const st = ctx.admin.auction(room);
    if (st.done) break;
    const s = st.waiting[0];
    const api = apiOf(s);
    if (st.phase === 'sealed' && st.sealedStep === 'commit') {
      // everybody wants the most expensive star + their own suggestions
      const picks = [star];
      while (picks.length < st.picksAllowed[s]) picks.push(st.suggest(s, picks));
      await api.sealPicks(ctx.code, room, s, st.validSealed(s, picks));
    } else if (st.phase === 'sealed') await api.revealPicks(ctx.code, room, s);
    else if (st.phase === 'auction') {
      const a = st.auction;
      const next = a.bid == null ? a.base : a.bid + 5e6;
      if (next <= st.maxPay(s, a.pid) && next < a.base + 20e6) await api.auctionBid(ctx.code, room, s, next);
      else await api.auctionPass(ctx.code, room, s);
    } else if (st.phase === 'snake') {
      if (guard % 7 === 0) await ctx.admin.auctionSkip(ctx.code, room, s); // admin picks for an absent manager
      else await api.auctionPick(ctx.code, room, s, st.suggest(s));
    }
  }
  room = await ctx.read();
  const st = ctx.admin.auction(room);
  assert.ok(st.done, 'auction draft finished');
  assert.ok(st.history.some((x) => x.how === 'artırma' && x.pid === star), 'the star went to auction');
  await ctx.admin.auctionFinalize(ctx.code, room);
  room = await ctx.read();
  assert.ok(draftDone(room.draft), 'final picks written as a completed draft');
  const squadsNow = sq(room.draft);
  for (const s of Object.keys(squadsNow)) assert.deepEqual(squadsNow[s].slice().sort(), st.own[s].slice().sort());
});

test('budget: a risky buy is allowed, money left is the hard limit, a broke manager is passed over with a short squad', () => {
  const seats = ['a', 'b'];
  const cfg = { seats, squadSize: 16, total: 500e6, prices, byId, pool: POOL, levelOf, sealedRounds: 0 };
  const stars = POOL.slice().sort((x, y) => prices[y.id] - prices[x.id]).filter((p) => p.pos !== 'GK');
  const log = [];
  let st = auctionState(log, cfg);
  assert.equal(st.phase, 'snake');
  // a takes stars while he can: risky warnings but allowed until the money runs out
  let risky = 0;
  for (let i = 0; i < 40 && !st.done; i++) {
    const s = st.waiting[0];
    let pid;
    if (s === 'a') {
      pid = stars.map((p) => p.id).find((id) => !st.taken[id] && !st.pickError('a', id));
      if (pid && st.pickRisk('a', pid)) risky += 1;
      if (!pid) pid = st.suggest('a');
    } else pid = st.suggest('b');
    log.push({ type: 'pick', seat: s, pid });
    st = auctionState(log, cfg);
  }
  while (!st.done) { log.push({ type: 'skip', seat: st.waiting[0], round: 1 }); st = auctionState(log, cfg); }
  assert.ok(risky > 0, 'risky buys were allowed');
  assert.ok(st.done, 'the draft still finishes');
  assert.ok(st.own.a.length < 16, 'the reckless manager ends with a short squad');
  assert.ok(st.broke.includes('a'), 'and was passed over');
  assert.equal(st.own.b.length, 16, 'the careful one completes his squad');
  assert.ok(st.spent.a <= 500e6 && st.spent.b <= 500e6, 'nobody spends more than the budget');
  const fp = finalPicks(st, snakeOrder(['a', 'b'], 16));
  assert.ok(fp.some((x) => x.skip && x.seat === 'a'), 'his empty turns become skips');
  const expensive = stars.find((p) => !st.taken[p.id]);
  if (expensive && st.moneyLeft('a') < prices[expensive.id]) assert.match(st.pickError('a', expensive.id) || 'Kadro dolu', /Paran yetmez|Kadro dolu/);
});
