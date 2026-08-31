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
