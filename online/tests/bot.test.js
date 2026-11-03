// Bot managers: added by the admin, played by the admin's device through the real API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRoom, byId, POOL } from './helpers.js';
import { draftDone, squads, budgetState } from '../src/core/draft.js';
import { quotaError, roleCounts, ROLES, ROLE_MIN } from '../src/core/positions.js';
import { botSeats, botTactics, matchupModel, expectedPoints } from '../src/core/bot.js';
import { isAvailable, lineupError } from '../src/core/lineup.js';
import { formationSlots } from '../src/core/positions.js';

async function roomWithBots(nHumans, levels, opts = {}) {
  const ctx = await makeRoom(nHumans, { squadSize: 16, ...opts });
  if (opts.mode) await ctx.admin.updateSettings(ctx.code, { mode: opts.mode, budget: 700e6, sealedRounds: 1 });
  for (const l of levels) await ctx.admin.addBot(ctx.code, await ctx.read(), l);
  return ctx;
}
// drive the draft: bots via botStep, humans with the app's automatic pick
async function runDraft(ctx) {
  let room = await ctx.read();
  await ctx.admin.startDraft(ctx.code, room);
  for (let i = 0; i < 3000; i++) {
    room = await ctx.read();
    if (draftDone(room.draft)) break;
    if (await ctx.admin.botStep(ctx.code, room)) continue;
    if (room.public.mode === 'auction') {
      const st = ctx.admin.auction(room);
      if (st.done) { await ctx.admin.auctionFinalize(ctx.code, room); continue; }
      for (const s of st.waiting) await ctx.admin.auctionSkip(ctx.code, room, s);
    } else await ctx.admin.autoPick(ctx.code, room);
  }
  return ctx.read();
}
function squadOk(ids) {
  const c = roleCounts(ids, byId);
  return ROLES.every((r) => c[r] >= ROLE_MIN[r]) && c.GK <= 3;
}

test('admin adds bots in the lobby only; the room limit counts them', async () => {
  const ctx = await makeRoom(2);
  const room = await ctx.read();
  // only the admin can (the server rules check it too)
  const seat = await ctx.admin.addBot(ctx.code, room, 'hard');
  let r = await ctx.read();
  assert.equal(r.members[seat].bot, true);
  assert.equal(r.members[seat].botLevel, 'hard');
  assert.deepEqual(botSeats(r), [seat]);
  const s2 = await ctx.admin.addBot(ctx.code, r, 'easy');
  r = await ctx.read();
  assert.notEqual(r.members[s2].team, r.members[seat].team, 'every bot gets its own team name');
  await ctx.admin.setBotLevel(ctx.code, r, s2, 'normal');
  assert.equal((await ctx.read()).members[s2].botLevel, 'normal');
  for (let i = 0; i < 6; i++) await ctx.admin.addBot(ctx.code, await ctx.read(), 'easy');
  await assert.rejects(ctx.admin.addBot(ctx.code, await ctx.read(), 'easy'), /En fazla/);
  await ctx.admin.kick(ctx.code, await ctx.read(), seat);
  assert.ok(!(await ctx.read()).members[seat]);
  await ctx.admin.startDraft(ctx.code, await ctx.read());
  await assert.rejects(ctx.admin.addBot(ctx.code, await ctx.read(), 'hard'), /lobide/);
});

test('classic draft with bots: legal squads, bots set up their team and say ready, tactics follow the week', async () => {
  const ctx = await roomWithBots(1, ['hard', 'normal', 'easy']);
  let room = await runDraft(ctx);
  const sq = squads(room.draft);
  for (const [s, ids] of Object.entries(sq)) {
    assert.equal(ids.length, 16, `${s} has a full squad`);
    assert.ok(squadOk(ids), `${s} meets the position quotas`);
  }
  // prep: every bot saves tactics and says ready
  for (let i = 0; i < 10; i++) { room = await ctx.read(); if (!(await ctx.admin.botStep(ctx.code, room))) break; }
  room = await ctx.read();
  for (const b of botSeats(room)) { assert.ok(room.tactics[b], 'bot tactics saved'); assert.equal(room.ready[b], true); }
  await ctx.admin.setReady(ctx.code, room.public.adminSeat, true);
  await ctx.admin.startSeason(ctx.code, await ctx.read());
  // the week is played with tactics made for this week's opponent
  room = await ctx.read();
  await ctx.admin.playWeek(ctx.code, room);
  room = await ctx.read();
  const played = Object.values(room.season.matches);
  assert.ok(played.length >= 1);
  for (const b of botSeats(room)) {
    const inWeek1 = played.some((m) => m.home === b || m.away === b);
    if (inWeek1) assert.equal(room.tactics[b].botWeek, 1);
  }
  // week 2: stale until the admin device refreshes them
  assert.ok(botSeats(room).some((b) => ctx.admin.botStale(room, b)));
  for (let i = 0; i < 10; i++) { room = await ctx.read(); if (!(await ctx.admin.botStep(ctx.code, room))) break; }
  room = await ctx.read();
  for (const b of botSeats(room)) assert.ok(!ctx.admin.botStale(room, b));
});

