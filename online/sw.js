// Service worker: shows notifications and focuses the app when one is tapped.
// Also receives FCM web-push messages when background push is configured.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const n = data.notification || data.data || {};
  event.waitUntil(self.registration.showNotification(n.title || 'Draft Arena', { body: n.body || 'Sıra sende!', icon: 'icon.svg', tag: n.tag || 'draft-arena', renotify: true }));
});
