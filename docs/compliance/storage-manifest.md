# Browser storage & third-party script manifest — PolyNurse

**Status:** audited from source code. Every entry below was confirmed present in the codebase; nothing here is invented. Vendor-set cookies (AdSense) are marked as such and flagged for confirmation with the vendor.

## Finding format
Finding ID | Affected route or feature | Risk and impact | Relevant standard or legal concern | Remediation | Verification method | Status

---

## Strictly necessary (no consent required)

| Key / script | Source in code | Purpose | Category | Status |
|---|---|---|---|---|---|
| `apex_device_session_id` | `src/utils/apiHeaders.js` (`getDeviceSessionId`) | Stable device identifier for session security / multi-device enforcement | Strictly necessary | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `sb-*_auth_token` | `src/utils/supabase.js` (supabase-js) | Supabase authentication session; keeps the user signed in | Strictly necessary | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex_cookie_consent` | `src/components/CookieConsentBanner.jsx` | Records the user's cookie/local-storage consent choice + timestamp | Strictly necessary (consent record) | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex:anon_visit_key` | `src/utils/anonVisit.js` | Per-tab pseudonym for Anonymous Room alias re-roll | Strictly necessary (anon-room feature) | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `freq:<key>` | `src/utils/safeStorage.js` (`isPromptAllowed`/`notePromptShown`) | Frequency caps so prompts are not shown repeatedly | Strictly necessary (anti-spam / UX) | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `push_subscriptions` / `notification_preferences` | `api/_push.js`, `src/utils/push.js` | Web Push opt-in state (server-side, not browser storage) | Strictly necessary (user-requested) | Confirmed in code | DB schema + code | Fixed (no change needed) |
| `service worker (/sw.js)` | `public/sw.js`, registered in `src/utils/push.js` | Web Push delivery | Strictly necessary (user-requested) | Confirmed in code | grep + runtime | Fixed (no change needed) |

## Preferences (functional; user-set, no tracking)

| Key / script | Source in code | Purpose | Category | Status |
|---|---|---|---|---|
| `darkMode` | `src/components/Layout.jsx` (`toggleDarkMode`) | Remembers light/dark theme preference | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `soundEnabled` | `src/pages/Settings.jsx` + AudioManager | Remembers quiz sound preference | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex:notifDismissed` | `src/components/NotificationBell` | Tracks dismissed in-app notifications | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex:quizTapHintSeen` | `src/components/QuizPlayer` | Dismisses first-time quiz onboarding hint | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex_unlocked_tiers` | `src/components/AchievementToast` | Avoids repeated celebration prompts | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex_daily_challenge_done_*` | `src/components/DailyChallengeWidget` | Marks today's daily challenge as completed | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |
| `apex:pushOptInDismissed` | `src/components/PushOptInBanner.jsx` | Remembers the user dismissed the push opt-in banner | Preferences | Confirmed in code | grep + runtime | Fixed (no change needed) |

## Advertising / marketing (optional — consent required before activation)

| Key / script | Source in code | Purpose | Category | Status |
|---|---|---|---|---|
| `adsbygoogle.js` publisher script | `src/utils/adsense.js` → `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=<id>` | Google AdSense ad delivery (only on /dashboard, /community, /voting; never during an active quiz) | Advertising / marketing | Confirmed in code | Network tab: script must NOT load until `marketing` consent granted | **Partially Fixed** — script is currently NOT gated by consent (see C1); gate added in this phase |
| `ca-pub-7731141426940208` (publisher id) | `src/config/ads.js` (`ADSENSE_PUBLISHER_ID`) + `<meta name="google-adsense-account">` in `index.html` | Identifies the AdSense publisher | Advertising / marketing | Confirmed in code | grep | **Partially Fixed** — same as above |
| AdSense cookies (e.g. `__gads`, `__gpi`, `__uid`) | Set by Google's `adsbygoogle.js`, NOT by PolyNurse code | Ad targeting / measurement by the vendor | Advertising / marketing | **LEGAL REVIEW REQUIRED** — cookie names/durations/purposes are set by Google; confirm with Google's current documentation and NDPC guidance | Network tab + vendor docs | Blocked (vendor confirmation) |

## Notes
- No third-party analytics SDKs (no gtag/umami/plausible/hotjar/clarity) were found in the codebase.
- No `VITE_` environment variables hold secrets; `VITE_ADSENSE_CLIENT`/`VITE_ADSENSE_SLOT_*` only override publisher/slot ids (public).
- `localStorage`/`sessionStorage` only — no traditional HTTP cookies are set by PolyNurse itself.
