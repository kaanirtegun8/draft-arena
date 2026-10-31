// Room actions shared by the UI and tests. All writes are multi-path updates
// that the Firebase security rules (database.rules.json) re-check server side.
import { createRng, newSeed } from '../core/rng.js';
import { snakeOrder, toArray, squads, onClock, draftDone, pickError, suggestPick } from '../core/draft.js';
import { createSeason, weekUpdate, levelFn, playerStateBefore, seasonHistoryEntry } from '../core/season.js';
import { SLOT_VARIANTS, formationSlots as fSlots } from '../core/positions.js';
import { rolesFor } from '../core/roles.js';
import { lineupError } from '../core/lineup.js';
import { formationSlots, ROLES, ROLE_MIN, ROLE_LABEL, roleOf, MIN_MANAGERS, MAX_MANAGERS, SQUAD_SIZES, DEFAULT_SQUAD } from '../core/positions.js';
import { buildMarketModel } from '../core/abilities.js';
import { sanitizeRules } from '../core/rules.js';
import { legsOf, DEFAULT_LEGS } from '../core/schedule.js';

export const COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#4361ee', '#9b5de5', '#ffbe0b', '#06d6a0', '#ff5d8f', '#8ecae6', '#bc6c25'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function roomKey(code, password) { return sha256(`draft-arena:${code}:${password}`); }

