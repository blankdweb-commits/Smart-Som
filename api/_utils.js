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

// Resolves the authenticated user from a request bearer token.
// Single-device enforcement has been REMOVED (it caused false "signed in
// elsewhere" revocations and added a per-request RPC round-trip). The server
// no longer checks user_sessions; it only authenticates via the access token.
export const getUserAndVerifySession = async (req) => {
  const user = await getUserFromRequest(req);
  if (!user) return { user: null, revoked: false };
  const token = getTokenFromRequest(req);
  const sessionId = req.headers['x-session-id'] || token || user.id || null;
  return { user, revoked: false, sessionId };
};

// Convenience wrapper: returns { status, body, user } with a pre-built 401 when
// the request is unauthenticated.
export const authorizeRequest = async (req) => {
  const { user, sessionId } = await getUserAndVerifySession(req);
  if (!user) {
    return { status: 401, body: { error: 'Unauthorized' }, user: null, revoked: false, sessionId: null };
  }
  return { status: 200, body: null, user, revoked: false, sessionId };
};
