// Single source of truth for cookie / local-storage consent.
//
// One localStorage record holds the whole choice: version, timestamp, and the
// per-category grant state. Cross-tab changes are propagated through the
// `storage` event so every open tab stays consistent. Nothing is presumed:
// `undefined` means "not decided yet" (the obstructing overlay shows).
//
// NDPC GAID 2025 Art. 7(l): the consent UI visibly obstructs the page — that is
// handled in ConsentManager. FCCPC Reg. 4 (guidance, exposure draft): consent is
// a clear affirmative action, no pre-ticked boxes, rejection as easy as
// acceptance, and the user can withdraw later.

import { useCallback, useEffect, useState } from 'react';
import { safeGet, safeSet } from '../utils/safeStorage';
import { CONSENT_KEY, CONSENT_VERSION, CATEGORIES, categoryById, EMPTY_CONSENT } from '../config/cookieManifest';

const initial = () => {
  const raw = safeGet(CONSENT_KEY, { parsed: true });
  if (!raw || typeof raw !== 'object' || raw.version !== CONSENT_VERSION) return EMPTY_CONSENT;
  const categories = { ...EMPTY_CONSENT.categories };
  for (const c of CATEGORIES) {
    if (raw.categories && typeof raw.categories[c.id] === 'boolean') categories[c.id] = raw.categories[c.id];
  }
  return { ...EMPTY_CONSENT, version: raw.version, timestamp: raw.timestamp || null, categories, source: raw.source || null };
};

export const useCookieConsent = () => {
  const [consent, setConsent] = useState(() => initial());

  // Persist a decision. `source` records how it was made ('accept-all' |
  // 'reject-optional' | 'customise') so the audit trail is honest.
  const record = useCallback(
    (nextCategories, source) => {
      const next = {
        version: CONSENT_VERSION,
        timestamp: new Date().toISOString(),
        categories: { ...CATEGORIES.reduce((acc, c) => ({ ...acc, [c.id]: c.defaultGranted }), {}), ...nextCategories },
        source,
      };
      safeSet(CONSENT_KEY, JSON.stringify(next));
      setConsent(next);
      return next;
    },
    []
  );

  const grantCategory = useCallback(
    (id, granted) => {
      setConsent((prev) => {
        const next = {
          ...prev,
          timestamp: new Date().toISOString(),
          categories: { ...prev.categories, [id]: granted },
          source: 'customise',
        };
        safeSet(CONSENT_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const acceptAll = useCallback(() => {
    const next = Object.fromEntries(CATEGORIES.map((c) => [c.id, true]));
    return record(next, 'accept-all');
  }, [record]);

  const rejectOptional = useCallback(() => {
    const next = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.optional ? false : c.defaultGranted]));
    return record(next, 'reject-optional');
  }, [record]);

  const granted = useCallback(
    (id) => {
      const cat = categoryById(id);
      if (!cat) return false;
      if (!cat.optional) return true; // necessary is always treated as granted
      return !!consent.categories[id];
    },
    [consent.categories]
  );

  // Keep every tab in sync when another tab writes the consent record.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== CONSENT_KEY || !event.newValue) return;
      try {
        const next = JSON.parse(event.newValue);
        if (next && next.version === CONSENT_VERSION) setConsent(next);
      } catch {
        // ignore malformed records from other origins/tabs
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [consent]);

  // Seed the state once from storage so a page reload after a decision does not
  // flash the obstructing overlay.
  useEffect(() => {
    const seeded = initial();
    if (seeded.timestamp) setConsent(seeded);
  }, []);

  return {
    consent,
    granted,
    grantCategory,
    acceptAll,
    rejectOptional,
    hasDecided: !!consent.timestamp,
    isMarketingGranted: granted('marketing'),
    isAnalyticsGranted: granted('analytics'),
    isPreferencesGranted: granted('preferences'),
  };
};

export default useCookieConsent;
