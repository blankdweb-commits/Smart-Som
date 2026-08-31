// Shared helper for authenticating requests to the Apex serverless API.
// Attaches the caller's access token AND the per-device session id (so the
// server can enforce single-device access).

import { safeGet, safeSet, generateUuid } from './safeStorage';

const DEVICE_KEY = 'apex_device_session';

// Stable per-device id, persisted. Created lazily on first use. When storage
// is unavailable (Safari private browsing / blocked WebKit storage) we fall
// back to an in-memory id so auth calls still carry a session id and the app
// never throws. Per-tab persistence is lost on close, which is acceptable for
// the single-device best-effort.
let memoryDeviceId = null;

export const getDeviceSessionId = () => {
  // Try to read an existing persisted id first.
  const persisted = safeGet(DEVICE_KEY);
  if (persisted) return persisted;

  // No persisted id yet: generate one and try to persist it (no-op if storage
  // unavailable). Accept the generated value regardless.
  const id = generateUuid();
  safeSet(DEVICE_KEY, id);
  if (safeGet(DEVICE_KEY)) return id;

  // Persistence failed -> stable in-memory fallback so we don't generate a new
  // id on every call.
  if (!memoryDeviceId) memoryDeviceId = generateUuid();
  return memoryDeviceId;
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
