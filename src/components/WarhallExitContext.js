// The Warhall exit-guard CONTEXT and its hook.
//
// The hook lives here, NOT in WarhallExitGuard.jsx: a file that exports both
// a component and a non-component breaks react-refresh (the same reason
// BLOCKED_COPY was moved to src/data/challengeCopy.js).
//
// The default value is a COMPLETE no-op, so `useWarhallExit()` never throws
// and never needs a try/catch around it — a hook inside a try/catch is a
// conditional hook, which React forbids.
import { createContext, useContext } from 'react';

export const WarhallExitContext = createContext({
  isInWarhall: false,
  isInActiveDuel: false,
  registerDuelState: () => {},
  requestNavigation: async () => true,
});

export const useWarhallExit = () => useContext(WarhallExitContext);

export default WarhallExitContext;
