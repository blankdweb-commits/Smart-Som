import { IDENTITIES } from '../data/identities.js';

// The identity engine evaluates a user's learning stats and returns the
// highest tier whose thresholds are all satisfied. Thresholds that are not
// relevant for a metric (e.g. undefined) are ignored, so a fresh user with all
// zeros still lands on Tier 0 (Auxibaby).
export function computeCurrentIdentity(stats = {}) {
  const effective = {
    totalAttempts: stats.totalAttempts || 0,
    quizStreak: stats.quizStreak || 0,
    cardsStudied: stats.cardsStudied || 0,
    accuracy: stats.accuracy || 0,
    scEarned: stats.scEarned || 0,
    speedRuns: stats.speedRuns || 0
  };
  let identity = IDENTITIES[0];
  for (const tier of IDENTITIES) {
    if (meetsThreshold(effective, tier.required)) identity = tier;
  }
  return identity;
}

function meetsThreshold(effective, required) {
  return Object.entries(required).every(([key, val]) => {
    if (val == null) return true;
    return effective[key] >= val;
  });
}

// Distance (0..1) from the current identity to the next one, based on whichever
// threshold is furthest from being met. Returns null at the top tier.
export function computeProgressToNext(stats = {}, currentTier = null) {
  const current = currentTier || computeCurrentIdentity(stats);
  const next = IDENTITIES[current.tier + 1];
  if (!next) return null;

  const effective = {
    totalAttempts: stats.totalAttempts || 0,
    quizStreak: stats.quizStreak || 0,
    cardsStudied: stats.cardsStudied || 0,
    accuracy: stats.accuracy || 0,
    scEarned: stats.scEarned || 0,
    speedRuns: stats.speedRuns || 0
  };

  let maxFraction = 0;
  let furthestMetric = null;
  for (const [key, target] of Object.entries(next.required)) {
    if (target == null || target === 0) continue;
    const fraction = Math.min(1, (effective[key] || 0) / target);
    if (fraction >= maxFraction) {
      maxFraction = fraction;
      furthestMetric = { key, target, current: effective[key] || 0 };
    }
  }

  return {
    next,
    fraction: Math.round(maxFraction * 100),
    furthestMetric
  };
}

// Returns the list of tier milestones unlocked whenever `latestTier` crosses
// from a lower tier, so callers can trigger a celebratory toast/modal once per
// unlock. Persists a floor of "already toasted" tiers in localStorage.
export function checkUnlocks(stats = {}, previousTierTier = 0) {
  const current = computeCurrentIdentity(stats);
  return { current, isNewUnlock: current.tier > previousTierTier, newlyUnlocked: current };
}

const UNLOCK_KEY = 'apex:identityUnlocks';

export function loadAcknowledgedUnlocks() {
  try {
    return JSON.parse(localStorage.getItem(UNLOCK_KEY) || '[]');
  } catch {
    return [];
  }
}

// Should we show the unlock celebration for this tier (not yet seen)?
export function shouldCelebrate(tier) {
  if (tier <= 0) return false;
  return !loadAcknowledgedUnlocks().includes(tier);
}

// Mark a tier celebration as seen so it only fires once.
export function acknowledgeUnlock(tier) {
  try {
    const seen = new Set(loadAcknowledgedUnlocks());
    seen.add(tier);
    localStorage.setItem(UNLOCK_KEY, JSON.stringify([...seen]));
  } catch {
    /* ignore storage errors */
  }
}

export const TIER_NAMES = IDENTITIES.map((i) => i.name);
export { IDENTITIES };
