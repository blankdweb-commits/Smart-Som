// ============================================================
// Session Management API — single-device enforcement.
//
// POST /api/session/register
//   Registers the caller's access token(s) as the user's single ACTIVE session,
//   revoking any prior active sessions (force sign-out of old device).
//   Body: { device_identifier } (optional, opaque, non-sensitive).
//
// POST /api/session/validate
//   Returns whether the caller's session is currently the active one.
//   Used by protected client flows to detect forced sign-out.
//
// GET  /api/session/status   (alias of validate)
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils';

const DEVICE_MAX_LEN = 120;

const registerSession = async (req, res) => {
  const { user, sessionId, status, body } = await authorizeRequest(req, { touch: false });
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { device_identifier } = req.body || {};
  const device = String(device_identifier || '').slice(0, DEVICE_MAX_LEN);

  try {
    const { data, error } = await supabase.rpc('register_session', {
      p_user_id: user.id,
      p_session_id: sessionId,
      p_device_identifier: device
    });
    if (error) {
      // Fallback if the migration hasn't been applied — insert directly.
      const fallback = await supabase
        .from('user_sessions')
        .upsert({
          user_id: user.id,
          session_id: sessionId,
          device_identifier: device,
          is_active: true
        }, { onConflict: 'session_id' })
        .select('id')
        .single();
      if (fallback.error) {
        console.error('Session register failed:', fallback.error.message);
        // Non-fatal: do not block login on telemetry failure.
        return res.status(200).json({ success: true, mode: 'degraded' });
      }
      return res.status(200).json({ success: true, mode: 'fallback', id: fallback.data?.id });
    }
    return res.status(200).json({ success: true, mode: 'strict', id: data });
  } catch (err) {
    console.error('Session register error:', err.message);
    return res.status(200).json({ success: true, mode: 'degraded' });
  }
};

const validateSession = async (req, res) => {
  const { user, revoked, sessionId, status } = await authorizeRequest(req, { touch: false });
  if (!user) {
    return res.status(status).json({
      authenticated: false,
      revoked: !!revoked,
      sessionId: sessionId || null
    });
  }
  return res.status(200).json({
    authenticated: true,
    revoked: false,
    active: true,
    sessionId: sessionId || null
  });
};

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && path.endsWith('/register')) {
    return registerSession(req, res);
  }
  if (req.method === 'POST' && (path.endsWith('/validate') || path.endsWith('/status'))) {
    return validateSession(req, res);
  }
  if (req.method === 'GET' && path.endsWith('/status')) {
    return validateSession(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
