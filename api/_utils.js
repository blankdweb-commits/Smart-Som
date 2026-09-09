import { createClient } from '@supabase/supabase-js';

// CORS / origin locking for the browser-facing API. The backend lives on the
// same origin as the app in production (www.polynurse.com.ng), so cross-origin
// calls are never legitimate from end users — block them instead of echoing
// '*'. Server-to-server callers (scripts, the Paystack webhook, health checks)
// send no Origin header and are always allowed; the webhook is additionally
// authenticated by its x-paystack-signature.
export const APP_ORIGINS = [
  'https://www.polynurse.com.ng',
  'https://polynurse.com.ng',
  'http://localhost:5173',
  'http://localhost:3001',
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // non-browser caller (webhook, scripts, CURL)
  if (APP_ORIGINS.includes(origin)) return true;
  // Vercel preview deployments (feature branches) are served from *.vercel.app.
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
  return false;
};

// Sets reflected CORS headers when the request is allowed. Returns false (and
// sends no headers) when a browser origin is NOT on the allowlist, so the
// handler can respond 403 before doing any work.
export const applyCors = (req, res) => {
  const origin = req.headers?.origin || req.headers?.Origin;
  if (!isAllowedOrigin(origin)) return false;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
  }
  return true;
};

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

// Sentinels for downstream auth failures that are NOT the client's fault. When
// the Supabase auth service is unreachable (transient DNS/network), the request
// never reached the token verification step — surface a 502 instead of a bogus
// 401 so clients can distinguish "you are not authenticated" from "the auth
// service is down right now".
const authServiceUnavailable = () =>
  Object.assign(new Error('Supabase auth service unreachable'), { code: 'AUTH_SERVICE_UNAVAILABLE' });

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
    throw authServiceUnavailable();
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
  let user;
  try {
    user = await getUserFromRequest(req);
  } catch (err) {
    if (err?.code === 'AUTH_SERVICE_UNAVAILABLE') {
      return { user: null, revoked: false, upstreamError: err };
    }
    return { user: null, revoked: false };
  }
  if (!user) return { user: null, revoked: false };
  const token = getTokenFromRequest(req);
  const sessionId = req.headers['x-session-id'] || token || user.id || null;
  return { user, revoked: false, sessionId };
};

// Convenience wrapper: returns { status, body, user } with a pre-built 401 when
// the request is unauthenticated, or a 502 when the auth service itself is
// unreachable (transient infrastructure failure, not a signed-out user).
export const authorizeRequest = async (req) => {
  const { user, sessionId, upstreamError } = await getUserAndVerifySession(req);
  if (upstreamError) {
    return {
      status: 502,
      body: { error: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service temporarily unavailable. Please retry.' },
      user: null,
      revoked: false,
      sessionId: null,
    };
  }
  if (!user) {
    return { status: 401, body: { error: 'Unauthorized' }, user: null, revoked: false, sessionId: null };
  }
  return { status: 200, body: null, user, revoked: false, sessionId };
};
