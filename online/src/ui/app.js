// App shell: backend selection, room subscription, routing, notifications.
import { h, clear, toast, closeSheet } from './dom.js';
import { createApi, mySeat, isAdmin } from '../backend/api.js';
import { firebaseConfigured, createFirebase } from '../backend/firebase.js';
import { createBrowserLocal } from '../backend/local.js';
import { onClock, draftDone } from '../core/draft.js';
import { alertTurn, chime, registerSW, systemNotify, unlockAudio, stopBlink, turnSplash } from './notify.js';
import { renderLanding } from './screens/landing.js';
import { renderLobby } from './screens/lobby.js';
import { renderDraft } from './screens/draft.js';
import { renderPrep } from './screens/prep.js';
import { renderLeague } from './screens/league.js';
import { renderTeam } from './screens/team.js';
import { renderMatch } from './screens/match.js';
import { renderAwards, renderChampion } from './screens/season.js';
import { renderLive } from './screens/live.js';
import { clockNow, liveWeeks } from './livestate.js';

const app = { api: null, db: null, mode: null, uid: null, room: null, code: null, view: 'landing', params: {}, ui: {}, unsub: null, cleanup: null, error: null };
const LS_ROOM = 'daOnline.room';

const ctx = {
  app,
  go(view, params = {}) { closeSheet(); app.view = view; app.params = params; render(); window.scrollTo(0, 0); },
  render: () => render(),
  async run(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; } catch (e) { console.warn(e); toast(e.message || String(e), 'err'); return undefined; }
  },
  get seat() { return mySeat(app.room, app.uid); },
  get admin() { return isAdmin(app.room, app.uid); },
  enterRoom(code) { enterRoom(code); },
  leaveRoom() {
    if (app.unsub) app.unsub();
    app.unsub = null; app.room = null; app.code = null;
    try { localStorage.removeItem(LS_ROOM); } catch { /* ignore */ }
    ctx.go('landing');
  },
};

function enterRoom(code) {
  if (app.unsub) app.unsub();
  app.code = code;
  app.room = null;
  app.error = null;
  try { localStorage.setItem(LS_ROOM, code); } catch { /* ignore */ }
  let prev = null;
  let prevSig = null;
  app.unsub = app.api.subscribeRoom(code, (room) => {
    const before = prev; prev = room;
    app.room = room;
    // presence-only changes do not need a re-render outside the lobby
    const sig = JSON.stringify({ ...room, presence: null });
    const presenceOnly = sig === prevSig;
    prevSig = sig;
    if (presenceOnly && room.public && room.public.status !== 'lobby') return;
    if (!mySeat(room, app.uid)) {
      // not (or no longer) a member
      if (room.public) { app.view = 'landing'; app.params = { code, notMember: true }; render(); }
      return;
    }
    detectEvents(before, room);
    if (app.view === 'landing') app.view = 'room';
    render();
  }, (e) => {
    if (/permission/i.test(String(e && e.message))) {
      app.view = 'landing'; app.params = { code, notMember: true }; render();
    }
  });
  app.api.setPresence(code, app.uid).catch(() => {});
  if (!app.room && app.view === 'landing') { app.view = 'room'; render(); }
}

function detectEvents(before, room) {
  const seat = mySeat(room, app.uid);
  const nowClock = room.draft ? onClock(room.draft) : null;
  const prevClock = before && before.draft ? onClock(before.draft) : null;
  if (room.public && room.public.status === 'draft' && nowClock === seat && (prevClock !== seat || !before)) {
    alertTurn(`${room.public.name}: seçim sırası sende.`);
    turnSplash();
    app.ui.turnFlash = Date.now();
  }
  if (nowClock !== seat) stopBlink();
  if (before && before.draft && room.draft && before.draft.current !== room.draft.current && nowClock !== seat) {
    const picks = room.draft.picks;
    const last = picks && (Array.isArray(picks) ? picks[room.draft.current - 1] : picks[room.draft.current - 1]);
    if (last && app.api.byId[last.pid]) {
      const m = room.members[last.seat] || {};
      toast(`${m.team || m.name}: ${app.api.byId[last.pid].name}`);
    }
  }
  const onAir = liveWeeks(room, clockNow(app));
  if (before && before.public && room.public && before.public.status !== room.public.status) {
    const msg = { draft: 'Draft başladı!', season: 'Lig başladı!', finished: 'Sezon bitti! Şampiyon belli oldu.' }[room.public.status];
    // the champion is announced by the live screen when the final broadcast ends
    if (msg && !(room.public.status === 'finished' && onAir.length)) { toast(msg, 'ok'); chime('info'); systemNotify('Draft Arena', msg, 'status'); }
  }
  // a new season (or a redraft) resets the week the league screen was showing
  if (before && before.season && room.season && room.season.seed !== before.season.seed) { app.ui.week = null; app.ui.live = null; }
  if (before && before.season && room.season && room.season.seed === before.season.seed && room.season.currentWeek > before.season.currentWeek) {
    const w = room.season.currentWeek - 1;
    app.ui.leagueTab = 'week';
    app.ui.week = w;
    if (onAir.includes(w)) {
      // everybody jumps into the same live broadcast
      closeSheet();
      app.ui.live = null;
      app.view = 'room';
      app.params = { sub: 'live', week: w };
      toast(`${w}. hafta başladı! Canlı yayın açıldı.`, 'ok');
      chime('goal');
      systemNotify('Draft Arena', `${w}. hafta canlı yayında! Maçları izlemek için aç.`, 'week');
      window.scrollTo(0, 0);
    } else {
      toast(`${w}. hafta oynandı! Canlı izlemek için Hafta sekmesine bak.`, 'ok');
      chime('goal');
      systemNotify('Draft Arena', `${w}. haftanın sonuçları açıklandı.`, 'week');
    }
  }
}

