// Deterministic achievement evaluation — no server calls, no AI.
//
// Mirrors the 10 achievements seeded in scripts/migration-v10-upgrade.sql
// (achievements catalog + user_achievements owner-RLS table). Given a snapshot
// of the learner's real data, returns the set of achievement KEYS that are
// currently earned. The AppContext layer persists newly-earned keys to
// user_achievements (joining by key -> id) and fires celebration toasts.
//
// NOTE (v35+): unlocking is SERVER-AUTHORITATIVE — only `evaluate_achievements()`
// may write user_achievements. The helpers below are the PRESENTATION layer for
// those server awards: a controlled rarity/tier palette, the celebration payload
// builder, and the "already presented" store. They never decide who earned what.

import { safeGet, safeSet } from './safeStorage.js';

export const ACHIEVEMENT_CATALOG = [
  { key: 'first-quiz', name: 'First Quiz', description: 'Complete your first quiz.', emoji: '🎯', tone: 'bg-apex-600' },
  { key: 'questions-50', name: '50 Questions', description: 'Answer 50 questions total.', emoji: '📚', tone: 'bg-emerald-500' },
  { key: 'questions-100', name: '100 Questions', description: 'Answer 100 questions total.', emoji: '⚡', tone: 'bg-amber-500' },
  { key: 'questions-500', name: '500 Questions', description: 'Answer 500 questions total.', emoji: '🔥', tone: 'bg-rose-500' },
  { key: 'streak-7', name: '7-Day Streak', description: 'Maintain a 7-day study streak.', emoji: '🔥', tone: 'bg-orange-500' },
  { key: 'streak-30', name: '30-Day Streak', description: 'Maintain a 30-day study streak.', emoji: '🌟', tone: 'bg-purple-500' },
  { key: 'medication-master', name: 'Medication Master', description: 'Reach the Medication Master identity (Tier 3).', emoji: '💊', tone: 'bg-rose-400' },
  { key: 'clinical-strategist', name: 'Clinical Strategist', description: 'Reach the Clinical Strategist identity (Tier 5).', emoji: '🧠', tone: 'bg-indigo-500' },
  { key: 'daily-goal', name: 'Daily Goal', description: 'Complete today\'s daily goal.', emoji: '✅', tone: 'bg-slate-600' }
];

// Total questions answered across all recorded quizzes.
const totalQuestions = (quizHistory = []) =>
  quizHistory.reduce((sum, r) => sum + (r.total || 0), 0);

// Evaluate every catalog achievement against a live data snapshot. Returns an
// array of earned keys (empty set for a brand-new learner).
export const evaluateAchievements = (snapshot = {}) => {
  const { quizHistory = [], studyStats = {}, identity = null, dailyGoalDone = false } = snapshot;
  const earned = new Set();

  const qCount = quizHistory.length;
  const totalQ = totalQuestions(quizHistory);
  const dayStreak = studyStats.streak || 0;
  const identityTier = identity?.tier ?? 0;

  if (qCount >= 1) earned.add('first-quiz');
  if (totalQ >= 50) earned.add('questions-50');
  if (totalQ >= 100) earned.add('questions-100');
  if (totalQ >= 500) earned.add('questions-500');
  if (dayStreak >= 7) earned.add('streak-7');
  if (dayStreak >= 30) earned.add('streak-30');
  if (identityTier >= 3) earned.add('medication-master');
  if (identityTier >= 5) earned.add('clinical-strategist');
  if (dailyGoalDone) earned.add('daily-goal');

  return [...earned];
};

