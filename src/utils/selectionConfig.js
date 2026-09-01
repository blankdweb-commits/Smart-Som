// ============================================================
// Question Selection Tuning Config
//
// Single source of truth for the no-repetition selection engine weights.
// All values here are exposed for tuning — edit freely without touching the
// engine logic.
//
// Scoring model: an unseen question starts high (BASE_UNSEEN), a previously
// seen one starts at BASE_SEEN and is penalized the more recently it was
// answered (exponential decay from RECENCY_HALF_LIFE_HOURS). Questions from
// a niche the learner has already practiced lose NICHE_PENALTY_PER_QUESTION
// per prior exposure, target-difficulty matches gain DIFFICULTY_MATCH_BONUS,
// and weak-concept questions gain WEAKNESS_BOOST so they surface more often.
// ============================================================

export const SELECTION_CONFIG = {
  // --- Base scores ---
  // Unseen questions always outrank seen ones by a wide margin.
  BASE_UNSEEN: 1000,
  BASE_SEEN: 0,

  // --- Recency decay (exponential falloff) ---
  // Half-life in HOURS. After one half-life the recency penalty halves.
  // Default 24h → a question answered 6 days ago has lost ~99% of its
  // penalty and behaves almost like a fresh question.
  RECENCY_HALF_LIFE_HOURS: 24,
  // The maximum recency penalty applied to a JUST-seen question.
  RECENCY_MAX_PENALTY: 500,

  // --- Same-niche diversity ---
  // Subtract this per prior question already answered inside the same niche.
  // Niche = topic, else subject::source (see utils/questionMetadata.niche).
  NICHE_PENALTY_PER_QUESTION: 50,

  // --- Difficulty alignment ---
  // Bonus applied when a question's difficulty matches the session target.
  DIFFICULTY_MATCH_BONUS: 200,

  // --- Weak-concept boost ---
  // Bonus for questions whose niche is one of the learner's weak concepts.
  WEAKNESS_BOOST: 300,

  // --- Pool management ---
  // Minimum number of candidate questions before the engine bothers to
  // specialize the pool (below this, fall back to the full subject pool).
  MIN_UNSEEN_FOR_PURE_UNSEEN: 5,
  // Minimum weak matches before the weakness mode specializes.
  MIN_WEAK_MATCHES: 5,

  // --- Fallback behaviour ---
  // Allow previously-seen questions to top up a set when unseen is exhausted.
  ALLOW_SEEN_FALLBACK: true,
  // Maximum fraction of a set that may come from seen questions.
  MAX_SEEN_RATIO: 0.3
};