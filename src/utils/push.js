// src/utils/push.js
//
// Client-side Web Push helpers for the Anonymous room. Push is entirely
// opt-in and degrades gracefully: if the browser lacks service workers or
// PushManager, or the server has no VAPID keys configured, every helper
// resolves to a safe "unsupported" result instead of throwing.

import { communityApi } from './communityApi';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export async function getVapidKey(session) {
  try {
    const data = await communityApi(session, '/notifications/vapid', {});
    return data?.public_key || data?.key || null;
  } catch {
    return null;
  }
}

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
};

// Returns the active PushSubscription for this browser, or null.
export async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function getPushState() {
  if (!pushSupported()) return { supported: false, subscribed: false, permission: 'default' };
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  const sub = await currentSubscription();
  return { supported: true, subscribed: !!sub, permission };
}

// Ask for permission, subscribe, and register the subscription server-side.
// Returns { ok, reason? } and never throws.
export async function enablePush(session) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, reason: 'denied' };
    }

    const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
    if (!reg) return { ok: false, reason: 'no_sw' };

    const vapid = await getVapidKey(session);
    if (!vapid) return { ok: false, reason: 'not_configured' };

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
    }

    const json = sub.toJSON();
    await communityApi(session, '/notifications/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'error' };
  }
}

export async function disablePush(session) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const sub = await currentSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try {
        await communityApi(session, '/notifications/unsubscribe', { endpoint });
      } catch {
        // best-effort server cleanup
      }
      await sub.unsubscribe().catch(() => {});
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function savePreferences(session, prefs) {
  return communityApi(session, '/notifications/preferences', prefs);
}

export default {
  pushSupported,
  registerServiceWorker,
  currentSubscription,
  getPushState,
  enablePush,
  disablePush,
  savePreferences,
};