test('budget draft with bots: nobody overspends, bots fill their squads', async () => {
  const ctx = await roomWithBots(1, ['hard', 'hard', 'normal'], { mode: 'budget' });
  const room = await runDraft(ctx);
  const b = ctx.admin.budget(room);
  for (const s of botSeats(room)) {
    const st = budgetState(room.draft, s, 16, b);
    assert.ok(st.left >= 0, 'money left is never negative');
    assert.equal(squads(room.draft)[s].length, 16, 'the bot planned its money and filled the squad');
    assert.ok(squadOk(squads(room.draft)[s]));
  }
});

test('auction draft with bots: sealed picks, bids within the money, the draft completes', async () => {
  const ctx = await roomWithBots(1, ['hard', 'normal'], { mode: 'auction' });
  let room = await ctx.read();
  await ctx.admin.startDraft(ctx.code, room);
  for (let i = 0; i < 3000; i++) {
    room = await ctx.read();
    if (draftDone(room.draft)) break;
    const st = ctx.admin.auction(room);
    if (st.done) { await ctx.admin.auctionFinalize(ctx.code, room); continue; }
    if (st.phase === 'auction' && botSeats(room).includes(st.auction.turn)) {
      const s = st.auction.turn;
      await ctx.admin.botStep(ctx.code, room);
      const after = ctx.admin.auction(await ctx.read());
      assert.ok(after.left[s] >= 0, 'a bot never bids more than it has');
      continue;
    }
    if (await ctx.admin.botStep(ctx.code, room)) continue;
    for (const s of st.waiting) await ctx.admin.auctionSkip(ctx.code, room, s);
  }
  room = await ctx.read();
  assert.ok(draftDone(room.draft));
  const st = ctx.admin.auction(room);
  for (const s of botSeats(room)) { assert.ok(st.left[s] >= 0); assert.equal(st.own[s].length, 16); }
});

test('a hard bot drafts a stronger squad than the automatic pick', async () => {
  const ctx = await roomWithBots(3, ['hard']);
  const room = await runDraft(ctx);
  const brain = ctx.admin.brain();
  const sq = squads(room.draft);
  const bot = botSeats(room)[0];
  const others = Object.keys(sq).filter((s) => s !== bot).map((s) => brain.value(sq[s]).value);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  assert.ok(brain.value(sq[bot]).value > avg, `bot ${brain.value(sq[bot]).value.toFixed(0)} vs others ${avg.toFixed(0)}`);
});

test('bot tactics: valid for the server, unavailable and worn-out players rested', async () => {
  const ctx = await makeRoom(2);
  const brain = ctx.admin.brain();
  const sorted = POOL.slice().sort((a, b) => brain.lv(b.id) - brain.lv(a.id));
  const squad = [];
  for (const p of sorted) {
    if (squad.length >= 18) break;
    if (!quotaError(squad, p, 18, byId)) squad.push(p.id);
  }
  const xi0 = botTactics({ brain, squad, level: 'hard' }).lineup;
  const state = {};
  const hurt = xi0.find((id) => id && byId[id].pos !== 'GK');
  const tired = xi0.filter((id) => id && id !== hurt && byId[id].pos !== 'GK')[0];
  state[hurt] = { condition: 100, injuredWeeks: 2, banned: 0 };
  state[tired] = { condition: 35, injuredWeeks: 0, banned: 0 };
  for (const level of ['easy', 'normal', 'hard']) {
    const t = botTactics({ brain, squad, state, level });
    assert.equal(t.lineup.length, formationSlots(t.formation).length);
    assert.equal(lineupError(t.lineup, t.formation, squad, {}), null, `${level}: structure is valid`);
    assert.ok(!t.lineup.includes(hurt), `${level}: injured player not in the XI`);
    assert.ok(t.lineup.every((id) => !id || isAvailable(state[id])));
    if (level !== 'easy') assert.ok(!t.lineup.includes(tired), `${level}: a player at 35% condition is rested`);
  }
});

test('match model: a stronger team expects more points, home advantage counts', () => {
  assert.ok(Math.abs(expectedPoints(1.3, 1.3) - expectedPoints(1.3, 1.3)) < 1e-12);
  assert.ok(expectedPoints(2, 1) > expectedPoints(1, 2));
  const pl = (ids) => Object.fromEntries(ids.map((id) => [id, { ...byId[id], level: byId[id].ovr, condition: 100 }]));
  const sorted = POOL.slice().sort((a, b) => b.ovr - a.ovr);
  const xi = (from) => {
    const slots = formationSlots('4-3-3');
    const used = new Set();
    return slots.map((s) => { const p = from.find((x) => !used.has(x.id) && (s.code === 'GK') === (x.pos === 'GK')); used.add(p.id); return p.id; });
  };
  const strong = xi(sorted), weak = xi(sorted.slice().reverse());
  const side = (ids) => ({ slots: formationSlots('4-3-3').map((s) => ({ ...s, role: null, shift: 0 })), lineup: ids, players: pl(ids), ins: {} });
  const m = matchupModel(side(strong), side(weak), true);
  assert.ok(m.la > m.lb && m.ep > 2, `strong ${m.la.toFixed(2)} - weak ${m.lb.toFixed(2)}, ep ${m.ep.toFixed(2)}`);
  const home = matchupModel(side(strong), side(strong), true), away = matchupModel(side(strong), side(strong), false);
  assert.ok(home.ep > away.ep);
});
