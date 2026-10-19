// ============================================================================
// src/utils/reducedMotion.js
//
// The user's "reduce motion" preference, as a React hook.
//
// WHY IT EXISTS: AnonymousRoom.jsx had this as a local useMemo for months, so
// any new animated surface had to either copy it or ignore it. Extracting it
// here is the only way a new component can honour the preference without
// knowing the history.
//
// THE GLOBAL NET IS NOT ENOUGH on its own: App.jsx wraps the router in
// <MotionConfig reducedMotion="user"> (framer-motion) and src/index.css carries
// a prefers-reduced-motion block for the bespoke CSS keyframes. But framer's
// default is "never", so anything that animates WITHOUT opting in still moves
// for a user who asked it not to. Opt in per surface with this hook.
//
// NOTE: this reads the media query ONCE at mount and does not subscribe. That
// is deliberate — the value is a rendering preference, not state, and a live
// MediaQueryList listener on every animated page is cost with no benefit. A
// user who changes the OS setting mid-session gets it on the next navigation,
// which is what every other site does.
// ============================================================================

import { useMemo } from 'react';

export function usePrefersReducedMotion() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia !== 'function') return false;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }, []);
}

// Non-hook read, for code outside React (a plain helper deciding between a
// transform and no transform).
export function prefersReducedMotionNow() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
