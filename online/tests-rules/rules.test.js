// Security rules tests against the Firebase Realtime Database emulator.
// Runs the real client API (src/backend/api.js) as different users.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { createApi, roomKey } from '../src/backend/api.js';
import { onClock } from '../src/core/draft.js';

const POOL = (await import(process.env.POOL || '../data/players.js').catch(() => import('../tests/fixture-old-pool.js'))).PLAYERS;
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-draft-arena',
    database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9000 },
  });
});
after(async () => { if (env) await env.cleanup(); });

function client(uid) {
  const ctx = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext();
  const db = ctx.database();
  return {
    kind: 'test', uid,
    async signIn() { return uid; },
    async get(path) { const s = await db.ref(path).get(); return s.exists() ? s.val() : null; },
    async update(u) { return db.ref().update(u); },
    async set(path, v) { return db.ref().update({ [path]: v }); },
    onValue(path, cb) { const r = db.ref(path); const h = (s) => cb(s.val()); r.on('value', h); return () => r.off('value', h); },
    serverTime: () => Date.now(),
    onDisconnectRemove() {},
  };
}
const apiFor = (uid) => createApi(client(uid), POOL);
const denied = async (p) => { await assert.rejects(p, (e) => /permission|PERMISSION|denied|reddedildi|yanlış/i.test(String(e && e.message))); };

async function roomOf(api, code) {
  const db = api.db;
  const parts = ['public', 'members', 'uids', 'draft', 'tactics', 'ready', 'season'];
  const room = { code };
  for (const p of parts) room[p] = await db.get(`rooms/${code}/${p}`);
  return room;
}

test('create, join with password, lobby rules', async () => {
  await env.clearDatabase();
  const admin = apiFor('alice');
  const { code } = await admin.createRoom({ roomName: 'Test', password: 'gizli123', name: 'Alice', team: 'A FC', squadSize: 16 });
  // anyone signed in can see the public card, nobody can read the secret
  const bob = apiFor('bob');
  assert.equal((await bob.roomPublic(code)).name, 'Test');
  await denied(bob.db.get(`rooms/${code}/secret`));
  await denied(admin.db.get(`rooms/${code}/secret`));
  await denied(bob.db.get(`rooms/${code}/members`));
  // wrong password
  await denied(bob.joinRoom({ code, password: 'yanlis', name: 'Bob' }));
  await bob.joinRoom({ code, password: 'gizli123', name: 'Bob', team: 'B FC' });
  assert.ok(await bob.db.get(`rooms/${code}/members/bob`));
  // a member cannot change someone else's profile or become admin
  await denied(bob.db.update({ [`rooms/${code}/members/alice/name`]: 'hack' }));
  await denied(bob.db.update({ [`rooms/${code}/public/adminSeat`]: 'bob' }));
  await denied(bob.db.update({ [`rooms/${code}/public/status`]: 'draft' }));
  // league format: only the admin, only 1-4 legs
  await denied(bob.db.update({ [`rooms/${code}/public/legs`]: 1 }));
  await admin.updateSettings(code, { legs: 3 });
  assert.equal((await bob.roomPublic(code)).legs, 3);
  await admin.updateSettings(code, { legs: 8 });
  assert.equal((await bob.roomPublic(code)).legs, 8);
  await denied(admin.db.update({ [`rooms/${code}/public/legs`]: 9 }));
  // joining as somebody else's uid is impossible
  const eve = apiFor('eve');
  const key = await roomKey(code, 'gizli123');
  await denied(eve.db.update({ [`rooms/${code}/members/mallory`]: { uid: 'mallory', name: 'x', team: 'x', key }, [`rooms/${code}/uids/mallory`]: 'mallory' }));
  // unauthenticated users can do nothing
  await denied(createApi(client(null), POOL).db.get(`rooms/${code}/public`));
});

