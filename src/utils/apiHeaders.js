// Shared helper for authenticating requests to the Apex serverless API.
// Attaches the caller's access token AND a stable per-device session id.

const SESSION_KEY = 'apex_device_session_id';

// Stable opaque device id, persisted once per browser. Mapped server-side to a
// { session_id, device_identifier } row in user_sessions for device tracking
// and per-device revoke, without ever locking the user out (soft mode).
export const getDeviceSessionId = () => {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
};

// Mock-safe helper for test environments where localStorage/crypto may be absent.
export const getDeviceSessionIdSafe = () => {
  try {
    if (typeof localStorage !== 'undefined' && typeof crypto !== 'undefined') return getDeviceSessionId();
  } catch {
    return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

// Build base headers for Apex API calls: { Authorization, X-Session-Id }.
// Pass `{ json: true }` to also set Content-Type: application/json.
export const authHeaders = (session, { json = false } = {}) => {
  const headers = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  if (json) headers['Content-Type'] = 'application/json';
  try {
    headers['X-Session-Id'] = getDeviceSessionId();
  } catch {
    // device id is best-effort
  }
  return headers;
};
