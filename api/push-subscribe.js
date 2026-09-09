// ============================================================
// POST /api/push-subscribe
//
// Persists this device's Web Push subscription for the signed-in user.
// Body: { subscription: { endpoint, keys: { p256dh, auth } }, userAgent?: string }
//
// The browser's pushManager.subscribe() already returns a sub that is unique
// to (this origin + this app's VAPID public key). We key on `endpoint` so a
// device that resubscribes (e.g. after pushsubscriptionchange) simply replaces
// its previous row instead of accumulating duplicates.
// ============================================================
import { applyCors, authorizeRequest, getSupabaseAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, status, body: authBody } = await authorizeRequest(req);
  if (!user) return res.status(status).json(authBody);

  const { subscription } = req.body || {};
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Invalid request', message: 'subscription.endpoint and keys.p256dh/keys.auth are required.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: (req.body || {}).userAgent || req.headers['user-agent'] || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

    if (error) {
      console.error('[push/subscribe] upsert failed:', error.message);
      return res.status(500).json({ error: 'Failed to save subscription' });
    }

    const { count } = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return res.status(200).json({ subscribed: true, deviceCount: count || 0 });
  } catch (err) {
    console.error('[push/subscribe] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}