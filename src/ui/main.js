// App shell: routing, persistence, shared context for all screens.
import { PLAYERS } from '../data/players.js';
import { indexPlayers } from '../core/league.js';
import { saveToSlot, loadFromSlot } from '../core/save.js';
import { h, clear, toast, closeSheet } from './dom.js';
import { renderHome, renderSetup } from './screens/home.js';
import { renderDraft } from './screens/draft.js';
import { renderHub } from './screens/hub.js';
import { renderTeam } from './screens/team.js';
import { renderPrematch, renderMatch } from './screens/match.js';
import { renderAwards, renderChampion } from './screens/season.js';
import { renderData } from './screens/data.js';

function safeStorage() {
  try {
    const k = '__da_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    // Private mode / disabled storage: keep data in memory for this session
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), memoryOnly: true };
  }
}

const app = {
  pool: PLAYERS,
  byId: indexPlayers(PLAYERS),
  storage: safeStorage(),
  league: null,
  view: 'home',
  params: {},
  ui: {}, // per-screen UI state (filters, tabs…)
  cleanup: null,
};

const SCREENS = {
  home: renderHome, setup: renderSetup, draft: renderDraft, hub: renderHub, team: renderTeam,
  prematch: renderPrematch, match: renderMatch, awards: renderAwards, champion: renderChampion, data: renderData,
};

const ctx = {
  app,
  go(view, params = {}) {
    closeSheet();
    app.view = view;
    app.params = params;
    render();
    window.scrollTo(0, 0);
  },
  render: () => render(),
  // Apply a mutation to the league, autosave, re-render. Errors become toasts.
  commit(fn, { rerender = true } = {}) {
    try {
      const out = fn(app.league);
      ctx.autosave();
      if (rerender) render();
      return out;
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'err');
      if (rerender) render();
      return undefined;
    }
  },
  autosave() {
    if (!app.league) return;
    try { saveToSlot(app.storage, 'auto', app.league); } catch (e) { toast('Otomatik kayıt başarısız: ' + e.message, 'err'); }
  },
  setLeague(l) { app.league = l; app.ui = {}; ctx.autosave(); },
  homeView() {
    const l = app.league;
    if (!l) return 'home';
    return l.phase === 'draft' ? 'draft' : 'hub';
  },
};

function render() {
  const root = document.getElementById('app');
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  const y = window.scrollY;
  clear(root);
  const fn = SCREENS[app.view] || renderHome;
  try {
    const el = fn(ctx);
    root.appendChild(el);
  } catch (e) {
    console.error(e);
    root.appendChild(h('div', { class: 'card' }, h('h2', null, 'Bir hata oluştu'), h('p', { class: 'muted' }, String(e.message || e)),
      h('button', { class: 'btn primary', onclick: () => ctx.go('home') }, 'Ana menüye dön')));
  }
  window.scrollTo(0, y);
}

function boot() {
  try {
    const saved = loadFromSlot(app.storage, 'auto');
    if (saved) app.league = saved;
  } catch (e) {
    toast('Otomatik kayıt yüklenemedi: ' + e.message, 'err');
  }
  if (app.storage.memoryOnly) setTimeout(() => toast('Tarayıcı depolaması kapalı (gizli mod?). Kayıtlar sadece bu oturumda kalır; dışa aktarmayı kullanın.', 'err'), 400);
  render();
}

window.addEventListener('error', (e) => { if (e && e.message) toast('Hata: ' + e.message, 'err'); });
boot();