// ---------------------------------------------------------------------------
// RARITY / TIER SYSTEM — controlled, server/definition-driven, NEVER user input.
//
// Four tiers with a fixed palette. Every colour is a literal here (never built
// from user data), and every Tailwind class below is a complete literal string
// so the scanner always picks it up. Accents are chosen to stay readable on
// the app's dark UI (`accent`, used for glow/ring/title on dark surfaces) and
// on light cards (`accentLight`). No neon: the glow alpha is kept low so text
// contrast is never sacrificed.
// ---------------------------------------------------------------------------
export const ACHIEVEMENT_TIERS = Object.freeze({
  COMMON: Object.freeze({
    key: 'COMMON',
    label: 'Common',
    rank: 1,
    accent: '#94a3b8',        // slate-400 — subtle on dark
    accentLight: '#475569',   // slate-600 — readable on light
    glow: 'rgba(148, 163, 184, 0.30)',
    modal: Object.freeze({ text: 'text-slate-300', border: 'border-slate-400/40', bg: 'bg-slate-400/10' }),
    card: Object.freeze({ text: 'text-slate-600 dark:text-slate-300', border: 'border-slate-300 dark:border-slate-600', bg: 'bg-slate-100 dark:bg-slate-700/40' }),
  }),
  RARE: Object.freeze({
    key: 'RARE',
    label: 'Rare',
    rank: 2,
    accent: '#38bdf8',        // sky-400
    accentLight: '#0369a1',   // sky-700
    glow: 'rgba(56, 189, 248, 0.32)',
    modal: Object.freeze({ text: 'text-sky-300', border: 'border-sky-400/40', bg: 'bg-sky-400/10' }),
    card: Object.freeze({ text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-300 dark:border-sky-500/50', bg: 'bg-sky-50 dark:bg-sky-500/15' }),
  }),
  EPIC: Object.freeze({
    key: 'EPIC',
    label: 'Epic',
    rank: 3,
    accent: '#c084fc',        // purple-400
    accentLight: '#7c3aed',   // violet-600
    glow: 'rgba(192, 132, 252, 0.34)',
    modal: Object.freeze({ text: 'text-purple-300', border: 'border-purple-400/40', bg: 'bg-purple-400/10' }),
    card: Object.freeze({ text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-300 dark:border-purple-500/50', bg: 'bg-purple-50 dark:bg-purple-500/15' }),
  }),
  LEGENDARY: Object.freeze({
    key: 'LEGENDARY',
    label: 'Legendary',
    rank: 4,
    accent: '#fbbf24',        // amber-400
    accentLight: '#b45309',   // amber-700
    glow: 'rgba(251, 191, 36, 0.38)',
    modal: Object.freeze({ text: 'text-amber-300', border: 'border-amber-400/50', bg: 'bg-amber-400/10' }),
    card: Object.freeze({ text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-500/50', bg: 'bg-amber-50 dark:bg-amber-500/15' }),
  }),
});

// Explicit overrides keyed by the SERVER achievement key (definitions live in
// migrations v10/v14/v32 — nothing here is derived from user input).
const LEGENDARY_KEYS = new Set([
  'streak-30',        // 30-day study streak
  'scholar',          // 1,000 questions answered
  'untouchable',      // flawless competitive win
  'clinical-strategist', // identity tier 5
  'pharmacology-menace', // 100-question subject streak
]);
const EPIC_KEYS = new Set([
  'questions-500',
  'streak-7',
  'medication-master',
  'first-blood',      // first verified duel win
  'double-digits',
  'comeback',
]);
const RARE_KEYS = new Set(['questions-50', 'questions-100']);

// Resolve the tier for a server-issued achievement. Deterministic: explicit
// key overrides first, then the definition's category, then COMMON.
export const tierForAchievement = (achievement = {}) => {
  const key = String(achievement?.key ?? achievement?.achievement_id ?? '');
  const category = String(achievement?.category ?? '').toLowerCase();
  if (LEGENDARY_KEYS.has(key)) return 'LEGENDARY';
  if (EPIC_KEYS.has(key)) return 'EPIC';
  if (RARE_KEYS.has(key)) return 'RARE';
  // Competitive awards (v32 moved duel achievements here) are premium by nature.
  if (category === 'competitive') return 'EPIC';
  return 'COMMON';
};

// Palette lookup with a safe COMMON fallback.
export const tierStyle = (tierKey) => ACHIEVEMENT_TIERS[tierKey] || ACHIEVEMENT_TIERS.COMMON;

// ---------------------------------------------------------------------------
// CELEBRATION PAYLOAD BUILDER (pure).
//
// Turns the server's `evaluate_achievements()` fresh-unlock list into the full
// payload the celebration UI needs: id, name, description, icon, tier/rarity,
// earned timestamp and display accent. The server decides WHAT was earned;
// this only decorates it. Falls back gracefully when the public definition
// catalog can't be fetched (offline): server name/emoji are still used and the
// tier resolves from the key/category.
// ---------------------------------------------------------------------------
export const buildCelebrations = ({
  unlocks = [],
  catalog = [],
  earnedAtByKey = {},
  now = Date.now(),
} = {}) => {
  const byKey = new Map();
  for (const entry of catalog || []) {
    if (entry && entry.key) byKey.set(String(entry.key), entry);
  }
  return (unlocks || []).map((unlock, index) => {
    const definition = byKey.get(String(unlock?.key)) || {};
    const tierKey = tierForAchievement({
      key: unlock?.key,
      category: unlock?.category ?? definition.category,
    });
    const tier = ACHIEVEMENT_TIERS[tierKey];
    return {
      // Server/definition identity — never client-invented.
      id: definition.id ?? null,
      key: unlock?.key ?? definition.key ?? null,
      name: unlock?.name || definition.name || 'Achievement Unlocked',
      description: definition.description || unlock?.description || '',
      icon: unlock?.emoji || definition.emoji || '🏆',
      narrator: unlock?.narrator || definition.narrator || null,
      category: unlock?.category || definition.category || 'normal',
      // Presentation metadata (controlled palette).
      tier: tierKey,
      tierLabel: tier.label,
      tierRank: tier.rank,
      accent: tier.accent,
      accentLight: tier.accentLight,
      glow: tier.glow,
      // Earned timestamp comes from user_achievements.unlocked_at when the
      // caller could read it; otherwise "now" (the moment it surfaced).
      earnedAt: earnedAtByKey[String(unlock?.key)] || new Date(now).toISOString(),
      // Queue bookkeeping: server order (achievements.id) = chronological.
      queueIndex: index,
    };
  });
};

// ---------------------------------------------------------------------------
// "ALREADY PRESENTED" STORE — client-side dedup for the celebration itself.
//
// The SERVER already guarantees an achievement is only ever inserted (and
// therefore only ever returned as "fresh") once per user, and concurrent tabs
// are serialised by the unique constraint. This store is the second layer: it
// makes sure a repeated fresh payload (double sync, re-render, a second tab
// that raced the response) is never celebrated twice. Presentation state only —
// it never influences what the server awards.
// ---------------------------------------------------------------------------
export const PRESENTED_KEY_PREFIX = 'apex_ach_presented_v1:';

const defaultStorage = {
  get: (key) => safeGet(key, { parsed: true }),
  set: (key, value) => safeSet(key, JSON.stringify(value)),
};

const storageFor = (storage) => storage || defaultStorage;

// Read the presented set for a user (never throws; missing/bad data → empty).
export const readPresentedKeys = (userId, storage = null) => {
  const store = storageFor(storage);
  if (!userId || !store?.get) return new Set();
  try {
    const raw = store.get(`${PRESENTED_KEY_PREFIX}${userId}`);
    const list = Array.isArray(raw) ? raw : [];
    return new Set(list.map(String));
  } catch {
    return new Set();
  }
};

// Persist keys as presented. Merges with what is already stored so two
// batches in the same session can't erase each other. Never throws.
export const markPresentedKeys = (userId, keys = [], storage = null) => {
  const store = storageFor(storage);
  if (!userId || !store?.set || !keys.length) return;
  try {
    const existing = readPresentedKeys(userId, store);
    for (const key of keys) existing.add(String(key));
    store.set(`${PRESENTED_KEY_PREFIX}${userId}`, [...existing]);
  } catch {
    /* storage unavailable — the in-memory ref still dedups this session */
  }
};

// Filter a fresh-unlock payload list down to the ones not yet presented.
export const pendingCelebrations = (payloads = [], presentedKeys = null) => {
  const presented = presentedKeys instanceof Set ? presentedKeys : new Set();
  return (payloads || []).filter((p) => p?.key && !presented.has(String(p.key)));
};