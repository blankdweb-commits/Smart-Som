// api/_push.js
//
// Best-effort Web Push delivery for the Anonymous room (v44).
//
// The underscore prefix keeps Vercel from deploying this as its own function.
// Delivery is CONFIG-DEPENDENT and fully optional:
//   * It only runs when VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY are set AND the
//     optional `web-push` package can be resolved at runtime.
//   * If either is missing it is a silent no-op — the room works without push.
//
// On purpose this module NEVER throws into the caller: a push failure must
// never fail a community write. It is invoked fire-and-forget.
//
// To enable push notifications:
//   1. npm i web-push
//   2. npx web-push generate-vapid-keys
//   3. set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in the env.
//   4. apply migration v44 (push_subscriptions + notification_preferences).

import { getSupabaseAdmin } from './_utils.js';

const PUSH_ENABLED = !!(
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
);

let webpushPromise = null;
async function loadWebPush() {
  if (!PUSH_ENABLED) return null;
  if (!webpushPromise) {
    webpushPromise = import('web-push')
      .then((mod) => {
        const webpush = mod?.default || mod;
        try {
          webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:notifications@example.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY,
          );
        } catch {
          return null;
        }
        return webpush;
      })
      .catch(() => null);
  }
  return webpushPromise;
}

export const isPushEnabled = () => PUSH_ENABLED;

// kind ∈ 'room_messages' | 'member_joins' | 'social'
// recipientUserIds (optional, for targeted room-message pushes): when given,
// ONLY those members are contacted (the author of a replied-to message, an
// @mentioned member, or the recipient of an Encoded Message). Without it,
// every member except excludeUserId is contacted (join/social broadcasts).
export async function sendRoomPush({ groupId, excludeUserId, recipientUserIds, kind, title, body, url }) {
  // Fast exit before touching any table when push is unconfigured.
  if (!PUSH_ENABLED) return { sent: 0, skipped: true };

  const supabase = getSupabaseAdmin();
  if (!supabase) return { sent: 0, skipped: true };
  const webpush = await loadWebPush();
  if (!webpush) return { sent: 0, skipped: true };

  try {
    let userIds;
    if (recipientUserIds?.length) {
      userIds = [...new Set(recipientUserIds)].filter((id) => id && id !== excludeUserId);
    } else {
      const { data: members } = await supabase
        .from('study_group_members')
        .select('user_id')
        .eq('group_id', groupId);
      userIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))]
        .filter((id) => id !== excludeUserId);
    }
    if (!userIds.length) return { sent: 0 };

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, user_id')
      .in('user_id', userIds);
    if (!subs || !subs.length) return { sent: 0 };

    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('user_id, room_messages, member_joins, social')
      .in('user_id', userIds);
    const prefByUser = new Map((prefs || []).map((p) => [p.user_id, p]));

    const payload = JSON.stringify({
      title: title || 'Anonymous room',
      body: body || 'New activity in the room.',
      url: url || '/study-groups',
      kind: kind || 'room_messages',
    });

    const stale = [];
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        const pref = prefByUser.get(sub.user_id);
        // Opt-out wins; absent row means default-on.
        if (pref && pref[kind] === false) return;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          sent += 1;
        } catch (err) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) stale.push(sub.id);
        }
      }),
    );

    if (stale.length) {
      await supabase.from('push_subscriptions').delete().in('id', stale);
    }
    return { sent };
  } catch (err) {
    console.error('[push]', err?.message || err);
    return { sent: 0 };
  }
}

export default sendRoomPush;