function randomCode(n) {
  let s = '';
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  for (let i = 0; i < n; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
  return s;
}

// Can the pool give every manager the minimum of each role?
export function poolCheck(pool, managers, squadSize) {
  const counts = {};
  for (const r of ROLES) counts[r] = 0;
  for (const p of pool) counts[roleOf(p)] += 1;
  const problems = [];
  for (const r of ROLES) if (counts[r] < ROLE_MIN[r] * managers) problems.push(`${ROLE_LABEL[r]}: havuzda ${counts[r]}, gereken ${ROLE_MIN[r] * managers}`);
  if (pool.length < managers * squadSize * 1.15) problems.push(`Havuz küçük: ${pool.length} oyuncu, ${managers} menajer × ${squadSize} için en az ${Math.ceil(managers * squadSize * 1.15)} önerilir`);
  return problems;
}

export function createApi(db, pool) {
  const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
  const model = buildMarketModel(pool);
  const R = (code, path = '') => `rooms/${code}${path ? '/' + path : ''}`;
  const levelOf = levelFn(model);
  // Demo/local mode has no server rules: check room secrets on the client instead.
  const localSecretCheck = async (code, field, value, msg) => {
    if (db.kind !== 'local') return;
    const sec = await db.get(R(code, 'secret'));
    if (!sec || sec[field] !== value) throw new Error(msg);
  };

  const api = {
    db, pool, byId, model, levelOf,
    get uid() { return db.uid; },

    async createRoom({ roomName, password, name, team, squadSize = DEFAULT_SQUAD, pickSeconds = 0, legs = DEFAULT_LEGS }) {
      if (!password || password.length < 4) throw new Error('Şifre en az 4 karakter olmalı.');
      if (!name) throw new Error('Adını yaz.');
      const uid = await db.signIn();
      let code = null;
      for (let i = 0; i < 5 && !code; i++) {
        const c = randomCode(6);
        if (!(await db.get(R(c, 'public')))) code = c;
      }
      if (!code) throw new Error('Oda kodu üretilemedi, tekrar dene.');
      const key = await roomKey(code, password);
      const adminCode = randomCode(8);
      await db.update({
        [R(code, 'public')]: {
          name: (roomName || 'Draft Arena Ligi').slice(0, 40), adminSeat: uid, status: 'lobby', createdAt: db.serverTime(),
          squadSize: SQUAD_SIZES.includes(squadSize) ? squadSize : DEFAULT_SQUAD, pickSeconds: Number(pickSeconds) || 0, legs: legsOf(legs), version: 2,
        },
        [R(code, 'secret')]: { key, adminCode },
        [R(code, `members/${uid}`)]: { uid, name: name.slice(0, 24), team: (team || `${name} FC`).slice(0, 28), color: COLORS[0], joinedAt: db.serverTime(), key },
        [R(code, `uids/${uid}`)]: uid,
      });
      return { code, adminCode };
    },

    async roomPublic(code) { return db.get(R(code.toUpperCase(), 'public')); },

    async joinRoom({ code, password, name, team }) {
      code = (code || '').trim().toUpperCase();
      const uid = await db.signIn();
      const pub = await db.get(R(code, 'public'));
      if (!pub) throw new Error('Oda bulunamadı. Kodu kontrol et.');
      const key = await roomKey(code, password || '');
      const me = await db.get(R(code, `uids/${uid}`)).catch(() => null);
      if (me) return { code, rejoined: true };
      if (pub.status !== 'lobby') throw new Error('Draft başladı; yeni oyuncu katılamaz. Daha önce katıldıysan "Koltuğumu geri al" seçeneğini kullan.');
      await localSecretCheck(code, 'key', key, 'Şifre yanlış.');
      const color = COLORS[(Math.abs(hashCode(uid)) % (COLORS.length - 1)) + 1];
      try {
        await db.update({
          [R(code, `members/${uid}`)]: { uid, name: (name || 'Menajer').slice(0, 24), team: (team || `${name} FC`).slice(0, 28), color, joinedAt: db.serverTime(), key },
          [R(code, `uids/${uid}`)]: uid,
        });
      } catch (e) {
        throw new Error(/permission|PERMISSION/i.test(String(e.message)) ? 'Şifre yanlış.' : e.message);
      }
      return { code };
    },

    async updateProfile(code, seat, { name, team }) {
      const up = {};
      if (name) up[R(code, `members/${seat}/name`)] = name.slice(0, 24);
      if (team) up[R(code, `members/${seat}/team`)] = team.slice(0, 28);
      await db.update(up);
    },

    async kick(code, room, seat) {
      const m = room.members[seat];
      await db.update({ [R(code, `members/${seat}`)]: null, [R(code, `uids/${m ? m.uid : seat}`)]: null, [R(code, `tactics/${seat}`)]: null, [R(code, `ready/${seat}`)]: null });
    },

    async updateSettings(code, { squadSize, pickSeconds, name, legs }) {
      const up = {};
      if (legs != null) up[R(code, 'public/legs')] = legsOf(legs);
      if (squadSize && SQUAD_SIZES.includes(squadSize)) up[R(code, 'public/squadSize')] = squadSize;
      if (pickSeconds != null) up[R(code, 'public/pickSeconds')] = Number(pickSeconds) || 0;
      if (name) up[R(code, 'public/name')] = name.slice(0, 40);
      await db.update(up);
    },

    // seat recovery when a phone loses its anonymous login
    async claimSeat(code, password, note) {
      const uid = await db.signIn();
      code = code.trim().toUpperCase();
      const key = await roomKey(code, password);
      await localSecretCheck(code, 'key', key, 'Oda kodu veya şifre yanlış.');
      try {
        await db.update({ [R(code, `claims/${uid}`)]: { uid, key, note: (note || '').slice(0, 40) || 'Koltuğumu geri istiyorum', at: db.serverTime() } });
      } catch (e) {
        throw new Error(/permission/i.test(String(e.message)) ? 'Oda kodu veya şifre yanlış.' : e.message);
      }
    },
    async rejectClaim(code, claimUid) { await db.update({ [R(code, `claims/${claimUid}`)]: null }); },
    async approveClaim(code, room, seat, newUid) {
      const old = room.members[seat] && room.members[seat].uid;
      const up = { [R(code, `members/${seat}/uid`)]: newUid, [R(code, `uids/${newUid}`)]: seat, [R(code, `claims/${newUid}`)]: null };
      if (old && old !== newUid) up[R(code, `uids/${old}`)] = null;
      await db.update(up);
    },
    async reclaimAdmin(code, adminCode) {
      const uid = await db.signIn();
      const pub = await db.get(R(code, 'public'));
      if (!pub) throw new Error('Oda bulunamadı.');
      await localSecretCheck(code, 'adminCode', adminCode, 'Admin kodu yanlış.');
      try {
        await db.update({ [R(code, `adminClaims/${uid}`)]: adminCode, [R(code, `uids/${uid}`)]: pub.adminSeat, [R(code, `members/${pub.adminSeat}/uid`)]: uid });
      } catch (e) {
        throw new Error(/permission/i.test(String(e.message)) ? 'Admin kodu yanlış.' : e.message);
      }
    },

    async startDraft(code, room) {
      const seats = Object.keys(room.members || {});
      if (seats.length < MIN_MANAGERS) throw new Error(`En az ${MIN_MANAGERS} menajer gerekli.`);
      if (seats.length > MAX_MANAGERS) throw new Error(`En fazla ${MAX_MANAGERS} menajer olabilir; fazlaları odadan çıkar.`);
      const squadSize = room.public.squadSize || DEFAULT_SQUAD;
      const problems = poolCheck(pool, seats.length, squadSize);
      if (problems.length) throw new Error('Oyuncu havuzu yetersiz: ' + problems.join('; '));
      const seed = newSeed();
      const firstRound = createRng(`${seed}|order`).shuffle(seats.sort());
      const order = snakeOrder(firstRound, squadSize);
      await db.update({
        [R(code, 'draft/seed')]: seed,
        [R(code, 'draft/firstRound')]: firstRound,
        [R(code, 'draft/order')]: order,
        [R(code, 'draft/total')]: order.length,
        [R(code, 'draft/current')]: 0,
        [R(code, 'draft/startedAt')]: db.serverTime(),
        [R(code, 'public/status')]: 'draft',
      });
    },

    // seat = the seat on the clock; admin may pick for an absent manager
    async makePick(code, room, seat, pid) {
      const d = room.draft;
      const err = pickError(d, seat, pid, room.public.squadSize, byId);
      if (err) throw new Error(err);
      const n = d.current;
      try {
        await db.update({
          [R(code, `draft/picks/${n}`)]: { seat, pid, at: db.serverTime(), by: db.uid },
          [R(code, `draft/taken/${pid}`)]: seat,
          [R(code, 'draft/current')]: n + 1,
        });
      } catch (e) {
        throw new Error(/permission/i.test(String(e.message)) ? 'Seçim reddedildi (sıra değişmiş veya oyuncu alınmış olabilir).' : e.message);
      }
    },

    suggest(room, seat) {
      return suggestPick(room.draft, seat, room.public.squadSize, pool, levelOf, byId);
    },

    async autoPick(code, room) {
      const seat = onClock(room.draft);
      if (!seat) return null;
      const pid = api.suggest(room, seat);
      if (!pid) throw new Error('Uygun oyuncu kalmadı.');
      await api.makePick(code, room, seat, pid);
      return pid;
    },

    async saveTactics(code, room, seat, tactics) {
      const sq = squads(room.draft)[seat] || [];
      const t = { ...tactics };
      if (t.lineup) {
        // structure only: an injured / suspended player may stay in the saved XI
        // (it is replaced automatically at kick-off) so other changes can still be saved
        const err = lineupError(t.lineup, t.formation, sq, {});
        if (err) throw new Error(err);
        if (formationSlots(t.formation).length !== t.lineup.length) throw new Error('Diziliş hatalı.');
      }
      if (t.subRules) t.subRules = sanitizeRules(t.subRules);
      // position variants (CM -> CDM / CAM ...) and player roles per slot
      const base = fSlots(t.formation || '4-3-3');
      if (t.slotCodes) {
        const sc = {};
        for (const [i, code] of Object.entries(t.slotCodes)) if (base[i] && (SLOT_VARIANTS[base[i].code] || []).includes(code) && code !== base[i].code) sc[i] = code;
        t.slotCodes = sc;
      }
      if (t.roles) {
        const rl = {};
        for (const [i, key] of Object.entries(t.roles)) {
          if (!base[i] || !key) continue;
          const code = (t.slotCodes && t.slotCodes[i]) || base[i].code;
          if (rolesFor(code).includes(key)) rl[i] = key;
        }
        t.roles = rl;
      }
      if (t.shifts) {
        const sh = {};
        for (const [i, v] of Object.entries(t.shifts)) if (base[i] && base[i].code !== 'GK' && (Number(v) === 1 || Number(v) === -1)) sh[i] = Number(v);
        t.shifts = sh;
      }
      if (t.setPieces) {
        const sp = {};
        for (const k of ['captain', 'penalty', 'freekick', 'corner']) if (t.setPieces[k] && sq.includes(t.setPieces[k])) sp[k] = t.setPieces[k];
        t.setPieces = sp;
      }
      if (t.subPlan) {
        const cl = (v, a, b, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
        t.subPlan = {
          threshold: cl(t.subPlan.threshold, 30, 95, 62), fromMinute: cl(t.subPlan.fromMinute, 30, 89, 60),
          exceptions: toArray(t.subPlan.exceptions).filter((x) => x && sq.includes(x.pid)).slice(0, 3)
            .map((x) => ({ pid: x.pid, threshold: cl(x.threshold, 0, 100, 62), fromMinute: cl(x.fromMinute, 1, 90, 60) })),
        };
      }
      t.updatedAt = db.serverTime();
      await db.update({ [R(code, `tactics/${seat}`)]: t });
    },

    async setReady(code, seat, ready) { await db.update({ [R(code, `ready/${seat}`)]: ready ? true : null }); },

    async startSeason(code, room) {
      if (!draftDone(room.draft)) throw new Error('Draft bitmeden lig başlayamaz.');
      const seats = toArray(room.draft.firstRound);
      const notReady = seats.filter((s) => !(room.ready && room.ready[s]));
      if (notReady.length) throw new Error(`Herkes "Kadrom hazır" demeli. Bekleyen: ${notReady.map((s) => (room.members[s] || {}).team || s).join(', ')}`);
      const season = createSeason(seats, room.draft.seed, room.public.legs);
      await db.update({ [R(code, 'season')]: season, [R(code, 'public/status')]: 'season' });
    },

    async playWeek(code, room) {
      if (!room.season || room.season.finished) throw new Error('Oynanacak hafta yok.');
      const { updates, sim } = weekUpdate(room, byId, model, db.now ? db.now() : Date.now());
      const prefixed = {};
      for (const [k, v] of Object.entries(updates)) prefixed[R(code, k)] = v;
      await db.update(prefixed);
      return sim;
    },

    // Admin changes the live broadcast speed; the start is shifted so the current minute stays put.
    async setLiveSpeed(code, room, week, speed) {
      const ok = [1, 2, 3, 5];
      if (!ok.includes(speed)) throw new Error('Geçersiz hız.');
      const start = Number(room.season && room.season.weeksPlayed && room.season.weeksPlayed[week]);
      if (!Number.isFinite(start)) throw new Error('Bu hafta yayında değil.');
      const old = Number(room.season.liveSpeed && room.season.liveSpeed[week]);
      const s1 = ok.includes(old) ? old : 1;
      const now = db.now ? db.now() : Date.now();
      const pos = Math.max(0, (now - start) * s1);
      await db.update({ [R(code, `season/weeksPlayed/${week}`)]: Math.round(now - pos / speed), [R(code, `season/liveSpeed/${week}`)]: speed });
    },

    async getLog(code, matchId) { return db.get(R(code, `logs/${matchId}`)); },

    // After a finished season: same squads again, or a fresh draft.
    async newSeason(code, room) {
      if (!room.season || !room.season.finished) throw new Error('Sezon bitmeden yeni sezon başlamaz.');
      const seats = toArray(room.draft.firstRound);
      const n = Object.keys(room.history || {}).length + 1;
      const up = {
        [R(code, `history/${n}`)]: seasonHistoryEntry(room, byId),
        [R(code, 'season')]: createSeason(seats, newSeed(), room.public.legs),
        [R(code, 'logs')]: null,
        [R(code, 'public/status')]: 'season',
      };
      await db.update(up);
    },
    async redraft(code, room) {
      if (!room.season || !room.season.finished) throw new Error('Sezon bitmeden yeniden draft yapılamaz.');
      const n = Object.keys(room.history || {}).length + 1;
      const up = {
        [R(code, `history/${n}`)]: seasonHistoryEntry(room, byId),
        [R(code, 'season')]: null,
        [R(code, 'logs')]: null,
        [R(code, 'draft')]: null,
        [R(code, 'public/status')]: 'lobby',
      };
      for (const s of Object.keys(room.members || {})) { up[R(code, `tactics/${s}`)] = null; up[R(code, `ready/${s}`)] = null; }
      await db.update(up);
    },

    // Subscribe to everything the UI needs (match logs are fetched on demand).
    subscribeRoom(code, cb, onError) {
      const parts = ['public', 'members', 'uids', 'draft', 'tactics', 'ready', 'season', 'claims', 'presence', 'history'];
      const room = {};
      const seen = new Set();
      const unsubs = parts.map((p) => db.onValue(R(code, p), (v) => {
        room[p] = v;
        seen.add(p);
        if (seen.size >= parts.length - 3) cb({ ...room, code });
      }, (e) => onError && onError(e, p)));
      return () => unsubs.forEach((u) => u && u());
    },

    async setPresence(code, uid) {
      await db.update({ [R(code, `presence/${uid}`)]: db.serverTime() });
      db.onDisconnectRemove(R(code, `presence/${uid}`));
    },
  };
  return api;
}

export function mySeat(room, uid) {
  if (!room || !room.members) return null;
  for (const [seat, m] of Object.entries(room.members)) if (m && m.uid === uid) return seat;
  return null;
}

function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

export function isAdmin(room, uid) {
  const seat = mySeat(room, uid);
  return !!seat && room.public && room.public.adminSeat === seat;
}
