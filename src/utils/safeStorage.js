// Safe browser storage helpers.
//
// Safari (especially Private Browsing) and WebKit can throw a DOMException on
// ANY localStorage access (SecurityError / QuotaExceededError). An uncaught
// DOMException during app initialization blanks the whole screen. These helpers
// guard every storage read/write: probe availability with a throw-away
// test write, then only touch storage when it actually works. They never throw.

const TEST_KEY = '__apex_storage_test__';

// Returns true only if localStorage is genuinely usable right now. The probe is
// a write-read-delete round trip so blocked / full / private-mode storage
// (which can throw even on read) is detected up front.
let availabilityChecked = false;
let storageAvailable = false;

export const isStorageAvailable = () => {
  if (availabilityChecked) return storageAvailable;
  availabilityChecked = true;
  try {
    const probe = TEST_KEY + Date.now();
    window.localStorage.setItem(probe, '1');
    const ok = window.localStorage.getItem(probe) === '1';
    window.localStorage.removeItem(probe);
    storageAvailable = ok;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
};

// Read a value; returns null when storage is unavailable or the key is absent.
// Never throws. `parsed` is optional: when true, JSON.parse is applied safely.
export const safeGet = (key, { parsed = false } = {}) => {
  if (!isStorageAvailable()) return parsed ? null : undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return parsed ? null : undefined;
    if (!parsed) return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  } catch {
    return parsed ? null : undefined;
  }
};

// Write a value; no-op when storage is unavailable. Never throws.
export const safeSet = (key, value) => {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore storage errors */
  }
};

// Remove a key; no-op when storage is unavailable. Never throws.
export const safeRemove = (key) => {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore storage errors */
  }
};

// ---------------------------------------------------------------------------
// Frequency-capped prompts.
//
// Every dismissal in this app so far is one-shot: a key is written and the
// surface never returns (`apex:pushOptInDismissed`, `apex:quizTapHintSeen`).
// That is correct for a prompt shown once ever and wrong for a contextual
// upsell, which is BY DEFINITION shown repeatedly: one dismissal must not
// silence the prompt forever, and showing it every time is how a product
// becomes annoying.
//
// The rule here is therefore time-based with a hard attempt ceiling:
//   * the prompt may be seen at most `maxPerWindow` times per `windowMs`,
//   * once the ceiling is hit it stays hidden until the window rolls,
//   * storage being unavailable degrades to "show it" (never to "hide it"),
//     because silently muting a revenue surface on a device with storage
//     disabled is a worse failure than showing it once too often.
// ---------------------------------------------------------------------------
const FREQ_STATE_VERSION = 1;

// Is this prompt allowed to appear right now? Never throws.
// `now` is injectable so the rule is testable without waiting in real time.
export const isPromptAllowed = (key, { windowMs, maxPerWindow = 2, now = Date.now() } = {}) => {
  if (!windowMs) return true;
  const state = safeGet(`freq:${key}`, { parsed: true });
  if (!state || typeof state !== 'object' || state.v !== FREQ_STATE_VERSION) return true;

  const since = Array.isArray(state.at) ? state.at.filter((t) => typeof t === 'number') : [];
  const live = since.filter((t) => now - t < windowMs);

  // A corrupted or future-dated clock must not lock the prompt shut forever.
  if (since.some((t) => t > now + 60000)) return true;

  return live.length < maxPerWindow;
};

// Record that the prompt was shown. Never throws.
export const notePromptShown = (key, { windowMs, maxPerWindow = 2, now = Date.now() } = {}) => {
  if (!windowMs) return;
  const state = safeGet(`freq:${key}`, { parsed: true });
  const prior = state && state.v === FREQ_STATE_VERSION && Array.isArray(state.at) ? state.at : [];
  const live = prior.filter((t) => typeof t === 'number' && now - t < windowMs && t <= now + 60000);
  // Trim to the ceiling so the stored list cannot grow without bound.
  const next = [...live, now].slice(-Math.max(1, maxPerWindow));
  safeSet(`freq:${key}`, JSON.stringify({ v: FREQ_STATE_VERSION, at: next }));
};

// Forget a prompt's history — used when the surface should be allowed again
// (e.g. the user actually upgraded, so the prompt is no longer relevant).
export const resetPromptFrequency = (key) => safeRemove(`freq:${key}`);

// Safari-safe UUID generator. Uses crypto.randomUUID() when available, otherwise
// falls back to a deterministic-ish random UUID polyfill that never touches
// crypto.getRandomValues (which may itself be restricted). Never throws.
export const generateUuid = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to polyfill */
  }
  // RFC4122 v4 fallback, crypto-free.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
