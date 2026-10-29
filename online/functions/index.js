// OPTIONAL: background push notifications ("Sıra sende!") even when the app is
// closed. Requires the Firebase Blaze plan (Cloud Functions) and a VAPID key in
// src/config.js. Deploy with: firebase deploy --only functions
const { onValueWritten } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const toArray = (v) => (!v ? [] : Array.isArray(v) ? v : Object.keys(v).sort((a, b) => a - b).map((k) => v[k]));

exports.notifyTurn = onValueWritten({ ref: '/rooms/{code}/draft/current', region: 'europe-west1' }, async (event) => {
  const code = event.params.code;
  const current = event.data.after.val();
  if (typeof current !== 'number') return;
  const db = getDatabase();
  const [orderSnap, membersSnap, nameSnap] = await Promise.all([
    db.ref(`rooms/${code}/draft/order`).get(),
    db.ref(`rooms/${code}/members`).get(),
    db.ref(`rooms/${code}/public/name`).get(),
  ]);
  const order = toArray(orderSnap.val());
  const seat = order[current];
  if (!seat) return;
  const member = (membersSnap.val() || {})[seat];
  if (!member) return;
  const tokenSnap = await db.ref(`pushTokens/${member.uid}`).get();
  const token = tokenSnap.val();
  if (!token) return;
  await getMessaging().send({
    token,
    notification: { title: 'Draft Arena · Sıra sende!', body: `${nameSnap.val() || 'Draft'}: seçim sırası sende (${current + 1}. seçim).` },
    webpush: { fcmOptions: { link: `/?oda=${code}` } },
  }).catch(() => {});
});
