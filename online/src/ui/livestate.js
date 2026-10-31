// Live broadcast window: after the admin plays a week, its matches are "on air"
// for everyone at the same time. Until the broadcast ends nobody sees the results.
import { toArray } from '../core/draft.js';

export const SEC_PER_MIN = 2;
// Fixed length so every screen agrees without loading the match logs:
// longest possible timeline (45+4, half-time counted twice, 45+6, full time) at 2 s per minute.
export const BROADCAST_TICKS = 1 + 45 + 4 + 2 + 45 + 6 + 1;
export const BROADCAST_MS = BROADCAST_TICKS * SEC_PER_MIN * 1000;

export function clockNow(app) {
  try { return app && app.db && typeof app.db.now === 'function' ? app.db.now() : Date.now(); } catch { return Date.now(); }
}

// Broadcast speed chosen by the admin (1x, 2x, 3x, 5x). When it changes the start time
// is shifted so the current minute stays the same for everybody.
export const LIVE_SPEEDS = [1, 2, 3, 5];
export function speedOf(room, week) {
  const v = Number(room && room.season && room.season.liveSpeed && room.season.liveSpeed[week]);
  return LIVE_SPEEDS.includes(v) ? v : 1;
}
// broadcast milliseconds elapsed (at 1x scale)
export function broadcastPos(room, week, now) {
  const t = Number(room && room.season && room.season.weeksPlayed && room.season.weeksPlayed[week]);
  return Number.isFinite(t) ? (now - t) * speedOf(room, week) : Infinity;
}

// Weeks currently being broadcast (ascending).
export function liveWeeks(room, now) {
  const wp = room && room.season && room.season.weeksPlayed;
  if (!wp) return [];
  return Object.entries(wp).map(([w, t]) => ({ w: Number(w), t: Number(t) }))
    .filter((x) => Number.isFinite(x.t) && now < x.t + BROADCAST_MS / speedOf(room, x.w) && now > x.t - 60000)
    .map((x) => x.w).sort((a, b) => a - b);
}

export function liveWeekOf(room, now) { const l = liveWeeks(room, now); return l.length ? l[0] : null; }

export function broadcastEnd(room, week) {
  const t = room && room.season && room.season.weeksPlayed && room.season.weeksPlayed[week];
  return t ? Number(t) + BROADCAST_MS / speedOf(room, week) : 0;
}

export function isLiveMatch(room, matchId, now) {
  const weeks = liveWeeks(room, now);
  if (!weeks.length) return null;
  for (const w of weeks) {
    const wk = toArray(room.season.schedule).find((x) => x.week === w);
    if (wk && toArray(wk.matches).some((m) => m.id === matchId)) return w;
  }
  return null;
}

// Shallow clone of the room with the weeks on air removed, so tables, stats and
// the champion card do not spoil anything before the broadcast ends.
export function spoilerSafeRoom(room, now) {
  const weeks = liveWeeks(room, now);
  if (!weeks.length || !room.season) return room;
  const season = room.season;
  const hide = new Set();
  for (const w of weeks) {
    const wk = toArray(season.schedule).find((x) => x.week === w);
    if (wk) for (const m of toArray(wk.matches)) hide.add(m.id);
  }
  const matches = {};
  for (const [id, m] of Object.entries(season.matches || {})) if (!hide.has(id)) matches[id] = m;
  const weeksPlayed = { ...(season.weeksPlayed || {}) };
  for (const w of weeks) delete weeksPlayed[w];
  return {
    ...room,
    public: room.public && room.public.status === 'finished' ? { ...room.public, status: 'season' } : room.public,
    season: { ...season, matches, weeksPlayed, currentWeek: weeks[0], finished: false, awards: null, champion: null },
  };
}
