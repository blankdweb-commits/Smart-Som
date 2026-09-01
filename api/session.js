// ============================================================
// Session Management API.
//
// Single-device enforcement was REMOVED (it caused false "signed in elsewhere"
// revocations and a per-request RPC round-trip). These endpoints are kept as
// stable no-op success responses so any client that still calls them receives
// a clean { authenticated:true, revoked:false } and is never locked out.
//
// POST /api/session/register  -> acknowledged, no enforcement
// POST /api/session/validate  -> always active for a valid token
// POST /api/session/status    -> alias of validate
// GET  /api/session/status    -> alias of validate
// ============================================================
import { getUserFromRequest } from './_utils';

const registerSession = async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  return res.status(200).json({ success: true, mode: 'noop' });
};

const validateSession = async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({
      authenticated: false,
      revoked: false,
      active: false,
      sessionId: null
    });
  }
  return res.status(200).json({
    authenticated: true,
    revoked: false,
    active: true,
    sessionId: req.headers['x-session-id'] || null
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
