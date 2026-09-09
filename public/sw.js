/* Polynurse Exam Center — service worker
 *
 * Responsibilities (push only; deliberately NO `fetch` handler so we can never
 * serve stale cached app-shell HTML after a deploy):
 *   1. `push`            -> render a native notification from the API payload.
 *   2. `notificationclick` -> honour action buttons; else focus the app or open
 *                             the notification's target route.
 *   3. `pushsubscriptionchange` -> transparently re-subscribe (browser rotated
 *                             the endpoint) using the session we stored at
 *                             subscribe-time in IndexedDB.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ---- IndexedDB context (written by src/utils/notifications.js) ----
const DB_NAME = 'polynurse-push';
const DB_STORE = 'context';

function openPushDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getPushSession() {
  try {
    const db = await openPushDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const getReq = tx.objectStore(DB_STORE).get('session');
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    });
  } catch {
    return null; // SW runs without a page context — nothing actionable yet.
  }
}

// ---- urlBase64 helpers (matches client encoder) ----
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(safe);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---- `push` : show the notification ----
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Polynurse';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/polynurse-mark.svg',
    badge: payload.badge || '/polynurse-mark.svg',
    vibrate: payload.vibrate || [100, 60, 100],
    renotify: true,
    tag: payload.tag,
    actions: Array.isArray(payload.actions) && payload.actions.length > 0
      ? payload.actions
      : [{ action: 'open', title: 'Open' }, { action: 'close', title: 'Dismiss' }],
    data: {
      url: payload.url || '/',
      kind: payload.data && payload.data.kind,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- Notification click : open the right place ----
async function openTarget(url) {
  const abs = new URL(url || '/', self.registration.scope).href;
  // Focus an existing client first (mobile feel: no second tab).
  const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientsList) {
    if (new URL(client.url).origin === new URL(abs).origin) {
      await client.focus();
      if (client.navigate) client.navigate(abs).catch(() => {});
      return;
    }
  }
  await self.clients.openWindow(abs);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action || 'open';
  if (action === 'close') return; // dismissed — nothing further to do

  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(openTarget(target));
});

self.addEventListener('notificationclose', () => {
  // Fired when the user swipes a notification away. Nothing to persist yet —
  // left here so future analytics can hook in without touching the SW shape.
});

// ---- pushsubscriptionchange : keep the user subscribed across rotations ----
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const session = await getPushSession();
    if (!session || !session.accessToken || !session.vapidKey) return;

    try {
      const registration = await self.registration;
      const newSub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(session.vapidKey),
      });

      const res = await fetch(`${session.apiBase || self.registration.scope}api/push-subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          subscription: {
            endpoint: newSub.endpoint,
            keys: { p256dh: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(newSub.getKey('auth')))) },
          },
        }),
      });
      if (!res.ok) console.error('[sw] resubscribe failed', res.status);
    } catch (err) {
      console.error('[sw] pushsubscriptionchange resubscribe error:', err);
    }
  })());
});