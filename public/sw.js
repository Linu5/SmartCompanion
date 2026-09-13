// Only the static offline page is cached. Never cache arrivals, GPS or account data.
const CACHE = 'railpulse-offline-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/icon.svg']))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('railpulse-offline-') && key !== CACHE).map(key => caches.delete(key))))])); });
self.addEventListener('fetch', event => {
    if (event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin) event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
self.addEventListener('push', event => {
    let payload; try { payload = event.data?.json(); } catch { payload = null; }
    event.waitUntil(self.registration.showNotification('RailPulse · commute alert', { body: String(payload?.body || 'Check your saved commute for the latest service updates.').slice(0, 500), tag: String(payload?.tag || 'railpulse-alert').slice(0, 100), icon: '/icon.svg', data: { url: '/?view=saved' } }));
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
        const client = clients.find(window => new URL(window.url).origin === self.location.origin);
        if (client) { await client.focus(); client.postMessage({ type: 'OPEN_NOTIFICATION', view: event.notification.tag === 'railpulse-trip' ? 'trip' : 'saved' }); }
        else await self.clients.openWindow('/?view=saved');
    }));
});
