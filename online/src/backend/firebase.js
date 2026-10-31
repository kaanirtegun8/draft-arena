// Firebase backend (Realtime Database + anonymous auth), loaded from the
// official CDN so no build step is needed.
import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION, VAPID_KEY } from '../config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

export async function createFirebase() {
  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-database.js`),
  ]);
  const app = appMod.initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  const db = dbMod.getDatabase(app);
  const { ref, get, update, onValue, serverTimestamp, onDisconnect } = dbMod;
  // shared clock: server time offset, so every phone agrees on the live broadcast minute
  let offset = 0;
  try { onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; }); } catch { /* ignore */ }
  const client = {
    kind: 'firebase',
    uid: null,
    async signIn() {
      if (auth.currentUser) { client.uid = auth.currentUser.uid; return client.uid; }
      await new Promise((resolve) => { const off = authMod.onAuthStateChanged(auth, () => { off(); resolve(); }); });
      if (!auth.currentUser) await authMod.signInAnonymously(auth);
      client.uid = auth.currentUser.uid;
      return client.uid;
    },
    async get(path) { const s = await get(ref(db, path)); return s.exists() ? s.val() : null; },
    async update(updates) { return update(ref(db), updates); },
    async set(path, value) { return update(ref(db), { [path]: value }); },
    onValue(path, cb, onError) {
      return onValue(ref(db, path), (s) => cb(s.exists() ? s.val() : null), (e) => { console.error(e); if (onError) onError(e); });
    },
    serverTime: () => serverTimestamp(),
    now: () => Date.now() + offset,
    onDisconnectRemove(path) { try { onDisconnect(ref(db, path)).remove(); } catch { /* ignore */ } },
    async enablePush(path, swReg) {
      if (!VAPID_KEY) return null;
      const msgMod = await import(`${CDN}/firebase-messaging.js`);
      if (!(await msgMod.isSupported())) return null;
      const messaging = msgMod.getMessaging(app);
      const reg = swReg || (await navigator.serviceWorker.getRegistration());
      const token = await msgMod.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if (token) await update(ref(db), { [path]: token });
      return token;
    },
  };
  return client;
}

export function firebaseConfigured() {
  return !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.databaseURL);
}
