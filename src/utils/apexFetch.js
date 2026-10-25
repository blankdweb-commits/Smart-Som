// Shared server-API client primitives.
//
// Root-cause fix for Anonymous-room rejoin auth: the old communityApi was a thin
// fetch that NEVER handled a 401, so after a leave→rejoin cycle (which can leave
// the browser holding an access token that just expired) every community call
// failed until a full reload re-read the session. This module makes EVERY Apex
// /api call auth-aware:
//
//   1. On a 401 that WAS sent with a bearer token, we refresh the Supabase
//      session ONCE (module-level single-flight, shared with AppContext so a
//      burst never fires parallel refreshSession() calls against the same
//      single-use refresh token) and replay the request with the fresh token.
//   2. Transient network failures surface as a recoverable ApiError and NEVER
//      tear the session down — a slow/offline network must not log the user out.
//   3. A definitive refresh failure (bad/invalid session, revoked token) throws
//      code 'AUTH_EXPIRED' so callers can land the user on the login screen.

import { supabase } from './supabase';

let refreshInFlight = null;
let lastSuccessfulRefreshAt = 0;
let cachedFreshSession = null;

// Whether a refresh failure looks like a transient network problem (vs. a hard
// auth rejection). Transient failures must NOT tear the session down.
const isNetworkyError = (msg) =>
  /fetch|network|timeout|timed out|load failed|ERR_|abort|socket|DNS|ECONN|Failed to fetch/i.test(String(msg || ''));

// Coalesced single-flight token refresh. Concurrent callers share ONE
// refreshSession() call; a refresh that just succeeded is reused for 5s.
export async function ensureFreshSessionToken() {
  if (!supabase) return { session: null, recoverable: true };
  if (lastSuccessfulRefreshAt && Date.now() - lastSuccessfulRefreshAt < 5000 && cachedFreshSession?.access_token) {
    return { session: cachedFreshSession, recoverable: true };
  }
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth
      .refreshSession()
      .then((r) => {
        if (r?.data?.session?.access_token) cachedFreshSession = r.data.session;
        return r;
      })
      .catch((err) => ({ error: err }))
      .finally(() => { refreshInFlight = null; });
  }
  const result = await refreshInFlight;
  const session = result?.data?.session;
  if (session?.access_token) {
    lastSuccessfulRefreshAt = Date.now();
    cachedFreshSession = session;
    return { session, recoverable: true };
  }
  return { session: null, recoverable: isNetworkyError(result?.error?.message || result?.error?.status) };
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', recoverable = false, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.recoverable = recoverable;
    this.data = data;
  }

  get authExpired() {
    return this.code === 'AUTH_EXPIRED';
  }

  get networkError() {
    return this.recoverable && this.status === 0;
  }
}

const errorMessage = (data) => {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (typeof data.message === 'string' && data.message.trim()) return data.message;
  if (typeof data.error === 'string' && data.error.trim()) return data.error;
  if (data.error && typeof data.error === 'object') {
    if (typeof data.error.message === 'string' && data.error.message.trim()) return data.error.message;
    if (typeof data.error.code === 'string' && data.error.code.trim()) return data.error.code;
  }
  if (typeof data.error_code === 'string' && data.error_code.trim()) return data.error_code;
  return null;
};

const errorCode = (data) => {
  if (!data) return 'REQUEST_FAILED';
  if (typeof data.error === 'string' && data.error.trim()) return data.error;
  if (data.error && typeof data.error === 'object' && typeof data.error.code === 'string' && data.error.code.trim()) {
    return data.error.code;
  }
  if (typeof data.error_code === 'string' && data.error_code.trim()) return data.error_code;
  return 'REQUEST_FAILED';
};

// Auth-aware fetch against a same-origin /api endpoint. On a 401 that carried a
// bearer token, refreshes the session once (single-flight) and replays the
// request with the fresh token. Guarantees a JSON result or throws ApiError.
export async function apiFetch(relativePath, {
  method = 'POST',
  headers = {},
  body,
  token,
  retryOnAuth = true,
  timeoutMs = 20000,
} = {}) {
  const url = relativePath.startsWith('http') ? relativePath : `/api${relativePath}`;
  const baseHeaders = { ...headers };
  if (token) baseHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined && !baseHeaders['Content-Type']) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  const doFetch = async (requestHeaders) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const opts = { method, headers: requestHeaders, signal: controller.signal };
    if (body !== undefined) opts.body = JSON.stringify(body);
    try {
      let res;
      let text;
      try {
        res = await fetch(url, opts);
        text = await res.text();
      } catch (err) {
        if (err?.name === 'AbortError') {
          throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Please retry.`, {
            code: 'TIMEOUT',
            recoverable: true,
            data: { cause: 'timeout' },
          });
        }
        throw new ApiError(`Network request failed: ${err.message}`, {
          code: 'NETWORK',
          recoverable: true,
          data: { cause: err.message },
        });
      }

      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // Non-JSON body (e.g. an SPA HTML fallback from a broken deploy).
        data = null;
      }
      if (!res.ok) {
        throw new ApiError(errorMessage(data) || res.statusText || 'Request failed', {
          status: res.status,
          code: errorCode(data),
          recoverable: res.status >= 500 || res.status === 429,
          data,
        });
      }
      return data ?? {};
    } finally {
      clearTimeout(timer);
    }
  };

  // The Vite dev proxy answers 503 API_SERVER_UNREACHABLE while the API child
  // is restarting. Only GETs are safe to replay; never retry a mutation.
  const fetchWithSafeGetRetry = async (requestHeaders) => {
    try {
      return await doFetch(requestHeaders);
    } catch (err) {
      if (method !== 'GET' || !(err instanceof ApiError) || err.status !== 503 || err.code !== 'API_SERVER_UNREACHABLE') {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
      return doFetch(requestHeaders);
    }
  };

  // A token is explicitly required for community/authenticated endpoints. If the
  // caller asked for auth but has no token yet, tell them auth isn't ready
  // rather than firing an anonymous 401 that would be misinterpreted.
  if (retryOnAuth && !token) {
    throw new ApiError('You need to be signed in.', { code: 'AUTH_NOT_READY', status: 401 });
  }

  try {
    return await fetchWithSafeGetRetry(baseHeaders);
  } catch (err) {
    const hadBearer = /^Bearer\s+\S+/.test(baseHeaders.Authorization || '') || !!token;
    if (!(err instanceof ApiError) || err.status !== 401 || !hadBearer || !retryOnAuth) throw err;
    const { session: freshSession, recoverable } = await ensureFreshSessionToken();
    if (freshSession?.access_token) {
      const replayHeaders = { ...baseHeaders, Authorization: `Bearer ${freshSession.access_token}` };
      try {
        return await fetchWithSafeGetRetry(replayHeaders);
      } catch (replayErr) {
        if (replayErr instanceof ApiError && replayErr.status === 401) {
          throw new ApiError(replayErr.message, { status: replayErr.status, code: 'AUTH_EXPIRED', data: replayErr.data });
        }
        throw replayErr;
      }
    }
    if (recoverable) {
      throw new ApiError('Session refresh failed — check your connection.', { code: 'NETWORK', recoverable: true });
    }
    throw new ApiError('Your session has expired. Please sign in again.', { code: 'AUTH_EXPIRED', status: 401 });
  }
}

export default apiFetch;