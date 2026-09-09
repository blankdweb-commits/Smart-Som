// src/utils/notifications.js
// Client-side Web Push (VAPID) helpers. The heavy lifting (endpoint rotation,
// delivery, scheduled reminders) lives server-side in api/_push.js and the
// cron route; this module handles SW registration, permission, subscribe,
// unsubscribe, and fire-and-forget sends from in-app triggers.

import { authHeaders } from './apiHeaders';

const DB_NAME = 'polynurse-push';
const DB_STORE = 'context';
const DB_KEY = 'session';
const PROMPT_FLAG = 'apex:pushPrompted';

export const urlBase64ToUint8Array = (base64) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(safe);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(DB_STORE)) {
      req.result.createObjectStore(DB_STORE);
    }
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const storePushSession = async (value) => {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, DB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Push session store failed:', err.message);
  }
};

export const clearPushSession = async () => {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Push session clear failed:', err.message);
  }
};

export const isPushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

// iOS Safari only supports Web Push for a web app ADDED TO THE HOME SCREEN.
export const isIosWebPush = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent);

export const isStandalonePwa = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

export const getVapidPublicKey = () => import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('SW registration failed:', err.message);
    return null;
  }
};

export const getPushSubscription = async (reg) => {
  const registration = reg || (await registerServiceWorker());
  if (!registration || !registration.pushManager) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
};

// Trigger the native permission pop-up. Returns 'granted' | 'denied' | 'default'.
export const requestPushPermission = async () => {
  if (!('Notification' in window)) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return window.Notification?.permission || 'denied';
  }
};

// Subscribe this device and register it with the API. Returns the resulting
// state descriptor; safe to call repeatedly (existing sub is re-registered).
export const subscribeToPush = async (session) => {
  if (!session?.access_token || !isPushSupported()) {
    return { state: 'unsupported' };
  }
  const vapidKey = getVapidPublicKey();
  if (!vapidKey) return { state: 'unconfigured' };

  const registration = await registerServiceWorker();
  if (!registration || !registration.pushManager) return { state: 'unsupported' };

  const existing = await getPushSubscription(registration);
  let subscription = existing;
  if (!subscription) {
    const permission = await requestPushPermission();
    if (permission !== 'granted') return { state: permission === 'denied' ? 'blocked' : 'skipped' };
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  await storePushSession({ accessToken: session.access_token, apiBase: window.location.origin, vapidKey });

  const payload = {
    subscription: {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')))),
        auth: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')))),
      },
    },
  };

  try {
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: authHeaders(session, { json: true }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { state: 'error', error: data.message || res.status };
    return { state: 'subscribed', deviceCount: data.deviceCount, subscription };
  } catch (err) {
    return { state: 'error', error: err.message };
  }
};

export const unsubscribeFromPush = async (session) => {
  if (!session?.access_token || !isPushSupported()) return { state: 'unsupported' };
  const registration = await registerServiceWorker();
  const subscription = await getPushSubscription(registration);
  let endpoint = subscription?.endpoint || null;
  if (subscription) {
    try { await subscription.unsubscribe(); } catch { /* best effort */ }
  }
  await clearPushSession();
  if (endpoint) {
    try {
      const res = await fetch('/api/push-unsubscribe', {
        method: 'POST',
        headers: authHeaders(session, { json: true }),
        body: JSON.stringify({ endpoint }),
      });
      if (!res.ok) return { state: 'error' };
    } catch {
      return { state: 'error' };
    }
  }
  return { state: 'unsubscribed' };
};

// Fire-and-forget in-app-triggered notification (achievements, challenge…).
// No-op locally when this device isn't subscribed; `kind` is logged daily.
export const sendPushNotification = async (session, { title, body, url, tag, kind, actions }) => {
  if (!session?.access_token || !isPushSupported()) return { ok: false };
  if (!title) return { ok: false };
  try {
    const res = await fetch('/api/push-send', {
      method: 'POST',
      headers: authHeaders(session, { json: true }),
      body: JSON.stringify({ title, body, url, tag, kind, actions }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

// Prompt bookkeeping — the native pop-up shows at most once per device.
export const wasPrompted = () => {
  try { return localStorage.getItem(PROMPT_FLAG) === '1'; } catch { return true; }
};
export const markPrompted = () => {
  try { localStorage.setItem(PROMPT_FLAG, '1'); } catch { /* best effort */ }
};