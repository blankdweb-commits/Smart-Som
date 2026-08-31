import { createClient } from '@supabase/supabase-js';

// Service-role client for administrative server-side tasks.
export const getSupabaseAdmin = () => {
  const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Supabase environment variables are missing in production');
    }
    console.warn('Supabase environment variables are missing. Using local mock/fail mode.');
    return null;
  }

  return createClient(url, serviceKey);
};

// Resolve the authenticated user server-side from a Supabase access token.
// Never trust user identifiers supplied in request bodies.
export const getUserFromRequest = async (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
};

// Extract the raw Bearer token from a request (used for session_id lookups).
export const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7) || null;
};

// Single-device enforcement.
// Resolves the user AND verifies that their current access token matches the
// ACTIVE session recorded in user_sessions. If a newer session has revoked
// this one, returns { user:null, revoked:true } so the caller can respond
// with a 401 + specific "signed in elsewhere" signal.
// Also touches last_seen for telemetry.
export const getUserAndVerifySession = async (req, opts = {}) => {
  const user = await getUserFromRequest(req);
  if (!user) return { user: null, revoked: false };
  const token = getTokenFromRequest(req);
  // The session unique id is supplied by the client as an X-Session-Id header
  // (a per-device UUID persisted in localStorage). It is deliberately NOT
  // derived from identity fields — user.identities[0].id is identical across
  // all of a user's sessions, which would defeat single-device enforcement.
  // Fall back to the raw token slice only when the header is absent.
  const sessionId = req.headers['x-session-id'] || token || user.id;

  const supabase = getSupabaseAdmin();
  if (!supabase) return { user, revoked: false, sessionId };

  try {
    const { data, error } = await supabase.rpc('session_is_active', {
      p_user_id: user.id,
      p_session_id: sessionId
    });
    if (error) {
      // Function may not exist on env where migration-v10 hasn't run; degrade
      // to permissive (do not lock users out).
      return { user, revoked: false, sessionId };
    }
    if (data === false) {
      return { user, revoked: true, sessionId };
    }
    // Touch last_seen (best-effort; ignore errors).
    if (opts.touch !== false) {
      try {
        await supabase.rpc('touch_session', { p_user_id: user.id, p_session_id: sessionId });
      } catch { /* ignore */ }
    }
    return { user, revoked: false, sessionId };
  } catch {
    return { user, revoked: false, sessionId };
  }
};

// Convenience wrapper: returns { status, body, user } — a pre-built 401 when the
// session is revoked so routes can `return json(res, result.status, result.body)`.
export const authorizeRequest = async (req, opts = {}) => {
  const { user, revoked, sessionId } = await getUserAndVerifySession(req, opts);
  // Treat a revoked (superseded) session as unauthorized too: the user IS
  // authenticated, but their device is no longer the single active session.
  if (!user || revoked) {
    return { status: 401, body: { error: revoked ? 'SESSION_REVOKED' : 'Unauthorized' }, user: null, revoked, sessionId: null };
  }
  return { status: 200, body: null, user, revoked: false, sessionId };
};
