// api/_push.js
// Shared Web-Push (VAPID) engine for the browser-push feature. All delivery
// goes through web-push with the VAPID credentials from env. Nothing here is an
// HTTP handler — it is imported by api/push-*.js and the cron reminder route.
//
// Env (server-only): VAPID_PRIVATE_KEY, VAPID_SUBJECT. Public: VITE_VAPID_PUBLIC_KEY.
// If the private key is missing, every call degrades gracefully (delivered:false)
// so the app keeps working during local development without push configured.
import webpush from 'web-push';

const APP_BASE = process.env.APP_URL || 'https://www.polynurse.com.ng';

// Browser notification defaults tuned for mobile: small icon + subtle badge,
// a short buzz, grouped message updates via `tag`/`renotify`, and two standard
// action buttons the service worker understands by name.
const DEFAULT_ACTIONS = [
  { action: 'open', title: 'Open' },
  { action: 'close', title: 'Dismiss' },
];

let vapidConfigured = false;
const ensureVapid = () => {
  if (vapidConfigured) return true;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || `mailto:no-reply@${new URL(APP_BASE).hostname}`;
  const publicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  if (!privateKey || !publicKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
};

const normalize = (value, fallback) => {
  const v = String(value == null ? '' : value).trim();
  return v ? v : fallback;
};

// Builds a well-formed notification payload. `url` is a client-side route (or
// absolute URL) the service worker opens on click. `tag` groups related
// notifications so a newer replace an older pending one on the same device.
export const buildPushPayload = ({
  title,
  body,
  url,
  tag,
  actions,
  data,
} = {}) => {
  const safeUrl = normalize(url, '/');
  const fullUrl = /^https?:\/\//i.test(safeUrl) ? safeUrl : `${APP_BASE}${safeUrl.startsWith('/') ? safeUrl : `/${safeUrl}`}`;
  return {
    title: normalize(title, 'Polynurse'),
    body: normalize(body, ''),
    icon: `${APP_BASE}/polynurse-mark.svg`,
    badge: `${APP_BASE}/polynurse-mark.svg`,
    url: fullUrl,
    tag: tag ? `polynurse:${tag}` : undefined,
    actions: Array.isArray(actions) && actions.length > 0 ? actions : DEFAULT_ACTIONS,
    renotify: true,
    vibrate: [100, 60, 100],
    data: data || {},
  };
};

// Sends `payload` to every stored subscription for `userId`. Prunes dead
// endpoints (HTTP 404/410 -> browser unsubscribed/deleted the push registration)
// and optionally records delivery in push_log (one row per kind+day) so the
// scheduled reminders never re-send the same alert twice.
export const notifyUser = async (supabase, userId, payload, { kind, log = false } = {}) => {
  if (!ensureVapid()) return { sent: 0, endpoints: 0, delivered: false, reason: 'VAPID not configured' };
  if (!supabase || !userId) return { sent: 0, endpoints: 0, delivered: false, reason: 'missing supabase/user' };

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error) {
    console.error('[push] subscription lookup failed:', error.message);
    return { sent: 0, endpoints: 0, delivered: false, reason: error.message };
  }
  if (!subs || subs.length === 0) return { sent: 0, endpoints: 0, delivered: false, reason: 'no subscriptions' };

  const message = JSON.stringify(buildPushPayload(payload));
  let sent = 0;
  let failed = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, message);
      sent += 1;
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        pruned += 1;
      } else {
        failed += 1;
        if (code !== 429) console.error('[push] delivery failed:', code, err?.body || err.message);
      }
    }
  }

  if (kind && log && sent > 0) {
    await supabase
      .from('push_log')
      .upsert({
        user_id: userId,
        kind,
        sent_date: new Date().toISOString().slice(0, 10),
        sent_at: new Date().toISOString(),
        status: 'sent',
        endpoints: sent,
      }, { onConflict: 'user_id,kind,sent_date', ignoreDuplicates: true });
  }

  return { sent, endpoints: subs.length, delivered: sent > 0, failed, pruned };
};

// Convenience: a pre-built alert for the cron reminders.
export const USER_FACING_KINDS = new Set(['streak-alert', 'daily-reminder', 'exam-near', 'challenge-ready']);