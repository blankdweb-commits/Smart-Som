// Central Google AdSense policy — the SINGLE source of truth for where ads may
// appear in PolyNurse. The manager, loader and slot components all read from
// here; nothing else decides ad placement.
//
// Allowed:   Dashboard, Community, Voting.
// Blocked:   every other screen — most importantly the ACTIVE QUIZ, which must
//            stay distraction-free. Unknown routes fail CLOSED (ads off).

// The AdSense account (client id). A VITE_ADSENSE_CLIENT override wins so a
// staging account or a different publisher can be used without editing code.
const adEnv = () => (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const ADSENSE_PUBLISHER_ID = 'ca-pub-7731141426940208';

export const ADSENSE_CLIENT = adEnv().VITE_ADSENSE_CLIENT || ADSENSE_PUBLISHER_ID;

// Strict application-level rule. Every product area is listed; only the three
// authorised areas are `true`. Anything not listed resolves to `false`.
export const ADS_POLICY = Object.freeze({
  dashboard: true,
  community: true,
  voting: true,

  quiz: false,
  quizSetup: false,
  quizResults: false,
  activeQuiz: false,
  flashcards: false,
  login: false,
  signup: false,
  profile: false,
  settings: false,
  marketplace: false,
  checkout: false,
  payment: false,
  other: false,
});

// Premium subscribers are NOT automatically ad-free. Hiding ads is an explicit,
// product-level decision, so it lives here as configuration rather than being
// invented in code (`isPremium` below comes from the server-verified
// subscription status in AppContext, never from localStorage).
export const ADS_PREMIUM_POLICY = Object.freeze({
  hideForPremium: false,
});

// Real route bases for the three allowed areas. `resolveAdArea` requires an
// EXACT base match or a real child path (`base + '/'`), so an unrelated route
// can never sneak in just because it shares a prefix (e.g. `/community-xyz`).
export const ADSENSE_ALLOWED_BASES = Object.freeze([
  { base: '/dashboard', area: 'dashboard' },
  { base: '/community', area: 'community' },
  { base: '/voting', area: 'voting' },
]);

// Fail-closed route matcher → returns the allowed area key or null.
export const resolveAdArea = (pathname) => {
  if (typeof pathname !== 'string') return null;
  for (const { base, area } of ADSENSE_ALLOWED_BASES) {
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      return ADS_POLICY[area] === true ? area : null;
    }
  }
  return null;
};

export const isAllowedAdRoute = (pathname) => resolveAdArea(pathname) !== null;

// One ad slot per placement. Paste the slot ids from the AdSense dashboard
// (Ads → In-page ads → create a slot) into the matching VITE_* variables.
// A placement with an empty slot id resolves to no ad.
export const ADSENSE_PLACEMENTS = Object.freeze({
  'dashboard-content': adEnv().VITE_ADSENSE_SLOT_DASHBOARD || '',
  'community-feed': adEnv().VITE_ADSENSE_SLOT_COMMUNITY || '',
  'voting-content': adEnv().VITE_ADSENSE_SLOT_VOTING || '',
});

export const getPlacementSlotId = (placement) => ADSENSE_PLACEMENTS[placement] || '';