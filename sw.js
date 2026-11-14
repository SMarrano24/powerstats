/* PowerStats works offline: every file is fetched fresh when there's a connection, and the last copy is kept for
   when there isn't (the grades stay locked in that copy too). Sam's other phone apps live on the same site and share
   its caches, so only PowerStats' own old caches are ever deleted. */
const CACHE = 'powerstats-v2';  // V2 (2026-11-03): a new name, so V1's saved copy is dropped
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('powerstats-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const key = req.url.replace(/[?#].*$/, '');  // data.json?t=123 and data.json are one copy
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});

/* Notifications from Sam's Mac (push.py): show each one, and open PowerStats when it's tapped. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'PowerStats', {
    body: d.body || '', tag: d.tag || undefined, data: { url: d.url || './' }, icon: 'icon-180.png', badge: 'icon-180.png' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data || {}).url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    for (const w of await clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if ('focus' in w) return w.focus();
    }
    return clients.openWindow(url);
  })());
});
