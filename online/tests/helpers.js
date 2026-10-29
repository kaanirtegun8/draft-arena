import { createMemoryHub } from '../src/backend/local.js';
import { createApi } from '../src/backend/api.js';

let mod;
try { mod = await import('../data/players.js'); } catch { mod = await import('./fixture-old-pool.js'); }
export const POOL = mod.PLAYERS;
export const byId = Object.fromEntries(POOL.map((p) => [p.id, p]));
export const usingFullData = !!mod.DATA_META;

// A room with n managers driven through the real API on an in-memory backend.
export async function makeRoom(n = 4, { squadSize = 16, password = 'sifre123' } = {}) {
  const hub = createMemoryHub();
  const uids = Array.from({ length: n }, (_, i) => `u${i + 1}`);
  const apis = Object.fromEntries(uids.map((u) => [u, createApi(hub.client(u), POOL)]));
  const admin = apis.u1;
  const { code, adminCode } = await admin.createRoom({ roomName: 'Test Ligi', password, name: 'Admin', team: 'Admin FC', squadSize });
  for (const u of uids.slice(1)) await apis[u].joinRoom({ code, password, name: u, team: `${u} SK` });
  const read = async () => {
    const r = (await hub.client('reader').get(`rooms/${code}`)) || {};
    return { ...r, code };
  };
  return { hub, uids, apis, admin, code, adminCode, read };
}

export async function draftAll(ctx) {
  let room = await ctx.read();
  if (room.public.status === 'lobby') { await ctx.admin.startDraft(ctx.code, room); room = await ctx.read(); }
  const { onClock } = await import('../src/core/draft.js');
  while (onClock(room.draft)) {
    const seat = onClock(room.draft);
    const api = ctx.apis[room.members[seat].uid];
    await api.makePick(ctx.code, room, seat, api.suggest(room, seat));
    room = await ctx.read();
  }
  return room;
}

export async function startLeague(ctx) {
  let room = await draftAll(ctx);
  for (const seat of Object.keys(room.members)) await ctx.apis[room.members[seat].uid].setReady(ctx.code, seat, true);
  room = await ctx.read();
  await ctx.admin.startSeason(ctx.code, room);
  return ctx.read();
}

export async function playAll(ctx) {
  let room = await ctx.read();
  while (room.season && !room.season.finished) { await ctx.admin.playWeek(ctx.code, room); room = await ctx.read(); }
  return room;
}
