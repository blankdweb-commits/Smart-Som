// public/sw.js
//
// Minimal service worker for the Anonymous room push notifications. It is
// intentionally tiny: it caches nothing and never intercepts fetches, so it
// cannot affect the SPA's normal data loading. Its only job is to surface
// push notifications and focus/open the room when one is clicked.
//
// The push payload is notification-only metadata (never message content).

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'Anonymous room';
  const body = data.body || 'New activity in the room.';
  const url = data.url || '/study-groups';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: data.tag || 'apex-anon-room',
      renotify: false,
      data: { url },
      icon: '/apex-mark.png',
      badge: '/apex-mark.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/study-groups';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          client.postMessage({ type: 'apex:push-navigate', url: target });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })(),
  );
});