function roomScreen() {
  const r = app.room;
  if (!r || !r.public) return h('div', { class: 'boot' }, 'Oda yükleniyor…');
  if (!mySeat(r, app.uid)) { app.view = 'landing'; app.params = { code: app.code, notMember: true }; return renderLanding(ctx); }
  if (app.params.sub === 'team') return renderTeam(ctx);
  if (app.params.sub === 'match') return renderMatch(ctx);
  if (app.params.sub === 'awards') return renderAwards(ctx);
  if (app.params.sub === 'champion') return renderChampion(ctx);
  if (app.params.sub === 'live') return renderLive(ctx);
  const st = r.public.status;
  // listeners fire one node at a time: wait until the data for the new phase arrives
  if ((st === 'draft' && !r.draft) || ((st === 'season' || st === 'finished') && (!r.season || !r.draft))) return h('div', { class: 'boot' }, 'Güncelleniyor…');
  if (st === 'lobby') return renderLobby(ctx);
  if (st === 'draft' && !draftDone(r.draft)) return renderDraft(ctx);
  if (st === 'draft') return renderPrep(ctx);
  return renderLeague(ctx);
}

// Re-render while keeping focus/caret in inputs marked with data-k.
function render() {
  const root = document.getElementById('app');
  const act = document.activeElement;
  const k = act && act.dataset ? act.dataset.k : null;
  const sel = k && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  const y = window.scrollY;
  clear(root);
  let el;
  try {
    el = app.view === 'room' ? roomScreen() : renderLanding(ctx);
  } catch (e) {
    console.error(e);
    el = h('div', { class: 'card' }, h('h2', null, 'Bir hata oluştu'), h('p', { class: 'muted' }, String(e.message || e)),
      h('button', { class: 'btn', onclick: () => ctx.leaveRoom() }, 'Giriş ekranına dön'));
  }
  root.appendChild(el);
  window.scrollTo(0, y);
  if (k) {
    const again = root.querySelector(`[data-k="${k}"]`);
    if (again) { again.focus({ preventScroll: true }); if (sel && again.setSelectionRange) try { again.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ } }
  }
}

async function boot() {
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  registerSW();
  try {
    const { PLAYERS } = await import('../../data/players.js');
    const forceDemo = new URL(location.href).searchParams.get('demo') === '1';
    if (firebaseConfigured() && !forceDemo) { app.db = await createFirebase(); app.mode = 'firebase'; }
    else { app.db = createBrowserLocal(); app.mode = 'demo'; }
    app.api = createApi(app.db, PLAYERS);
    app.uid = await app.db.signIn();
  } catch (e) {
    console.error(e);
    document.getElementById('app').replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Bağlantı kurulamadı'), h('p', { class: 'muted' }, String(e.message || e)), h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Tekrar dene')));
    return;
  }
  const url = new URL(location.href);
  const invite = url.searchParams.get('oda') || url.searchParams.get('room');
  let saved = null;
  try { saved = localStorage.getItem(LS_ROOM); } catch { saved = null; }
  if (invite && invite.toUpperCase() !== saved) { app.view = 'landing'; app.params = { code: invite.toUpperCase() }; render(); return; }
  if (saved) enterRoom(saved);
  else render();
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && app.db.enablePush) setTimeout(() => app.db.enablePush(`pushTokens/${app.uid}`).catch(() => {}), 3000);
}

window.addEventListener('error', (e) => { if (e && e.message) toast('Hata: ' + e.message, 'err'); });
boot();
