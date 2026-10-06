import { createContext, useContext } from 'react';

// Shared context for the controlled AdSense policy. Declared in its own module
// so AdSenseManager.jsx only exports components (React Fast Refresh rule).
export const AdsContext = createContext({ adsEnabled: false });

export const useAds = () => useContext(AdsContext);