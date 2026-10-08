// ============================================================
// Premium achievement celebration — verification.
//
// Verifies the celebration system WITHOUT a browser or network:
//   C1  Controlled rarity/tier palette (4 tiers, hex accents, literal classes).
//   C2  Deterministic tier resolution from SERVER keys/categories only.
//   C3  Celebration payload builder enriches server unlocks (description,
//       narrator, earned date, accent) and never invents/drops achievements.
//   C4  "Already presented" store dedups repeated payloads and never throws
//       (even with broken storage).
//   C5  Queue logic in AppContext: ONE celebration active at a time, FIFO,
//       cleared on sign-out / user switch.
//   C6  Celebration host: lazy + keyed per celebration in App.jsx.
//   C7  Modal a11y/robustness: dialog role, Escape, scroll lock, reduced
//       motion, confetti auto-removed, no infinite animation.
//   C8  SERVER AUTHORITY: no client write to user_achievements anywhere in src.
//   C9  Dashboard featured latest achievement (ordered by unlocked_at).
//   C10 XpHall: win triggers syncAchievements; result shows fresh unlocks +
//       winner treatment (no client-invented outcome).
//
// Usage:  node verification/achievement-celebration.spec.mjs
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const has = (p) => existsSync(resolve(ROOT, p));

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${String(err.message).split('\n')[0]}`);
  }
};

console.log('achievement-celebration.spec — premium celebration (server-authoritative)');

const engine = await import('../src/utils/achievementEngine.js');
const {
  ACHIEVEMENT_TIERS,
  tierForAchievement,
  tierStyle,
  buildCelebrations,
  readPresentedKeys,
  markPresentedKeys,
  pendingCelebrations,
  PRESENTED_KEY_PREFIX,
} = engine;

const CATALOG = [
  { id: 1, key: 'first-quiz', name: 'First Quiz', description: 'Complete your first quiz.', emoji: '🎯', category: 'normal', narrator: 'It begins.' },
  { id: 7, key: 'streak-30', name: '30-Day Streak', description: 'Maintain a 7-day study streak.', emoji: '🌟', category: 'normal', narrator: null },
  { id: 12, key: 'questions-100', name: '100 Questions', description: 'Answer 100 questions total.', emoji: '⚡', category: 'normal' },
  { id: 20, key: 'untouchable', name: 'Untouchable', description: 'Win a 1v1 without getting a question wrong.', emoji: '💀', category: 'competitive' },
];

// ---- C1: palette ------------------------------------------------------------
await check('C1 controlled tier palette — 4 tiers, hex accents, literal classes', () => {
  assert.deepStrictEqual(Object.keys(ACHIEVEMENT_TIERS), ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']);
  for (const [key, tier] of Object.entries(ACHIEVEMENT_TIERS)) {
    assert.strictEqual(tier.key, key);
    assert.match(tier.accent, /^#[0-9a-f]{6}$/i, `${key} accent must be a hex literal`);
    assert.match(tier.accentLight, /^#[0-9a-f]{6}$/i, `${key} accentLight must be a hex literal`);
    assert.match(tier.glow, /^rgba\(/, `${key} glow must be rgba`);
    assert.ok(['Common', 'Rare', 'Epic', 'Legendary'].includes(tier.label));
    assert.ok(tier.rank >= 1 && tier.rank <= 4);
    // Tailwind classes must be complete literals (Tailwind v4 cannot see
    // dynamically concatenated class fragments).
    for (const group of ['modal', 'card']) {
      for (const [k, v] of Object.entries(tier[group])) {
        assert.strictEqual(typeof v, 'string');
        assert.ok(!v.includes('${'), `${key}.${group}.${k} must not be interpolated`);
        assert.ok(v.includes('-'), `${key}.${group}.${k} must be a real class`);
      }
    }
  }
});

// ---- C2: tier resolution ----------------------------------------------------
await check('C2 tier resolution is deterministic and server-driven', () => {
  assert.strictEqual(tierForAchievement({ key: 'streak-30' }), 'LEGENDARY');
  assert.strictEqual(tierForAchievement({ key: 'scholar' }), 'LEGENDARY');
  assert.strictEqual(tierForAchievement({ key: 'untouchable' }), 'LEGENDARY');
  assert.strictEqual(tierForAchievement({ key: 'questions-100' }), 'RARE');
  assert.strictEqual(tierForAchievement({ key: 'questions-50' }), 'RARE');
  assert.strictEqual(tierForAchievement({ key: 'first-quiz' }), 'COMMON');
  assert.strictEqual(tierForAchievement({ key: 'daily-goal' }), 'COMMON');
  assert.strictEqual(tierForAchievement({ key: 'anything-new', category: 'competitive' }), 'EPIC');
  assert.strictEqual(tierForAchievement({ key: 'roast-fun', category: 'roast' }), 'COMMON');
  assert.strictEqual(tierForAchievement({}), 'COMMON');
  assert.strictEqual(tierForAchievement(null), 'COMMON');
  // Rank ordering for the UI (Common < Rare < Epic < Legendary).
  assert.ok(ACHIEVEMENT_TIERS.LEGENDARY.rank > ACHIEVEMENT_TIERS.EPIC.rank);
  assert.ok(ACHIEVEMENT_TIERS.EPIC.rank > ACHIEVEMENT_TIERS.RARE.rank);
  assert.ok(ACHIEVEMENT_TIERS.RARE.rank > ACHIEVEMENT_TIERS.COMMON.rank);
  assert.strictEqual(tierStyle('NOPE').key, 'COMMON'); // safe fallback
});

// ---- C3: payload builder ----------------------------------------------------
await check('C3 builder enriches server unlocks without inventing any', () => {
  const unlocks = [
    { key: 'streak-30', name: '30-Day Streak', emoji: '🌟', narrator: null },
    { key: 'untouchable', name: 'Untouchable', emoji: '💀', narrator: 'Flawless.' },
  ];
  const earnedAtByKey = { 'streak-30': '2026-10-01T10:00:00.000Z' };
  const payloads = buildCelebrations({ unlocks, catalog: CATALOG, earnedAtByKey, now: 1770000000000 });

  assert.strictEqual(payloads.length, unlocks.length);
  assert.deepStrictEqual(payloads.map(p => p.key), unlocks.map(u => u.key)); // server order kept
  const first = payloads[0];
  assert.strictEqual(first.id, 7); // definition id (numeric), not the key
  assert.strictEqual(first.description, 'Maintain a 7-day study streak.');
  assert.strictEqual(first.earnedAt, '2026-10-01T10:00:00.000Z');
  assert.strictEqual(first.tier, 'LEGENDARY');
  assert.strictEqual(first.tierLabel, 'Legendary');
  assert.strictEqual(first.accent, ACHIEVEMENT_TIERS.LEGENDARY.accent);
  const second = payloads[1];
  assert.strictEqual(second.tier, 'LEGENDARY'); // explicit key override > competitive category
  assert.strictEqual(second.narrator, 'Flawless.');
  assert.ok(second.earnedAt); // falls back to "now" when no timestamp
});

await check('C3b builder is fail-soft when the definitions catalogue is empty', () => {
  const payloads = buildCelebrations({
    unlocks: [{ key: 'questions-100', name: '100 Questions', emoji: '⚡' }],
    catalog: [],
    earnedAtByKey: {},
  });
  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(payloads[0].name, '100 Questions'); // server name kept
  assert.strictEqual(payloads[0].tier, 'RARE'); // tier still resolves from key
  assert.strictEqual(payloads[0].description, ''); // graceful, not invented
  assert.ok(payloads[0].earnedAt);
});

// ---- C4: presented store ----------------------------------------------------
await check('C4 presented store dedups and never throws', () => {
  const backing = new Map();
  const storage = {
    get: (k) => (backing.has(k) ? JSON.parse(backing.get(k)) : null),
    set: (k, v) => backing.set(k, typeof v === 'string' ? v : JSON.stringify(v)),
  };

  const userId = 'user-1';
  assert.deepStrictEqual([...readPresentedKeys(userId, storage)], []);
  markPresentedKeys(userId, ['streak-30'], storage);
  markPresentedKeys(userId, ['first-quiz', 'streak-30'], storage); // merge, no dupes
  const seen = readPresentedKeys(userId, storage);
  assert.deepStrictEqual([...seen].sort(), ['first-quiz', 'streak-30']);
  assert.ok(backing.has(`${PRESENTED_KEY_PREFIX}${userId}`));

  const payloads = buildCelebrations({
    unlocks: [
      { key: 'streak-30', name: '30-Day Streak' },
      { key: 'first-quiz', name: 'First Quiz' },
      { key: 'questions-100', name: '100 Questions' },
    ],
    catalog: CATALOG,
  });
  const pending = pendingCelebrations(payloads, seen);
  assert.deepStrictEqual(pending.map(p => p.key), ['questions-100']); // only new ones

  // Broken storage (throws) must be a no-op, never a crash.
  const angry = { get: () => { throw new Error('quota'); }, set: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => markPresentedKeys('user-2', ['x'], angry));
  assert.deepStrictEqual([...readPresentedKeys('user-2', angry)], []);
  // Missing user / missing storage → empty set, no throw.
  assert.strictEqual(readPresentedKeys(null, storage).size, 0);
  assert.strictEqual(readPresentedKeys('user-1').size, 0); // no window in Node
});

// ---- C5: queue semantics (AppContext source) --------------------------------
await check('C5 queue presents ONE celebration at a time (FIFO) in AppContext', () => {
  const ctx = read('src/context/AppContext.jsx');
  assert.match(ctx, /celebrationQueueRef/);
  assert.match(ctx, /celebrationActiveRef/);
  assert.match(ctx, /const enqueueCelebrations = useCallback/);
  assert.match(ctx, /const dismissCelebration = useCallback/);
  assert.match(ctx, /const resetCelebrations = useCallback/);
  // Only ONE item is ever active: enqueue activates solely when idle.
  assert.match(ctx, /if \(!celebrationActiveRef\.current\) \{[\s\S]{0,200}setActiveCelebration\(next\)/);
  // Dismiss advances the queue (next) or clears it (null).
  assert.match(ctx, /dismissCelebration[\s\S]{0,400}setActiveCelebration\(null\)/);
  // Reset on identity change / sign-out (never inherited across accounts).
  assert.match(ctx, /if \(!activeUserId\) resetCelebrations\(\)/);
  assert.match(ctx, /resetCelebrations\(\);[\s\S]{0,80}const amountPaid|setAchievementCatalog\(\[\]\);\s*\n\s*resetCelebrations\(\);/);
});

await check('C5b syncAchievements only presents server-fresh, not-yet-presented unlocks', () => {
  const ctx = read('src/context/AppContext.jsx');
  assert.match(ctx, /supabase\.rpc\('evaluate_achievements'\)/);
  assert.match(ctx, /buildCelebrations\(\{/);
  assert.match(ctx, /pendingCelebrations\(payloads, presented\)/);
  assert.match(ctx, /markPresentedKeys\(userId, pending\.map\(p => p\.key\)\)/);
  assert.match(ctx, /enqueueCelebrations\(pending\)/);
  // Fresh rows are merged with REAL numeric achievement ids + unlocked_at.
  assert.match(ctx, /achievement_id: row\.achievement_id/);
  assert.match(ctx, /unlocked_at: row\.unlocked_at/);
  // The old passive toast path must not double-present alongside the modal.
  assert.ok(!/setAchievementToast\(\{\s*\n\s*id: Date\.now\(\)/.test(ctx), 'toast no longer emitted for fresh unlocks');
});

// ---- C6: host ---------------------------------------------------------------
await check('C6 celebration host is lazy AND keyed per celebration', () => {
  const app = read('src/App.jsx');
  assert.match(app, /lazy\(\(\) => import\('\.\/components\/AchievementCelebration'\)\)/);
  assert.match(app, /const CelebrationHost = \(\) => \{/);
  assert.match(app, /if \(!activeCelebration\) return null/);
  assert.match(app, /<AchievementCelebration key=\{\`\$\{activeCelebration\.key/);
  assert.ok(has('src/components/AchievementCelebration.jsx'), 'component must exist (build blocker)');
});

// ---- C7: modal a11y / robustness -------------------------------------------
await check('C7 modal is accessible, dismissible and motion-safe', () => {
  const modal = read('src/components/AchievementCelebration.jsx');
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="apex-achievement-title"/);
  assert.match(modal, /key === 'Escape'/); // Escape dismisses
  assert.match(modal, /document\.body\.style\.overflow = 'hidden'/); // scroll lock
  assert.match(modal, /document\.body\.style\.overflow = previous/); // ...always restored
  assert.match(modal, /useReducedMotion\(\)/); // reduced-motion aware
  assert.match(modal, /min-h-\[48px\]/); // touch targets
  assert.match(modal, /safe-area-inset/); // mobile safe area
  assert.ok(!/repeat:\s*(Infinity|'infinite')/.test(modal), 'no infinite animations');
  // Confetti is removed from the DOM after the burst.
  assert.match(modal, /setBurstVisible\(false\), 1900\)/);
  // Tier colours come from the controlled palette (no user-supplied colour).
  assert.match(modal, /tierStyle\(achievement\?\.tier\)/);
});

// ---- C8: server authority ---------------------------------------------------
await check('C8 client NEVER writes user_achievements (server stays authoritative)', () => {
  const srcFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs)$/.test(entry.name)) srcFiles.push(full);
    }
  };
  walk(resolve(ROOT, 'src'));

  const writers = [];
  for (const file of srcFiles) {
    const text = readFileSync(file, 'utf8');
    if (/from\(['"]user_achievements['"]\)[\s\S]{0,40}\.insert\(/.test(text)
      || /\.upsert\([\s\S]{0,80}user_achievements/.test(text)) {
      writers.push(file.replace(ROOT, ''));
    }
  }
  assert.deepStrictEqual(writers, [], 'client attempted to write user_achievements');

  const ctx = read('src/context/AppContext.jsx');
  assert.match(ctx, /\.from\('user_achievements'\)\s*\n\s*\.select\('achievement_id, unlocked_at'\)/, 'reads own rows only');
  assert.match(ctx, /rpc\('evaluate_achievements'\)/, 'unlocks only via the server RPC');
});

// ---- C9: Dashboard ----------------------------------------------------------
await check('C9 Dashboard features the LATEST achievement (ordered by unlocked_at)', () => {
  const dash = read('src/pages/Dashboard.jsx');
  assert.match(dash, /latestAchievement/);
  assert.match(dash, /sort\(\s*\(a, b\) => new Date\(b\.unlocked_at \|\| 0\)\.getTime\(\) - new Date\(a\.unlocked_at \|\| 0\)\.getTime\(\)/);
  assert.match(dash, /Achievement Unlocked/);
  assert.match(dash, /tierForAchievement\(latestAchievement\)/);
  assert.match(dash, /tierStyle\(/);
  assert.match(dash, /totalAchievements/);
  assert.match(dash, /navigate\('\/achievements'\)/); // history stays reachable
});

// ---- C10: XpHall ------------------------------------------------------------
await check('C10 win path re-evaluates achievements server-side and shows them', () => {
  const xp = read('src/pages/XpHall.jsx');
  assert.match(xp, /syncAchievements/);
  assert.match(xp, /if \(outcome === 'win'\)/);
  assert.match(xp, /await syncAchievements\(\)/);
  assert.match(xp, /achievements,/); // carried into the result payload
  assert.match(xp, /Win \+ Achievement Unlocked/);
  // Winner treatment comes from the SERVER's settled result, never a guess.
  assert.match(xp, /Winner/);
  assert.match(xp, /p\.result === "win" \? "Won"/);
  assert.ok(!/youWon\s*=\s*true/.test(xp), 'outcome never invented client-side');
});

// ---- component integrity ----------------------------------------------------
await check('C11 component imports resolve (no dead imports)', () => {
  const modal = read('src/components/AchievementCelebration.jsx');
  assert.ok(!modal.includes('AnimatePresence'), 'unused import removed');
  assert.match(modal, /import \{ X, Award, Sparkles \} from '\.\/Icons'/);
  const icons = read('src/components/Icons.jsx');
  for (const icon of ['Award', 'Sparkles', 'X']) {
    assert.ok(new RegExp(`\\b${icon}\\b`).test(icons), `${icon} exported from Icons`);
  }
});

console.log('----');
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
