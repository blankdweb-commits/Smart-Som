// ============================================================
// Controlled-Random Question Selection Configuration
//
// Central source of truth for ALL selection parameters.
// This file is imported by both the server-side selection service
// and (optionally) client-side diagnostic tools.
//
// All values are tunable without rewriting the algorithm.
// ============================================================

export const SELECTION_CONFIG = {
  // --- Recency weights (batch distance) ---
  // Weight multiplied against the question's base score.
  // "never_seen" = never appeared in any of the user's batches.
  // "previous_batch" = appeared in the most recent batch.
  // Values decrease as recency increases (recently seen = low weight).
  RECENCY_WEIGHTS: {
    never_seen: 1.00,
    previous_batch: 0.05,
    two_batches_ago: 0.15,
    three_batches_ago: 0.30,
    four_batches_ago: 0.50,
    five_batches_ago: 0.70,
    six_plus_batches_ago: 1.00,
  },

  // --- Time-based recency ---
  // Half-life in hours for the time-decay component.
  // After this many hours, the time penalty halves.
  TIME_RECENCY_HALF_LIFE_HOURS: 24,

  // Maximum time penalty (applied to a just-seen question).
  TIME_RECENCY_MAX_PENALTY: 0.4,

  // --- Unseen question priority ---
  // Multiplier for never-seen questions vs. seen questions.
  // Higher = stronger preference for unseen. But NOT absolute dominance.
  UNSEEN_MULTIPLIER: 2.0,

  // --- Topic diversity ---
  // Penalty applied per additional question from the same topic
  // already selected in the current batch.
  TOPIC_PENALTY_PER_QUESTION: 0.15,

  // Maximum fraction of a batch that can come from one topic.
  // Soft limit â€” may be exceeded if pool is small.
  MAX_SAME_TOPIC_RATIO: 0.35,

  // --- Concept diversity ---
  // Penalty per additional question sharing the same concept_id.
  // Stronger than topic penalty because concepts are more granular.
  CONCEPT_PENALTY_PER_QUESTION: 0.25,

  // Maximum fraction of a batch from one concept.
  MAX_SAME_CONCEPT_RATIO: 0.20,

  // --- Randomness ---
  // Each question's final weight is multiplied by a random factor
  // in this range. Introduces controlled variability.
  RANDOMNESS_RANGE: [0.8, 1.2],

  // --- Difficulty weights ---
  // Bonus multiplier when a question matches the requested difficulty.
  DIFFICULTY_MATCH_BONUS: 1.5,
  DIFFICULTY_MISMATCH_PENALTY: 0.7,

  // --- Base weights ---
  BASE_WEIGHT: 1.0,

  // --- Progressive relaxation thresholds ---
  // When the pool is too small to fill a batch with strict settings,
  // relax constraints in order. Each level is tried when the previous
  // level cannot produce enough candidates.
  RELAXATION_LEVELS: [
    {
      name: 'strict',
      topicPenaltyMultiplier: 1.0,
      conceptPenaltyMultiplier: 1.0,
      recencyMultiplier: 1.0,
      useTimeDecay: true,
    },
    {
      name: 'relax_concept',
      topicPenaltyMultiplier: 1.0,
      conceptPenaltyMultiplier: 0.3,
      recencyMultiplier: 1.0,
      useTimeDecay: true,
    },
    {
      name: 'relax_topic',
      topicPenaltyMultiplier: 0.3,
      conceptPenaltyMultiplier: 0.3,
      recencyMultiplier: 1.0,
      useTimeDecay: true,
    },
    {
      name: 'relax_recency',
      topicPenaltyMultiplier: 0.3,
      conceptPenaltyMultiplier: 0.3,
      recencyMultiplier: 0.3,
      useTimeDecay: false,
    },
    {
      name: 'minimal',
      topicPenaltyMultiplier: 0.0,
      conceptPenaltyMultiplier: 0.0,
      recencyMultiplier: 0.0,
      useTimeDecay: false,
    },
  ],

  // --- Batch management ---
  // How long a reserved batch lives before being abandoned.
  BATCH_EXPIRY_MINUTES: 10,

  // --- Mode-specific configurations ---
  MODE_CONFIGS: {
    practice: {
      batchSize: 10,
      difficultyDistribution: { Easy: 10 },
      recencyAggressive: false,
    },
    dailyQuiz: {
      batchSize: 10,
      difficultyDistribution: { Easy: 3, Moderate: 4, Hard: 3 },
      recencyAggressive: true,
    },
    topicQuiz: {
      batchSize: 20,
      difficultyDistribution: { Easy: 5, Moderate: 5, Hard: 5, Expert: 5 },
      topicFocus: true,
    },
    examSimulation: {
      batchSize: 50,
      difficultyDistribution: { Easy: 10, Moderate: 15, Hard: 15, Expert: 10 },
    },
    nclex: {
      batchSize: 30,
      difficultyDistribution: { Easy: 5, Moderate: 10, Hard: 10, Expert: 5 },
      framework: 'NCLEX',
    },
    nmcn: {
      batchSize: 30,
      difficultyDistribution: { Easy: 5, Moderate: 10, Hard: 10, Expert: 5 },
      framework: 'NMCN',
    },
    oneVsOne: {
      batchSize: 10,
      difficultyDistribution: { Easy: 2, Moderate: 3, Hard: 3, Expert: 2 },
      sharedSequence: true,
    },
    weakness: {
      batchSize: 20,
      difficultyDistribution: { Easy: 5, Moderate: 5, Hard: 5, Expert: 5 },
      prioritizeWeak: true,
    },
  },

  // --- Allowed difficulty tiers ---
  VALID_DIFFICULTIES: ['Easy', 'Moderate', 'Hard', 'Expert'],

  // --- Allowed exam frameworks ---
  VALID_FRAMEWORKS: ['NCLEX', 'NMCN'],

  // --- Allowed modes ---
  VALID_MODES: [
    'practice', 'dailyQuiz', 'topicQuiz', 'examSimulation',
    'nclex', 'nmcn', 'oneVsOne', 'weakness',
  ],
};

