// Per-visit Anonymous room identity key (WS3).
//
// A "visit" is one browser tab session. The key is minted once and kept in
// sessionStorage, so a page RELOAD keeps the same pseudonym while a NEW tab (or
// a returning visit after the tab closed) gets a fresh one — the server then
// re-rolls the member's "Anonymous #NN" so they cannot be correlated across
// visits. Membership/seats are untouched; this only distinguishes visits.

const VISIT_KEY_STORAGE = 'apex:anon_visit_key';
const VISIT_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const getAnonVisitKey = () => {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    let key = sessionStorage.getItem(VISIT_KEY_STORAGE);
    if (key && VISIT_KEY_RE.test(key)) return key;
    const raw =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    key = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!VISIT_KEY_RE.test(key)) return null;
    sessionStorage.setItem(VISIT_KEY_STORAGE, key);
    return key;
  } catch {
    return null;
  }
};

// Forgets the current visit. Called after a CONFIRMED voluntary leave so the
// next join presents a fresh visit key — and therefore a fresh Anonymous #NN —
// instead of short-circuiting on this tab's existing pseudonym. Membership and
// seat are untouched; only the identity changes.
export const clearAnonVisitKey = () => {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(VISIT_KEY_STORAGE);
  } catch {
    /* storage unavailable — the server-side identity drop is the real control */
  }
};

export default getAnonVisitKey;
