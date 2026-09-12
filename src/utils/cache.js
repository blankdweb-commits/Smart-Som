// src/utils/cache.js
//
// Minimal in-memory cache for UNSENSITIVE, PUBLIC data only.
//
// SECURITY RULE: this module is a pure performance layer. It must NEVER store
// user-scoped, private, or server-authoritative state that could change on a
// per-user / per-moment basis. Everything below is handled by the live server
// and must NOT be cached here:
//   - quota availability, cooldowns, difficulty unlocks, payment/verify status
//   - session validity, membership, spectator mode, permissions, moderation
//   - private user data (profile, ledger, transactions, analytics)
//   - ephemeral community content (feed, comments, live posts with lives_until)
//
// Only whole-of-app public metadata (static subscription plans, achievement
// definitions, group metadata counts) is safe here, and even then a cache read
// is treated as display-only — any purchase/access decision is re-validated
// against the server before it is acted on.
const TTL = {
  STATIC: 24 * 60 * 60 * 1000,
  COMMUNITY_META: 15 * 1000,
};

let store = new Map();
let inFlight = new Map();

export const cacheTtl = TTL;

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt != null && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs) {
  if (value === undefined || value === null) return value;
  store.set(key, { value, expiresAt: ttlMs == null ? null : Date.now() + ttlMs });
  return value;
}

export function cacheDelete(key) {
  store.delete(key);
}

export function cacheClear(prefix) {
  if (!prefix) return;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheClearAll() {
  store.clear();
}

// Coalesces concurrent callers of the same logical fetch into one network
// promise. Pure in-flight dedupe — no TTL, nothing persists after settle.
export function dedupe(key, fetcher) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(fetcher)
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

// Cache-first read. On a cached hit (optional) kicks off a background
// revalidation that refreshes the entry without blocking the caller; on a miss
// fetches, stores, and returns. Any fetch failure falls back to the cached
// value (if present) rather than failing the caller.
export async function getCacheFirst(key, fetcher, { ttlMs, staleWhileRevalidate = false } = {}) {
  const hit = cacheGet(key);
  if (hit !== undefined) {
    if (staleWhileRevalidate) {
      dedupe(`${key}:revalidate`, async () => {
        const value = await fetcher();
        cacheSet(key, value, ttlMs);
        return value;
      }).catch(() => {
        // keep serving stale data; next read retries revalidation
      });
    }
    return hit;
  }
  try {
    return await dedupe(key, async () => {
      const value = await fetcher();
      cacheSet(key, value, ttlMs);
      return value;
    });
  } catch (err) {
    const stale = cacheGet(key);
    if (stale !== undefined) return stale;
    throw err;
  }
}

export const cache = {
  get: cacheGet,
  set: cacheSet,
  delete: cacheDelete,
  clear: cacheClear,
  clearAll: cacheClearAll,
  dedupe,
  getCacheFirst,
  TTL,
};

export default cache;