import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { useQuizActive } from '../../hooks/useQuizActive';
import {
  ADSENSE_CLIENT,
  ADS_PREMIUM_POLICY,
  resolveAdArea,
} from '../../config/ads';
import { isAdSenseScriptPresent, loadAdSenseScript } from '../../utils/adsense';
import { AdsContext } from './adsContext';

// Single decision point for the whole app. It resolves, per route + state,
// whether ads are allowed and provides that answer to every <AdSenseSlot>.
// It loads the publisher script ONLY when the answer is yes, so forbidden
// screens never request it.
//
//   route change → resolve area → explicitly allowed?
//      YES (and no active quiz) → enable ads + lazy-load the script
//      NO / unknown / active quiz → ads OFF (fail closed)

export const AdSenseManager = ({ children }) => {
  const { pathname } = useLocation();
  const quizActive = useQuizActive();
  const { isPremium, session } = useAppContext();
  const [scriptOk, setScriptOk] = useState(isAdSenseScriptPresent());

  const adsEnabled = useMemo(() => {
    // Every ad-enabled area sits behind RequireAuth. Requiring a real session
    // means an anonymous hit on /dashboard (or a transient redirect to /login)
    // never triggers a script load — fail closed until auth is known.
    if (!session) return false;
    // An active quiz overrides the route rule — never distract a quiz.
    if (quizActive) return false;
    const area = resolveAdArea(pathname);
    if (!area) return false;
    if (ADS_PREMIUM_POLICY.hideForPremium && isPremium) return false;
    return true;
  }, [session, pathname, quizActive, isPremium]);

  useEffect(() => {
    if (!adsEnabled) return undefined;
    let active = true;
    loadAdSenseScript(ADSENSE_CLIENT).then((ok) => {
      if (active) setScriptOk(ok);
    });
    return () => {
      active = false;
    };
  }, [adsEnabled]);

  const value = useMemo(() => ({ adsEnabled, scriptOk }), [adsEnabled, scriptOk]);

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
};

export default AdSenseManager;