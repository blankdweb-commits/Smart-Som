// ============================================================
// Session Management API -- soft-by-default, configurable strict.
//
// Enforcement is DB-backed via app_settings.session_mode ('soft'|'strict').
//   soft   (default)  register/touch devices, never auto-revoke. Multi-device OK.
//   strict            single-active-device with a 10-min grace window; only
//                     quiet devices older than the grace are revoked.
//
// Endpoints (all live under a single /api/session serverless function):
//   POST /api/session/register -> body { device_identifier? }
//   POST /api/session/validate -> (alias of status)
//   GET  /api/session/status   -> { authenticated, active, sessionMode, revoked }
//   POST /api/session/touch    -> heartbeat for this session
//   GET  /api/session/devices  -> active device rows (masked)
//   POST /api/session/revoke   -> body { session_id? , device_identifier? }
// ============================================================
import { getSupabaseAdmin, getUserFromRequest, getTokenFromRequest } from './_utils.js';

// Server-side session mode, cached briefly to avoid a DB hit every request.
let modeCache = { value: null, at: 0 };
async function getMode(supabase) {
  if (modeCache.value && Date.now() - modeCache.at < 5000) return modeCache.value;
  let mode = 'soft';
  try {
    const { data } = await supabase.rpc('get_session_mode');
    if (data) mode = data;
  } catch {}
  modeCache = { value: mode, at: Date.now() };
  return mode;
}

// Attach the caller-supplied X-Session-Id, falling back to the JWT sub / token.
const deviceIdFrom = (req) =>
  String(req.headers['x-session-id'] || getTokenFromRequest(req) || '').slice(0, 64) || null;

const register = async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const sessionId = deviceIdFrom(req);
  if (!sessionId) return res.status(400).json({ error: 'Missing session id' });

  const deviceName = String(req.body?.device_identifier || req.headers['user-agent'] || '').slice(0, 120);
  const mode = await getMode(supabase);

  try {
    if (mode === 'strict') {
      await supabase.rpc('register_session', {
        p_user_id: user.id,
        p_session_id: sessionId,
        p_device_identifier: deviceName,
        p_grace_seconds: 600
      });
    } else {
      await supabase.rpc('register_session_soft', {
        p_user_id: user.id,
        p_session_id: sessionId,
        p_device_identifier: deviceName
      });
    }
  } catch (err) {
    console.error('Session register error:', err.message);
    return res.status(500).json({ error: 'Failed to register session' });
  }

  return res.status(200).json({ success: true, sessionMode: mode, sessionId });
};

const touch = async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = getSupabaseAdmin();
  const sessionId = deviceIdFrom(req) || user.id;
  if (supabase) {
    try { await supabase.rpc('touch_session', { p_user_id: user.id, p_session_id: sessionId }); }
    catch (err) { console.error('Session touch error:', err.message); }
  }
  return res.status(200).json({ success: true });
};

const status = async (req, res) => {
  const user = await getUserFromRequest(req);
  const supabase = getSupabaseAdmin();
  const mode = supabase ? await getMode(supabase) : 'soft';

  if (!user) {
    return res.status(200).json({ authenticated: false, active: false, revoked: false, sessionMode: mode, sessionId: null });
  }

  // In strict mode, surface revocation without hard-locking legacy users who
  // never registered a session row (no row => still allowed).
  let revoked = false;
  if (mode === 'strict' && supabase) {
    const sessionId = deviceIdFrom(req);
    if (sessionId) {
      try {
        const { data } = await supabase.rpc('session_is_active', { p_user_id: user.id, p_session_id: sessionId });
        if (data === false) revoked = true;
      } catch {}
    }
  }

  return res.status(200).json({
    authenticated: true,
    active: !revoked,
    revoked,
    sessionMode: mode,
    sessionId: deviceIdFrom(req)
  });
};

const devices = async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { data, error } = await supabase.rpc('list_active_sessions', { p_user_id: user.id });
    if (error) throw error;
    const currentSession = deviceIdFrom(req);
    const mapped = (data || []).map(s => ({
      ...s,
      current: currentSession ? String(s.session_display || '') === String(currentSession).slice(0, 12) : false
    }));
    return res.status(200).json({ devices: mapped, sessionMode: await getMode(supabase) });
  } catch (err) {
    console.error('Session devices error:', err.message);
    return res.status(500).json({ error: 'Failed to list devices' });
  }
};

const revoke = async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const sessionId = String(req.body?.session_id || '');
  const deviceName = String(req.body?.device_identifier || '');

  try {
    if (sessionId) {
      await supabase.rpc('revoke_session', { p_user_id: user.id, p_session_id: sessionId, p_device_identifier: '' });
    } else if (deviceName) {
      await supabase.rpc('revoke_session', { p_user_id: user.id, p_session_id: '', p_device_identifier: deviceName });
    } else {
      return res.status(400).json({ error: 'Nothing to revoke' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Session revoke error:', err.message);
    return res.status(500).json({ error: 'Failed to revoke session' });
  }
};

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'POST' && path.endsWith('/register')) return register(req, res);
  if (req.method === 'POST' && path.endsWith('/touch')) return touch(req, res);
  if (req.method === 'POST' && path.endsWith('/revoke')) return revoke(req, res);
  if (req.method === 'GET' && path.endsWith('/devices')) return devices(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && (path.endsWith('/validate') || path.endsWith('/status'))) {
    return status(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