test('draft: only the manager on the clock (or admin) picks, no duplicates, league only after draft', async () => {
  await env.clearDatabase();
  const a = apiFor('alice'), b = apiFor('bob'), c = apiFor('carol');
  const byUid = { alice: a, bob: b, carol: c };
  const { code } = await a.createRoom({ roomName: 'Draft', password: 'pass1234', name: 'Alice', squadSize: 16 });
  await b.joinRoom({ code, password: 'pass1234', name: 'Bob' });
  await c.joinRoom({ code, password: 'pass1234', name: 'Carol' });
  await denied(b.startDraft(code, await roomOf(b, code)));
  await a.startDraft(code, await roomOf(a, code));
  let room = await roomOf(a, code);
  assert.equal(room.public.status, 'draft');
  const first = onClock(room.draft);
  // a non-admin manager who is not on the clock (the admin may pick for absent managers by design)
  const waitingSeat = ['bob', 'carol'].find((s) => s !== first);
  const waiting = byUid[waitingSeat];
  const onTurn = byUid[first];
  const pid = onTurn.suggest(room, first);
  // the other manager cannot pick (client check and server rule)
  await assert.rejects(waiting.makePick(code, room, waitingSeat, pid));
  await denied(waiting.db.update({
    [`rooms/${code}/draft/picks/0`]: { seat: first, pid },
    [`rooms/${code}/draft/taken/${pid}`]: first,
    [`rooms/${code}/draft/current`]: 1,
  }));
  await onTurn.makePick(code, room, first, pid);
  room = await roomOf(a, code);
  // same player twice / skipping ahead is rejected by the server
  const second = onClock(room.draft);
  const secondApi = byUid[second];
  await denied(secondApi.db.update({
    [`rooms/${code}/draft/picks/1`]: { seat: second, pid },
    [`rooms/${code}/draft/taken/${pid}`]: second,
    [`rooms/${code}/draft/current`]: 2,
  }));
  await denied(secondApi.db.update({ [`rooms/${code}/draft/current`]: 5 }));
  // season cannot start before the draft is complete
  await denied(a.db.update({ [`rooms/${code}/season`]: { currentWeek: 1, schedule: [{ week: 1 }] }, [`rooms/${code}/public/status`]: 'season' }));
  // finish the draft: each pick made by the right person, a few by the admin for absent bob
  let i = 0;
  while (true) {
    room = await roomOf(a, code);
    const seat = onClock(room.draft);
    if (!seat) break;
    const actor = seat === 'alice' ? a : (i++ % 5 === 0 ? a : byUid[seat]);
    await actor.makePick(code, room, seat, actor.suggest(room, seat));
  }
  room = await roomOf(a, code);
  assert.equal(room.draft.current, 48);
  // tactics: only for your own seat
  await denied(b.db.update({ [`rooms/${code}/tactics/alice`]: { formation: '4-4-2' } }));
  await b.db.update({ [`rooms/${code}/tactics/bob`]: { formation: '4-4-2' } });
  await b.setReady(code, 'bob', true);
  await c.setReady(code, 'carol', true);
  await denied(b.db.update({ [`rooms/${code}/ready/carol`]: false }));
  await a.setReady(code, 'alice', true);
  room = await roomOf(a, code);
  await denied(b.startSeason(code, room));
  await a.startSeason(code, room);
  room = await roomOf(a, code);
  assert.equal(room.public.status, 'season');
  // only the admin writes results
  await denied(b.playWeek(code, room));
  await a.playWeek(code, room);
  room = await roomOf(b, code);
  assert.equal(room.season.currentWeek, 2);
  assert.ok(await b.getLog(code, Object.keys(room.season.matches)[0]));
});

test('seat recovery: claim + admin approval, admin recovery with admin code', async () => {
  await env.clearDatabase();
  const a = apiFor('alice'), b = apiFor('bob');
  const { code, adminCode } = await a.createRoom({ roomName: 'R', password: 'pass1234', name: 'Alice', squadSize: 16 });
  await b.joinRoom({ code, password: 'pass1234', name: 'Bob' });
  await a.startDraft(code, await roomOf(a, code));
  // bob loses his phone; new device "bob2" claims the seat
  const b2 = apiFor('bob2');
  await denied(b2.claimSeat(code, 'wrong-pass', 'Bob FC'));
  await b2.claimSeat(code, 'pass1234', 'Bob FC');
  await a.approveClaim(code, await roomOf(a, code), 'bob', 'bob2');
  const room = await roomOf(b2, code);
  assert.equal(room.members.bob.uid, 'bob2');
  // old device lost control of the seat
  await denied(b.db.update({ [`rooms/${code}/tactics/bob`]: { formation: '4-4-2' } }));
  await b2.db.update({ [`rooms/${code}/tactics/bob`]: { formation: '4-4-2' } });
  // admin recovery
  const a2 = apiFor('alice2');
  await denied(a2.reclaimAdmin(code, 'WRONGCODE'));
  await a2.reclaimAdmin(code, adminCode);
  const r2 = await roomOf(a2, code);
  assert.equal(r2.members.alice.uid, 'alice2');
  await denied(a.db.update({ [`rooms/${code}/public/name`]: 'old admin' }));
  await a2.updateSettings(code, { name: 'Yeni ad' });
});

