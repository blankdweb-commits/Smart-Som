// Shared helper for authenticating requests to the Apex serverless API.
// Attaches the caller's access token AND the per-device session id (so the
// server can enforce single-device access).

const DEVICE_KEY = 'apex_device_session';

// Stable per-device id, persisted. Created lazily on first use.
export const getDeviceSessionId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        (crypto?.randomUUID?.() ||
          ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ (crypto?.getRandomValues?.(new Uint8Array(1))[0] || (Math.random() * 16) | 0) & 15).toString(16)
          )) || 'unknown-device';
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
};

// Build base headers for Apex API calls: { Authorization, X-Session-Id }.
// Pass `{ json: true }` to also set Content-Type: application/json.
export const authHeaders = (session, { json = false } = {}) => {
  const headers = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const sid = getDeviceSessionId();
  if (sid) headers['X-Session-Id'] = sid;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
};
