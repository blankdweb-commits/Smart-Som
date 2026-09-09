// ============================================================
// POST /api/push-unsubscribe
//
// Removes THIS device's subscription for the signed-in user. Called both on an
// explicit opt-out in Settings and when the client detects its pushManager
// subscription was revoked/expired.
// Body: { endpoint: string }
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

  const { endpoint } = req.body || {};
  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'Invalid request', message: 'endpoint is required.' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)
      .select('id');
    if (error) {
      console.error('[push/unsubscribe] delete failed:', error.message);
      return res.status(500).json({ error: 'Failed to remove subscription' });
    }
    return res.status(200).json({ unsubscribed: true, removed: (data || []).length });
  } catch (err) {
    console.error('[push/unsubscribe] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}