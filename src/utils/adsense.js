// Singleton loader for the Google AdSense publisher script.
//
// The <script> is injected ONCE, lazily, and only after the route-aware manager
// determines the current screen is authorised to show ads. Re-renders, route
// changes, Strict Mode double-effects, component remounts and browser
// back/forward can call this repeatedly without ever inserting a second copy.

export const ADSENSE_SCRIPT_SELECTOR = 'script[src*="adsbygoogle.js"]';

let loadPromise = null;

export const isAdSenseScriptPresent = () =>
  typeof document !== 'undefined' && !!document.querySelector(ADSENSE_SCRIPT_SELECTOR);

export const loadAdSenseScript = (client) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }
  // Duplicate protection: an existing tag (from a prior mount, a Strict Mode
  // double-invoke, or a hot reload) is reused as-is.
  if (isAdSenseScriptPresent()) return Promise.resolve(true);
  if (!loadPromise) {
    loadPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
      script.crossOrigin = 'anonymous';
      script.setAttribute('data-poly-adsense', 'controlled');
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }
  return loadPromise;
};

// Test/hot-reload helper. The DOM tag is intentionally NOT removed so the
// querySelector guard above stays authoritative.
export const resetAdSenseLoader = () => {
  loadPromise = null;
};