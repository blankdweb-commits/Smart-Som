// Tiny UI-only context: lets any page (e.g. Settings) request that the
// singleton ConsentManager re-open so the user can change or withdraw consent.
// Consent state itself lives in useCookieConsent (localStorage); this context
// only controls whether the manager's overlay is shown on top of an already
// recorded decision.

import { createContext, useContext, useState } from 'react';

const ConsentUIContext = createContext(null);

export const ConsentUIProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ConsentUIContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </ConsentUIContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useConsentUI = () => {
  const ctx = useContext(ConsentUIContext);
  if (!ctx) throw new Error('useConsentUI must be used within a ConsentUIProvider');
  return ctx;
};

export default ConsentUIContext;
