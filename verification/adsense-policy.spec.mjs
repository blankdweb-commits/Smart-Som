// ============================================================
// Controlled Google AdSense — policy verification.
//
// Verifies the strict application-level rule WITHOUT a browser or network:
//   R1  Publisher id configured (ca-pub-7731141426940208).
//   R2  Route matcher — ONLY Dashboard / Community / Voting (and their real
//       child routes) resolve to an allowed area; everything else is null.
//   R3  Unknown routes fail CLOSED (null → ads off).
//   R4  Prefix collisions never leak (`/community-events`, `/dashboards`).
//   R5  Central policy — exactly three `true` areas, all others `false`.
//   R6  Active-quiz override is enforced by the manager.
//   R7  No global loader in index.html / main.jsx; the CDN URL lives in one file.
//   R8  Singleton loader inserts AT MOST one <script> (repeat calls, existing tag).
//   R9  AdSenseSlot renders nothing when ads are disabled.
//   R10 Legacy AdBanner removed; forbidden pages mount no slot.
//
// Usage:  node verification/adsense-policy.spec.mjs
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const has = (p) => existsSync(resolve(ROOT, p));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${String(err.message).split('\n')[0]}`);
  }
};

console.log('adsense-policy.spec — controlled ads (Dashboard/Community/Voting only)');

// Import the real policy module (works in Node: import.meta.env is absent and
// the config guards for it).
const ads = await import('../src/config/ads.js');
const {
  ADSENSE_PUBLISHER_ID,
  ADS_POLICY,
  ADS_PREMIUM_POLICY,
  ADSENSE_ALLOWED_BASES,
  ADSENSE_PLACEMENTS,
  resolveAdArea,
  isAllowedAdRoute,
} = ads;

// ---- R1: publisher id -------------------------------------------------------
check('R1 publishes the configured AdSense client id', () => {
  assert.strictEqual(ADSENSE_PUBLISHER_ID, 'ca-pub-7731141426940208');
  assert.match(read('src/config/ads.js'), /ca-pub-7731141426940208/);
});

// ---- R2/R3/R4: route matrix -------------------------------------------------
const ALLOWED = {
  '/dashboard': 'dashboard',
  '/dashboard/': 'dashboard',
  '/dashboard/stats': 'dashboard',
  '/community': 'community',
  '/community/general': 'community',
  '/community/general/': 'community',
  '/voting': 'voting',
  '/voting/results': 'voting',
};

const BLOCKED = [
  '/quiz',
  '/quiz/setup',
  '/quiz/results',
  '/login',
  '/signup',
  '/profile',
  '/settings',
  '/marketplace',
  '/payment',
  '/payments',
  '/payments/verify',
  '/admin',
  '/admin/users',
  '/flashcards',
  '/study-groups',
  '/study-groups/12',
  '/xp-hall',
  '/weakness-drill',
  '/activate',
  '/reviews',
  '/achievements',
  '/pronunciation',
  '/legal/terms',
  '/unknown',
  '/community-events',
  '/dashboards',
  '/',
  '',
];

check('R2 allowed routes resolve to their explicit area', () => {
  for (const [path, area] of Object.entries(ALLOWED)) {
    assert.strictEqual(resolveAdArea(path), area, `${path} should allow ${area}`);
    assert.strictEqual(isAllowedAdRoute(path), true);
  }
});

check('R3 blocked routes fail closed (null → ads off)', () => {
  for (const path of BLOCKED) {
    assert.strictEqual(resolveAdArea(path), null, `${path} must be blocked`);
    assert.strictEqual(isAllowedAdRoute(path), false);
  }
});

check('R3 non-string pathnames (undefined/null/object) fail closed', () => {
  assert.strictEqual(resolveAdArea(undefined), null);
  assert.strictEqual(resolveAdArea(null), null);
  assert.strictEqual(resolveAdArea(42), null);
  assert.strictEqual(resolveAdArea({}), null);
});

check('R4 shared-prefix routes are NOT auto-allowed', () => {
  assert.strictEqual(resolveAdArea('/community-events'), null);
  assert.strictEqual(resolveAdArea('/communityx'), null);
  assert.strictEqual(resolveAdArea('/dashboards'), null);
  assert.strictEqual(resolveAdArea('/voting-booth'), null);
});

check('R2 only the three real bases are in the allowlist', () => {
  const areas = ADSENSE_ALLOWED_BASES.map((b) => b.area).sort();
  assert.deepStrictEqual(areas, ['community', 'dashboard', 'voting']);
});

// ---- R5: central policy -----------------------------------------------------
check('R5 ADS_POLICY enables exactly dashboard/community/voting', () => {
  const enabled = Object.entries(ADS_POLICY).filter(([, v]) => v === true).map(([k]) => k).sort();
  assert.deepStrictEqual(enabled, ['community', 'dashboard', 'voting']);
  for (const key of ['quiz', 'quizSetup', 'quizResults', 'activeQuiz', 'flashcards', 'login', 'signup', 'profile', 'settings', 'marketplace', 'checkout', 'payment', 'other']) {
    assert.strictEqual(ADS_POLICY[key], false, `${key} must be false`);
  }
});

check('R5 premium is not ad-free by default (config-driven, not invented)', () => {
  assert.strictEqual(ADS_PREMIUM_POLICY.hideForPremium, false);
});

check('R5 three placements are declared (dashboard/community/voting)', () => {
  assert.deepStrictEqual(
    Object.keys(ADSENSE_PLACEMENTS).sort(),
    ['community-feed', 'dashboard-content', 'voting-content'],
  );
});

// ---- R6/R9/R10: component contracts (static) --------------------------------
check('R6 manager disables ads whenever an active quiz is detected', () => {
  assert.match(read('src/components/ads/AdSenseManager.jsx'), /if \(quizActive\) return false;/);
});

check('R6 manager requires an authenticated session before enabling ads', () => {
  assert.match(read('src/components/ads/AdSenseManager.jsx'), /if \(!session\) return false;/);
});

check('R6 manager fails closed when the route is not allowed', () => {
  assert.match(read('src/components/ads/AdSenseManager.jsx'), /if \(!area\) return false;/);
});

check('R9 AdSenseSlot renders nothing when ads are disabled', () => {
  assert.match(read('src/components/ads/AdSenseSlot.jsx'), /if \(!adsEnabled \|\| !slotId\) return null;/);
});

check('R10 legacy AdBanner is gone and forbidden pages mount no slot', () => {
  assert.strictEqual(has('src/components/AdBanner.jsx'), false);
  assert.ok(!/AdBanner/.test(read('src/components/StudyGroups.jsx')));
  assert.ok(!/AdSenseSlot/.test(read('src/pages/Quiz.jsx')));
  assert.ok(!/AdSenseSlot/.test(read('src/pages/Flashcards.jsx')));
});

check('R10 placements wired only on the three allowed pages', () => {
  assert.match(read('src/pages/Dashboard.jsx'), /AdSenseSlot placement="dashboard-content"/);
  assert.match(read('src/pages/Community.jsx'), /AdSenseSlot placement="community-feed"/);
  assert.match(read('src/pages/Voting.jsx'), /AdSenseSlot placement="voting-content"/);
});

// ---- R7: no global injection ------------------------------------------------
check('R7 index.html and main.jsx never embed the loader', () => {
  assert.ok(!/googlesyndication|adsbygoogle/i.test(read('index.html')));
  assert.ok(!/googlesyndication|adsbygoogle/i.test(read('src/main.jsx')));
});

check('R7 the AdSense CDN URL exists in exactly one source file (the loader)', () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
  const owners = walk(resolve(ROOT, 'src'))
    .filter((f) => /\.(js|jsx)$/.test(f))
    .filter((f) => /pagead2\.googlesyndication\.com/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
  assert.deepStrictEqual(owners, ['src/utils/adsense.js']);
});

// ---- R8: singleton loader ---------------------------------------------------
const fakeDom = () => {
  const scripts = [];
  globalThis.window = {};
  globalThis.document = {
    head: { appendChild: (el) => { scripts.push(el); if (el.onload) el.onload(); } },
    createElement: () => ({ setAttribute() {} }),
    querySelector: () => scripts.find((s) => String(s.src || '').includes('adsbygoogle.js')) || null,
  };
  return scripts;
};

const loader = await import('../src/utils/adsense.js');

loader.resetAdSenseLoader();
const s1 = fakeDom();
await loader.loadAdSenseScript('ca-pub-test');
await loader.loadAdSenseScript('ca-pub-test');
await loader.loadAdSenseScript('ca-pub-test');
check('R8 repeated calls insert only ONE <script>', () => {
  assert.strictEqual(s1.length, 1);
  assert.match(String(s1[0].src), /adsbygoogle\.js\?client=ca-pub-test/);
  assert.strictEqual(s1[0].async, true);
  assert.strictEqual(s1[0].crossOrigin, 'anonymous');
});

loader.resetAdSenseLoader();
const s2 = fakeDom();
s2.push({ src: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=existing', onload: null });
await loader.loadAdSenseScript('ca-pub-test');
check('R8 an already-present script tag is reused, never duplicated', () => {
  assert.strictEqual(s2.length, 1);
});

// Restore the Node global environment.
delete globalThis.window;
delete globalThis.document;
loader.resetAdSenseLoader();

console.log('\n----');
console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);