// ============================================================
// Question Selection Engine
//
// Replaces the ad-hoc unseen-first prioritization in Quiz.jsx with a scored
// model that balances: (1) never repeating while unseen exists, (2) spacing
// out re-asked questions over time, (3) mixing different angles of a niche,
// (4) pushing the learner toward their target difficulty, and (5) surfacing
// weak-concept questions more often.
//
// Pure functions only — no network, no state. All tunables live in
// ./selectionConfig.js.
// ============================================================
import { questionId, niche } from './questionMetadata';
import { SELECTION_CONFIG as C } from './selectionConfig';

// Maps a card's difficulty string onto the app's tier scale (same logic that
// used to live inside Quiz.jsx so the engine stays strict/repeatable).
export const matchesTier = (cardDifficulty, tierId) => {
  const d = String(cardDifficulty || '').toLowerCase().trim();
  switch (tierId) {
    case 'Easy': return d === 'easy';
    case 'Medium': return d === 'medium' || d === 'moderate';
    case 'Hard': return d === 'hard';
    // Authored Expert/Master/Extreme banks don't exist yet; those tiers draw
    // from the Hard pool with stricter pass marks until curated content lands.
    case 'Expert':
    case 'Master':
    case 'Extreme': return d === 'hard' || d === 'expert' || d === 'master' || d === 'extreme';
    default: return true;
  }
};

const hoursSince = (iso) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / 36e5; // ms → hours
};

// True when the card's topic / category / subject / niche matches one of the
// learner's weak-concept seeds. Weak seeds are lowercase name strings (e.g.
// "medical-surgical nursing"); we lower-case every probe field so subject-only
// seeds still match cards whose niche is `subject::source`.
const isWeakCard = (card, weakNiches) => {
  if (!weakNiches || weakNiches.size === 0) return false;
  const probes = [
    card.topic,
    card.category,
    card.subject,
    niche(card)
  ].map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
  return probes.some(p => weakNiches.has(p));
};

// Score one question in the context of the learner's full state.
export const computeQuestionScore = (card, userState) => {
  const qid = questionId(card);
  const history = userState?.questionHistory?.get?.(qid);
  const nicheKey = niche(card);
  const nicheCount = userState?.nicheCounts?.get?.(nicheKey) || 0;
  const isWeak = isWeakCard(card, userState?.weakNiches);

  // 1. Base: unseen dominates.
  let score = history ? C.BASE_SEEN : C.BASE_UNSEEN;

  // 2. Recency penalty (only for previously-seen questions).
  if (history) {
    const hrs = hoursSince(history.last_seen);
    const decay = Math.exp(-hrs / C.RECENCY_HALF_LIFE_HOURS);
    score -= decay * C.RECENCY_MAX_PENALTY;
  }

  // 3. Niche penalty — same-niche-different-angle keeps variety high.
  score -= nicheCount * C.NICHE_PENALTY_PER_QUESTION;

  // 4. Difficulty alignment.
  if (userState?.targetDifficulty && matchesTier(card.difficulty, userState.targetDifficulty)) {
    score += C.DIFFICULTY_MATCH_BONUS;
  }

  // 5. Weak-concept boost.
  if (isWeak) score += C.WEAKNESS_BOOST;

  return score;
};

// Dedupe a pool by question text (keeps the first occurrence).
const dedupePool = (pool) => {
  const seen = new Set();
  return pool.filter(c => {
    const key = String(c.question || '').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Filter a pool to the mode's bank first, then subject/difficulty/source.
export const filterPool = (pool, config) => {
  let list = Array.isArray(pool) ? pool : [];
  const { subject, difficulty, source } = config || {};

  if (subject) {
    list = list.filter(c => String(c.subject || '') === String(subject));
  }
  if (difficulty) {
    const tierMatches = list.filter(c => matchesTier(c.difficulty, difficulty));
    if (tierMatches.length >= C.MIN_UNSEEN_FOR_PURE_UNSEEN) {
      list = tierMatches;
    }
  }
  if (source) {
    list = list.filter(c => String(c.source || '') === String(source));
  }

  return dedupePool(list);
};

// Durstenfeld (in-place) Fisher–Yates — unbiased, unlike sort-by-random.
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Selection entry point.
//   pool       — the raw questions for this mode/bank
//   config     — { questionCount, order, subject, difficulty, source,
//                 prioritizeWeakness? }
//   userState  — {
//                 attemptedIds: Set<questionId>,
//                 questionHistory: Map<questionId, { last_seen }>,
//                 nicheCounts: Map<nicheKey, count>,
//                 weakNiches: Set<nicheKey>,
//                 targetDifficulty: string (optional)
//               }
// Returns the selected questions (already normalized for the player).
export const selectQuestions = (pool, config, userState) => {
  const targetCount = Math.max(1, Math.min(50, Number(config?.questionCount) || 10));
  const candidates = filterPool(pool, config || {});
  const state = userState || {};
  const attempted = state.attemptedIds || new Set();

  // Score every candidate.
  const scored = candidates.map(card => ({
    card,
    score: computeQuestionScore(card, state)
  }));

  // Weakness mode: keep only weak-niche matches first, then fill from the rest.
  if (config?.prioritizeWeakness && (state.weakNiches?.size || 0)) {
    const weak = scored.filter(s => isWeakCard(s.card, state.weakNiches));
    if (weak.length >= C.MIN_WEAK_MATCHES) {
      // Unseen weak first, then seen weak, then the remaining pool.
      const weakSeen = weak.filter(s => !attempted.has(questionId(s.card)));
      const weakDone = weak.filter(s => attempted.has(questionId(s.card)));
      const rest = scored.filter(s => !isWeakCard(s.card, state.weakNiches));
      const ranked = [...weakSeen, ...weakDone, ...rest]
        .sort((a, b) => b.score - a.score);
      const pickedCards = ranked.slice(0, Math.min(targetCount, ranked.length)).map(s => s.card);
      return config?.order === 'sequential' ? pickedCards : shuffle(pickedCards);
    }
  }

  // General path: score-sort, then split unseen (always prioritized) from seen.
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const unseen = sorted.filter(s => !attempted.has(questionId(s.card)));
  const seen = sorted.filter(s => attempted.has(questionId(s.card)));

  const picked = [];
  picked.push(...unseen.slice(0, targetCount).map(s => s.card));

  // Top up from seen only when needed, capped by MAX_SEEN_RATIO.
  if (picked.length < targetCount && C.ALLOW_SEEN_FALLBACK && seen.length > 0) {
    const maxSeen = Math.floor(targetCount * C.MAX_SEEN_RATIO);
    const room = targetCount - picked.length;
    const seenTake = Math.min(maxSeen, room, seen.length);
    picked.push(...seen.slice(0, seenTake).map(s => s.card));
  }

  // If still empty (tiny pool, everything attempted and fallback disabled),
  // take the highest-scored candidates regardless — never return an empty set.
  if (picked.length === 0 && sorted.length > 0) {
    picked.push(...sorted.slice(0, Math.min(targetCount, sorted.length)).map(s => s.card));
  }

  return config?.order === 'sequential' ? picked : shuffle(picked);
};