test('after a finished season: only the admin can start a new season or a fresh draft', async () => {
  await env.clearDatabase();
  const a = apiFor('alice'), b = apiFor('bob');
  const { code } = await a.createRoom({ roomName: 'Again', password: 'pass1234', name: 'Alice', squadSize: 16 });
  await b.joinRoom({ code, password: 'pass1234', name: 'Bob' });
  await a.startDraft(code, await roomOf(a, code));
  let room;
  while (true) {
    room = await roomOf(a, code);
    const seat = onClock(room.draft);
    if (!seat) break;
    await a.makePick(code, room, seat, a.suggest(room, seat));
  }
  await a.setReady(code, 'alice', true); await b.setReady(code, 'bob', true);
  await a.startSeason(code, await roomOf(a, code));
  room = await roomOf(a, code);
  // cannot redraft in the middle of a season
  await assert.rejects(a.redraft(code, room));
  while (!(room.season && room.season.finished)) { await a.playWeek(code, room); room = await roomOf(a, code); }
  room.history = await a.db.get(`rooms/${code}/history`);
  await denied(b.newSeason(code, room));
  await a.newSeason(code, room);
  room = await roomOf(a, code);
  assert.equal(room.public.status, 'season');
  assert.equal(room.season.currentWeek, 1);
  assert.ok(await b.db.get(`rooms/${code}/history/1`));
  while (!(room.season && room.season.finished)) { await a.playWeek(code, room); room = await roomOf(a, code); }
  room.history = await a.db.get(`rooms/${code}/history`);
  await denied(b.redraft(code, room));
  await a.redraft(code, room);
  room = await roomOf(a, code);
  assert.equal(room.public.status, 'lobby');
  assert.equal(room.draft, null);
  // a new draft can be started again
  await a.startDraft(code, room);
  assert.equal((await roomOf(a, code)).public.status, 'draft');
});

test('auction mode: append-only log, own seat only (admin may act for absent managers), final picks', async () => {
  await env.clearDatabase();
  const a = apiFor('alice'), b = apiFor('bob');
  const { code } = await a.createRoom({ roomName: 'Auc', password: 'pass1234', name: 'Alice', squadSize: 16, mode: 'auction', budget: 700e6, sealedRounds: 1 });
  await b.joinRoom({ code, password: 'pass1234', name: 'Bob' });
  // nobody can write the log before the draft starts
  await denied(b.db.update({ [`rooms/${code}/auction/log/0`]: { type: 'skip', seat: 'bob', round: 1, by: 'bob' } }));
  await a.startDraft(code, await roomOf(a, code));
  const read = async () => ({ ...(await roomOf(a, code)), auction: await a.db.get(`rooms/${code}/auction`) });
  let room = await read();
  // bob cannot act for alice, and cannot pretend to be someone else in "by"
  await denied(b.db.update({ [`rooms/${code}/auction/log/0`]: { type: 'skip', seat: 'alice', round: 1, by: 'bob' } }));
  await denied(b.db.update({ [`rooms/${code}/auction/log/0`]: { type: 'skip', seat: 'bob', round: 1, by: 'alice' } }));
  const st = a.auction(room);
  const pb = st.validSealed('bob', [st.suggest('bob')]);
  await b.sealPicks(code, room, 'bob', pb);
  // log entries cannot be rewritten
  await denied(b.db.update({ [`rooms/${code}/auction/log/0`]: { type: 'commit', seat: 'bob', round: 1, hash: 'x', by: 'bob' } }));
  // admin may decide for an absent manager
  room = await read();
  await a.auctionSkip(code, room, 'alice');
  room = await read();
  await b.revealPicks(code, room, 'bob');
  for (let i = 0; i < 80; i++) {
    room = await read();
    const s2 = a.auction(room);
    if (s2.done) break;
    await a.auctionSkip(code, room, s2.waiting[0]);
  }
  room = await read();
  assert.ok(a.auction(room).done);
  await a.auctionFinalize(code, room);
  room = await read();
  assert.equal(room.draft.current, room.draft.total);
});

