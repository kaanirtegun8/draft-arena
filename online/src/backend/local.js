// Local demo backend: a JSON tree kept in localStorage and synced between tabs
// with BroadcastChannel. Every tab gets its own user id, so several tabs on one
// computer behave like several phones. Also used (in memory) by the tests.
import { applyUpdates, getPath } from './tree.js';

export function createMemoryHub(initial = {}) {
  const hub = { tree: initial, listeners: new Set() };
  hub.client = (uid) => makeClient(hub, uid);
  hub.notify = () => { for (const l of hub.listeners) l(); };
  return hub;
}

function makeClient(hub, uid) {
  const subs = new Set();
  const fire = () => { for (const s of subs) s.check(); };
  hub.listeners.add(fire);
  return {
    kind: 'local',
    uid,
    async signIn() { return uid; },
    async get(path) { return clone(getPath(hub.tree, path)); },
    async update(updates) {
      hub.tree = applyUpdates(hub.tree, resolveTimestamps(updates));
      hub.persist && hub.persist();
      hub.notify();
    },
    async set(path, value) { return this.update({ [path]: value }); },
    onValue(path, cb) {
      let last;
      const sub = {
        check() {
          const v = getPath(hub.tree, path);
          const s = JSON.stringify(v === undefined ? null : v);
          if (s !== last) { last = s; cb(v === undefined ? null : clone(v)); }
        },
      };
      subs.add(sub);
      sub.check();
      return () => subs.delete(sub);
    },
    serverTime: () => ({ '.sv': 'timestamp' }),
    now: () => Date.now(),
    onDisconnectRemove() {},
    close() { hub.listeners.delete(fire); subs.clear(); },
  };
}

function resolveTimestamps(updates) {
  const out = {};
  const now = Date.now();
  const fix = (v) => {
    if (v && typeof v === 'object' && v['.sv'] === 'timestamp') return now;
    if (v && typeof v === 'object') { const o = Array.isArray(v) ? [] : {}; for (const [k, x] of Object.entries(v)) o[k] = fix(x); return o; }
    return v;
  };
  for (const [k, v] of Object.entries(updates)) out[k] = fix(v);
  return out;
}

const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

// Browser demo: localStorage-backed hub shared by tabs.
export function createBrowserLocal() {
  const KEY = 'daOnline.demoDb';
  let initial = {};
  try { initial = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { initial = {}; }
  const hub = createMemoryHub(initial);
  let chan = null;
  try { chan = new BroadcastChannel('daOnline'); } catch { chan = null; }
  hub.persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(hub.tree)); } catch { /* storage full or blocked */ }
    if (chan) chan.postMessage('changed');
  };
  const reload = () => { try { hub.tree = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ } hub.notify(); };
  if (chan) chan.onmessage = reload;
  window.addEventListener('storage', (e) => { if (e.key === KEY) reload(); });
  let uid = null;
  try { uid = sessionStorage.getItem('daOnline.demoUid'); } catch { uid = null; }
  if (!uid) {
    uid = 'demo-' + Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('daOnline.demoUid', uid); } catch { /* ignore */ }
  }
  const client = hub.client(uid);
  client.resetDemo = () => { hub.tree = {}; hub.persist(); hub.notify(); };
  return client;
}
