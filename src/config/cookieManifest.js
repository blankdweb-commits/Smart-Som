// Central consent configuration — single source of truth for every browser
// storage key and third-party script PolyNurse loads.
//
// CONFIRMED FROM CODE: each entry below was located in the codebase; nothing is
// invented. Vendor-set cookies (AdSense) are marked `vendorSet` and must be
// confirmed with the vendor before the Cookie Policy lists them by name.
//
// Category semantics:
//   - necessary:   site cannot function without it (auth, session, consent record
//                  itself, anti-spam frequency caps). Always on; informational only.
//   - preferences: user-chosen UI/behaviour state (theme, sounds, dismissed notices).
//   - analytics:   none currently implemented — category reserved, nothing loads.
//   - marketing:   AdSense only. Blocked until the user explicitly grants it.
//
// NDPC GAID 2025 Art. 7(l): the cookie/privacy notice must significantly obstruct
// the middle, left or right of the homepage — a bottom-only banner is insufficient.
// ConsentManager therefore renders an obstructing overlay that cannot be dismissed
// by Escape, backdrop click, or continued browsing. FCCPC Reg. 4 (exposure draft,
// guidance only): consent is a clear affirmative action; no pre-ticked boxes; no
// consent-by-inaction; no bundling unrelated consent as a condition of service.

export const CONSENT_KEY = 'apex_cookie_consent';

// Bump this whenever the policy or the set of tracked technologies changes
// materially. A version change re-prompts returning users for a fresh choice.
// A version change must never silently rewrite a historical consent record.
export const CONSENT_VERSION = '1';

export const CATEGORIES = Object.freeze([
  {
    id: 'necessary',
    label: 'Required',
    description:
      'Keeps you signed in and secure: Supabase auth session, device-session id, ' +
      'your consent record, and anti-spam prompt caps. Always on.',
    optional: false,
    defaultGranted: true,
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description:
      'Remembers your theme, quiz sounds, dismissed notifications, and ' +
      'onboarding state so you do not see the same prompts repeatedly.',
    optional: true,
    defaultGranted: false,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description:
      'Not currently used. No analytics script loads on PolyNurse. ' +
      'Reserved for future use; never activated without consent.',
    optional: true,
    defaultGranted: false,
  },
  {
    id: 'marketing',
    label: 'Advertising & marketing',
    description:
      'Google AdSense ads on the Dashboard, Community and Voting pages only. ' +
      'Never during a quiz. Set by Google; cookie names/durations confirmed with the vendor.',
    optional: true,
    defaultGranted: false,
  },
]);

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) || null;

// Storage keys PolyNurse itself writes (confirmed in code). Vendor cookies are
// not listed here — they are set by Google's script and flagged vendorSet.
export const STORAGE_KEYS = Object.freeze({
  necessary: [
    { key: 'apex_device_session_id', source: 'src/utils/apiHeaders.js', purpose: 'Session security / multi-device enforcement' },
    { key: /^sb-.*_auth_token$/, source: 'src/utils/supabase.js', purpose: 'Supabase auth session (keeps you signed in)' },
    { key: 'apex_cookie_consent', source: 'src/components/ConsentManager.jsx', purpose: 'Your consent choice + timestamp' },
    { key: 'apex:anon_visit_key', source: 'src/utils/anonVisit.js', purpose: 'Anonymous Room per-tab alias re-roll' },
    { key: /^freq:/, source: 'src/utils/safeStorage.js', purpose: 'Prompt frequency caps (anti-repeat)' },
  ],
  preferences: [
    { key: 'darkMode', source: 'src/components/Layout.jsx', purpose: 'Theme preference' },
    { key: 'soundEnabled', source: 'src/pages/Settings.jsx + AudioManager', purpose: 'Quiz sound on/off' },
    { key: 'apex:notifDismissed', source: 'src/components/NotificationBell', purpose: 'Dismissed notifications' },
    { key: 'apex:quizTapHintSeen', source: 'src/components/QuizPlayer', purpose: 'Quiz onboarding hint dismissed' },
    { key: 'apex_unlocked_tiers', source: 'src/components/AchievementToast', purpose: 'Celebration prompts already shown' },
    { key: /^apex_daily_challenge_done_.*$/, source: 'src/components/DailyChallengeWidget', purpose: 'Today\'s daily challenge completed' },
    { key: 'apex:pushOptInDismissed', source: 'src/components/PushOptInBanner.jsx', purpose: 'Push opt-in banner dismissed' },
  ],
});

// Third-party scripts PolyNurse may load (confirmed in code). `vendorSet` means
// cookies under that domain are set by the vendor, not by PolyNurse.
export const THIRD_PARTY_SCRIPTS = Object.freeze([
  {
    id: 'adsense',
    label: 'Google AdSense',
    publisherId: 'ca-pub-7731141426940208',
    category: 'marketing',
    vendorSet: true,
    loader: 'src/utils/adsense.js',
    gatedRoutes: ['/dashboard', '/community', '/voting'],
    note: 'Injected lazily only on authorised routes and never during an active quiz. Blocked until marketing consent is granted. The CDN loader URL lives in src/utils/adsense.js only.',
  },
]);

// Empty placeholder so downstream imports never fail if a category list is
// extended before the implementation catches up.
export const EMPTY_CONSENT = Object.freeze({
  version: CONSENT_VERSION,
  timestamp: null,
  categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.defaultGranted])),
  source: null,
});