test('transfers: only your own offers, only the other side answers, nothing can be rewritten', async () => {
  await env.clearDatabase();
  const a = apiFor('alice'), b = apiFor('bob'), c = apiFor('carol');
  const { code } = await a.createRoom({ roomName: 'Tr', password: 'pass1234', name: 'Alice', squadSize: 16, legs: 2 });
  await a.updateSettings(code, { transferWindow: true });
  await b.joinRoom({ code, password: 'pass1234', name: 'Bob' });
  await c.joinRoom({ code, password: 'pass1234', name: 'Carol' });
  await a.startDraft(code, await roomOf(a, code));
  let room;
  while (true) { room = await roomOf(a, code); const seat = onClock(room.draft); if (!seat) break; await a.makePick(code, room, seat, a.suggest(room, seat)); }
  for (const [api, s] of [[a, 'alice'], [b, 'bob'], [c, 'carol']]) await api.setReady(code, s, true);
  await a.startSeason(code, await roomOf(a, code));
  const read = async () => ({ ...(await roomOf(a, code)), transfers: await a.db.get(`rooms/${code}/transfers`) });
  room = await read();
  const { windowOpen } = await import('../src/core/transfers.js');
  while (!windowOpen(room)) { await a.playWeek(code, room); room = await read(); }
  const info = b.transferInfo(room, 'bob');
  const role = (p) => (POOL.find((x) => x.id === p) || {}).pos;
  const give = info.squads.bob.find((p) => role(p) === 'ST'), want = info.squads.carol.find((p) => role(p) === 'ST');
  // bob cannot make an offer in alice's name
  await denied(b.db.update({ [`rooms/${code}/transfers/x1`]: { from: 'alice', to: 'carol', give: [give], want: [want], money: 0, week: 4, status: 'pending' } }));
  const id = await b.proposeTransfer(code, room, 'bob', { to: 'carol', give: [give], want: [want], money: 5e6 });
  room = await read();
  // alice (not involved) cannot accept, bob cannot accept his own offer, nobody can change the content
  await denied(a.db.update({ [`rooms/${code}/transfers/${id}/status`]: 'accepted' }));
  await denied(b.db.update({ [`rooms/${code}/transfers/${id}/status`]: 'accepted' }));
  await denied(c.db.update({ [`rooms/${code}/transfers/${id}/money`]: 0 }));
  await c.respondTransfer(code, room, 'carol', id, true);
  room = await read();
  assert.equal(room.transfers[id].status, 'accepted');
  await denied(b.db.update({ [`rooms/${code}/transfers/${id}/status`]: 'withdrawn' }));
});

test('budget mode: the manager on the clock may pass (skip pick); classic mode does not allow it', async () => {
  await env.clearDatabase();
  for (const mode of ['budget', 'classic']) {
    const a = apiFor('alice' + mode), b = apiFor('bob' + mode);
    const { code } = await a.createRoom({ roomName: 'Sk', password: 'pass1234', name: 'Alice', squadSize: 16, mode, budget: 700e6 });
    await b.joinRoom({ code, password: 'pass1234', name: 'Bob' });
    await a.startDraft(code, await roomOf(a, code));
    const room = await roomOf(a, code);
    const seat = onClock(room.draft);
    const api = seat === 'alice' + mode ? a : b;
    const write = api.db.update({ [`rooms/${code}/draft/picks/0`]: { seat, skip: true, at: Date.now(), by: api.db.uid }, [`rooms/${code}/draft/current`]: 1 });
    if (mode === 'budget') await write; else await denied(write);
  }
});
