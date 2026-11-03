// Bot tournament through the real API (in memory): every league has one manager of
// each kind; "human" = the app's own automatic pick and automatic line-up.
// node tools/bots.mjs [mode=classic|budget|auction] [leagues=10] [kinds=hard,normal,easy,human]
import { createMemoryHub } from '../src/backend/local.js';
import { createApi } from '../src/backend/api.js';
import { PLAYERS } from '../data/players.js';
import { draftDone, squads } from '../src/core/draft.js';
import { standings } from '../src/core/season.js';

const [mode = 'classic', leagues = '10', kindsArg = 'hard,normal,easy,human'] = process.argv.slice(2);
const kinds = kindsArg.split(',');
const agg = {};
const timing = [];
for (let L = 0; L < +leagues; L++) {
  const hub = createMemoryHub();
  const client = hub.client('u1');
  client.kind = 'test'; // no read-back delays in the auction log
  const admin = createApi(client, PLAYERS);
  const { code } = await admin.createRoom({ roomName: 'Bot Ligi', password: 'sifre123', name: 'Admin', team: 'İnsan FC', squadSize: 18, mode, budget: 900e6 });
  const read = async () => ({ ...(await hub.client('reader').get(`rooms/${code}`)), code });
  const kindOf = {};
  let room = await read();
  kindOf[room.public.adminSeat] = 'human';
  let humanTaken = kinds.indexOf('human') >= 0;
  for (const k of kinds) {
    if (k === 'human' && humanTaken) { humanTaken = false; continue; }
    const seat = await admin.addBot(code, await read(), k === 'human' ? 'easy' : k);
    kindOf[seat] = k;
  }
  if (!kinds.includes('human')) { await admin.kick(code, await read(), room.public.adminSeat); }
  await admin.startDraft(code, await read());
  for (let g = 0; g < 6000; g++) {
    room = await read();
    if (draftDone(room.draft)) break;
    const t0 = performance.now();
    if (await admin.botStep(code, room)) { timing.push(performance.now() - t0); continue; }
    if (mode === 'auction') {
      const st = admin.auction(room);
      if (st.done) { await admin.auctionFinalize(code, room); continue; }
      for (const s of st.waiting) await admin.auctionSkip(code, room, s);
    } else await admin.autoPick(code, room);
  }
  for (let i = 0; i < 30; i++) { room = await read(); if (!(await admin.botStep(code, room))) break; }
  room = await read();
  for (const s of Object.keys(room.members)) if (!room.members[s].bot) await admin.setReady(code, s, true);
  await admin.startSeason(code, await read());
  for (;;) { room = await read(); if (room.season.finished) break; await admin.playWeek(code, room); }
  room = await read();
  const brain = admin.brain();
  const sq = squads(room.draft);
  const line = [];
  for (const r of standings(room)) {
    const k = kindOf[r.seat] || '?';
    const a = agg[k] || (agg[k] = { n: 0, pts: 0, rank: 0, value: 0, gd: 0, titles: 0 });
    a.n++; a.pts += r.total; a.rank += r.rank; a.gd += r.gd; a.value += brain.value(sq[r.seat] || []).value; if (r.rank === 1) a.titles++;
    line.push(`${k}:${r.total}`);
  }
  console.log(`L${L + 1}`, line.join('  '));
}
console.log(`\n${mode}: ${leagues} leagues, bot move avg ${(timing.reduce((a, b) => a + b, 0) / Math.max(1, timing.length)).toFixed(0)} ms, max ${Math.max(...timing).toFixed(0)} ms`);
for (const [k, a] of Object.entries(agg)) console.log(k.padEnd(7), 'points', (a.pts / a.n).toFixed(1), 'rank', (a.rank / a.n).toFixed(2), 'gd', (a.gd / a.n).toFixed(1), 'titles', a.titles, 'squad value', (a.value / a.n).toFixed(0));
