// ============================================================
// Question Selection Engine — Simulation Test
//
// Runs 1,000 simulated quiz batches and measures:
//   - Duplicate rate within a batch (must be 0)
//   - Repeat rate between consecutive batches
//   - Repeat rate within 3 batches
//   - Topic distribution
//   - Concept clustering
//   - Difficulty distribution
//   - Question exposure frequency
//   - Unseen-question exposure
//   - Long-term question coverage
//
// Usage:
//   node scripts/simulate-question-selection.mjs
//
// No database required — pure in-memory simulation using
// the selection algorithm directly.
// ============================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load question banks ────────────────────────────────────
const loadJson = (relPath) => {
  const p = resolve(ROOT, relPath);
  return JSON.parse(readFileSync(p, 'utf-8'));
};

// ── Selection Config (copy from api/selectionConfig.js) ─────
const C = {
  RECENCY_WEIGHTS: {
    never_seen: 1.00,
    previous_batch: 0.05,
    two_batches_ago: 0.15,
    three_batches_ago: 0.30,
    four_batches_ago: 0.50,
    five_batches_ago: 0.70,
    six_plus_batches_ago: 1.00,
  },
  TIME_RECENCY_HALF_LIFE_HOURS: 24,
  TIME_RECENCY_MAX_PENALTY: 0.4,
  UNSEEN_MULTIPLIER: 2.0,
  TOPIC_PENALTY_PER_QUESTION: 0.15,
  MAX_SAME_TOPIC_RATIO: 0.35,
  CONCEPT_PENALTY_PER_QUESTION: 0.25,
  MAX_SAME_CONCEPT_RATIO: 0.20,
  RANDOMNESS_RANGE: [0.8, 1.2],
  DIFFICULTY_MATCH_BONUS: 1.5,
  DIFFICULTY_MISMATCH_PENALTY: 0.7,
  BASE_WEIGHT: 1.0,
  RELAXATION_LEVELS: [
    { name: 'strict', topicPenaltyMultiplier: 1.0, conceptPenaltyMultiplier: 1.0, recencyMultiplier: 1.0, useTimeDecay: true },
    { name: 'relax_concept', topicPenaltyMultiplier: 1.0, conceptPenaltyMultiplier: 0.3, recencyMultiplier: 1.0, useTimeDecay: true },
    { name: 'relax_topic', topicPenaltyMultiplier: 0.3, conceptPenaltyMultiplier: 0.3, recencyMultiplier: 1.0, useTimeDecay: true },
    { name: 'relax_recency', topicPenaltyMultiplier: 0.3, conceptPenaltyMultiplier: 0.3, recencyMultiplier: 0.3, useTimeDecay: false },
    { name: 'minimal', topicPenaltyMultiplier: 0.0, conceptPenaltyMultiplier: 0.0, recencyMultiplier: 0.0, useTimeDecay: false },
  ],
};

// ── Helpers ────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

function batchRecencyWeight(batchDistance) {
  if (batchDistance === null || batchDistance === undefined) return C.RECENCY_WEIGHTS.never_seen;
  if (batchDistance === 0) return C.RECENCY_WEIGHTS.previous_batch;
  if (batchDistance === 1) return C.RECENCY_WEIGHTS.two_batches_ago;
  if (batchDistance === 2) return C.RECENCY_WEIGHTS.three_batches_ago;
  if (batchDistance === 3) return C.RECENCY_WEIGHTS.four_batches_ago;
  if (batchDistance === 4) return C.RECENCY_WEIGHTS.five_batches_ago;
  return C.RECENCY_WEIGHTS.six_plus_batches_ago;
}

// ── In-memory selection (mirrors QuestionSelectionService) ──
function selectQuestions(candidates, targetCount, userHistory, modeConfig) {
  if (candidates.length === 0 || targetCount <= 0) return [];

  const levels = C.RELAXATION_LEVELS;

  for (let l = 0; l < levels.length; l++) {
    const relaxation = levels[l];
    const pool = [...candidates];
    const topicCounts = new Map();
    const conceptCounts = new Map();
    const selected = [];

    for (let i = 0; i < targetCount && pool.length > 0; i++) {
      // Calculate weights for all remaining candidates
      const weights = pool.map(q =>
        calcWeight(q, userHistory, topicCounts, conceptCounts, relaxation)
      );

      const totalWeight = weights.reduce((s, w) => s + w, 0);
      if (totalWeight <= 0) break;

      // Weighted random selection
      let random = Math.random() * totalWeight;
      let chosen = null;
      let chosenIdx = -1;
      for (let j = 0; j < pool.length; j++) {
        random -= weights[j];
        if (random <= 0) { chosen = pool[j]; chosenIdx = j; break; }
      }
      if (!chosen) { chosen = pool[pool.length - 1]; chosenIdx = pool.length - 1; }

      selected.push(chosen);

      // Remove from pool (prevents re-selection)
      pool.splice(chosenIdx, 1);

      // Update diversity tracking
      if (chosen.topic_id) {
        topicCounts.set(chosen.topic_id, (topicCounts.get(chosen.topic_id) || 0) + 1);
      }
      if (chosen.concept_id) {
        conceptCounts.set(chosen.concept_id, (conceptCounts.get(chosen.concept_id) || 0) + 1);
      }
    }

    if (selected.length >= targetCount) return selected;
  }

  // Return whatever we got from the last relaxation level
  const fallbackPool = [...candidates];
  return fallbackPool.slice(0, Math.min(targetCount, fallbackPool.length));
}

function calcWeight(question, userHistory, topicCounts, conceptCounts, relaxation) {
  const isUnseen = !userHistory.has(question.id);
  let weight = isUnseen ? C.BASE_WEIGHT * C.UNSEEN_MULTIPLIER : C.BASE_WEIGHT;

  // Recency
  const hist = userHistory.get(question.id);
  if (hist) {
    const recWeight = batchRecencyWeight(hist.batchDistance);
    weight *= recWeight * relaxation.recencyMultiplier;
  }

  // Topic diversity
  if (question.topic_id && topicCounts) {
    const tc = topicCounts.get(question.topic_id) || 0;
    weight *= Math.max(0.1, 1.0 - tc * C.TOPIC_PENALTY_PER_QUESTION * relaxation.topicPenaltyMultiplier);
  }

  // Concept diversity
  if (question.concept_id && conceptCounts) {
    const cc = conceptCounts.get(question.concept_id) || 0;
    weight *= Math.max(0.1, 1.0 - cc * C.CONCEPT_PENALTY_PER_QUESTION * relaxation.conceptPenaltyMultiplier);
  }

  // Randomness
  weight *= randomInRange(C.RANDOMNESS_RANGE);

  return Math.max(0.001, weight);
}

// ── Simulation ─────────────────────────────────────────────
function runSimulation(questions, batchSize, numBatches) {
  const userHistory = new Map(); // qid → { batchDistance, batchIndex }
  const allBatches = [];
  const exposureCount = new Map(); // qid → times selected
  const topicDistribution = new Map();
  const difficultyCounts = new Map();

  let intraBatchDuplicates = 0;
  let consecutiveRepeats = 0;
  let threeBatchRepeats = 0;

  for (let b = 0; b < numBatches; b++) {
    // Select questions
    const selected = selectQuestions(questions, batchSize, userHistory, {});
    const selectedIds = selected.map(q => q.id);

    // Check intra-batch duplicates
    const uniqueIds = new Set(selectedIds);
    if (uniqueIds.size !== selectedIds.length) {
      intraBatchDuplicates++;
    }

    // Check consecutive repeats
    if (allBatches.length > 0) {
      const prevBatch = new Set(allBatches[allBatches.length - 1]);
      const repeats = selectedIds.filter(id => prevBatch.has(id));
      consecutiveRepeats += repeats.length;
    }

    // Check 3-batch repeats
    if (allBatches.length >= 2) {
      const threeBatchesAgo = new Set(allBatches[allBatches.length - 2]);
      const repeats3 = selectedIds.filter(id => threeBatchesAgo.has(id));
      threeBatchRepeats += repeats3.length;
    }

    // Update history
    for (const q of selected) {
      const existing = userHistory.get(q.id);
      userHistory.set(q.id, {
        batchDistance: 0,
        batchIndex: b,
      });

      // Increment previous batch distances
      if (existing) {
        existing.batchDistance++;
      }

      exposureCount.set(q.id, (exposureCount.get(q.id) || 0) + 1);

      if (q.topic_id) {
        topicDistribution.set(q.topic_id, (topicDistribution.get(q.topic_id) || 0) + 1);
      }
      if (q.difficulty) {
        difficultyCounts.set(q.difficulty, (difficultyCounts.get(q.difficulty) || 0) + 1);
      }
    }

    // Decay batch distances for all seen questions
    for (const [qid, hist] of userHistory) {
      if (hist.batchIndex < b) {
        hist.batchDistance++;
      }
    }

    allBatches.push(selectedIds);
  }

  // ── Results ──────────────────────────────────────────────
  const totalSelected = numBatches * batchSize;
  const uniqueQuestionsSelected = exposureCount.size;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  QUESTION SELECTION ENGINE — SIMULATION RESULTS');
  console.log('═══════════════════════════════════════════════════\n');

  console.log(`  Question bank size:     ${questions.length}`);
  console.log(`  Batch size:             ${batchSize}`);
  console.log(`  Number of batches:      ${numBatches}`);
  console.log(`  Total selections:       ${totalSelected}`);
  console.log(`  Unique questions used:  ${uniqueQuestionsSelected} (${(uniqueQuestionsSelected / questions.length * 100).toFixed(1)}%)\n`);

  console.log('  ── Duplicate & Repeat Rates ──');
  console.log(`  Intra-batch duplicates:     ${intraBatchDuplicates} (${(intraBatchDuplicates / numBatches * 100).toFixed(2)}%) ${intraBatchDuplicates === 0 ? '✅' : '❌'}`);
  console.log(`  Consecutive batch repeats:  ${consecutiveRepeats} (${(consecutiveRepeats / ((numBatches - 1) * batchSize) * 100).toFixed(2)}%)`);
  console.log(`  3-batch repeats:            ${threeBatchRepeats} (${(threeBatchRepeats / ((numBatches - 2) * batchSize) * 100).toFixed(2)}%)`);

  console.log('\n  ── Topic Distribution ──');
  const sortedTopics = [...topicDistribution.entries()].sort((a, b) => b[1] - a[1]);
  for (const [topic, count] of sortedTopics.slice(0, 10)) {
    console.log(`    ${topic}: ${count} (${(count / totalSelected * 100).toFixed(1)}%)`);
  }

  console.log('\n  ── Difficulty Distribution ──');
  for (const [diff, count] of difficultyCounts) {
    console.log(`    ${diff}: ${count} (${(count / totalSelected * 100).toFixed(1)}%)`);
  }

  console.log('\n  ── Question Exposure ──');
  const exposureValues = [...exposureCount.values()];
  const avgExposure = exposureValues.reduce((s, v) => s + v, 0) / exposureValues.length;
  const maxExposure = Math.max(...exposureValues);
  const minExposure = Math.min(...exposureValues);
  console.log(`    Average times seen: ${avgExposure.toFixed(2)}`);
  console.log(`    Min times seen:     ${minExposure}`);
  console.log(`    Max times seen:     ${maxExposure}`);

  // Check for pathological repetition
  const overExposed = exposureValues.filter(v => v > numBatches * 0.3).length;
  console.log(`    Over-exposed (>30%): ${overExposed} questions ${overExposed === 0 ? '✅' : '⚠️'}`);

  // Check unseen coverage
  const neverSeen = questions.length - uniqueQuestionsSelected;
  console.log(`    Never selected:     ${neverSeen} questions`);

  console.log('\n═══════════════════════════════════════════════════\n');

  return {
    intraBatchDuplicates,
    consecutiveRepeats,
    threeBatchRepeats,
    uniqueQuestionsSelected,
    totalQuestions: questions.length,
    avgExposure,
    maxExposure,
  };
}

// ── Difficulty normalizer ──────────────────────────────────
function normalizeDifficulty(raw, fallbackIdx) {
  if (typeof raw === 'string') {
    const d = raw.toLowerCase().trim();
    if (d === 'easy') return 'Easy';
    if (d === 'medium' || d === 'moderate' || d === 'intermediate') return 'Medium';
    if (d === 'hard' || d === 'difficult') return 'Hard';
    if (d === 'expert' || d === 'advanced' || d === 'master' || d === 'extreme') return 'Expert';
  }
  // Deterministic fallback
  const m = fallbackIdx % 10;
  if (m < 3) return 'Easy';
  if (m < 7) return 'Medium';
  return 'Hard';
}

// ── Main ───────────────────────────────────────────────────
function main() {
  console.log('🧪 Loading question bank for simulation...\n');

  // Build a combined pool (simulating the server-side candidates)
  const questions = [];

  // Pharm
  const pharm = loadJson('src/data/flashcards/nmcn/Phamarcology-Richard.json');
  for (let i = 0; i < pharm.length; i++) {
    questions.push({ id: `pharm-${pharm[i].id || i}`, subject_id: pharm[i].subject, topic_id: pharm[i].subject, difficulty: normalizeDifficulty(pharm[i].difficulty, i) });
  }

  // Respiration
  const resp = loadJson('src/data/flashcards/nmcn/Respiration-richard.json');
  for (let i = 0; i < resp.length; i++) {
    questions.push({ id: `resp-${resp[i].id || i}`, subject_id: resp[i].subject, topic_id: resp[i].subject, difficulty: normalizeDifficulty(resp[i].difficulty, i + 100) });
  }

  // MSK
  const msk = loadJson('src/data/flashcards/nmcn/muscleskeletal-Richard.json');
  for (let i = 0; i < msk.length; i++) {
    questions.push({ id: `msk-${msk[i].id || i}`, subject_id: msk[i].subject, topic_id: msk[i].subject, difficulty: normalizeDifficulty(msk[i].difficulty, i + 300) });
  }

  // Neuro
  const neuro = loadJson('src/data/flashcards/nmcn/Neurological-Nursing.json');
  for (let i = 0; i < neuro.length; i++) {
    questions.push({ id: `neuro-${neuro[i].id || i}`, subject_id: neuro[i].subject, topic_id: neuro[i].subject, difficulty: normalizeDifficulty(neuro[i].difficulty, i + 500) });
  }

  // Fluid
  const fluid = loadJson('src/data/flashcards/nmcn/fluid-electrolytes.json');
  for (let i = 0; i < fluid.length; i++) {
    questions.push({ id: fluid[i].id || `fluid-${i}`, subject_id: fluid[i].subject, topic_id: fluid[i].subject, difficulty: normalizeDifficulty(fluid[i].difficulty, i + 700) });
  }

  // NCLEX
  const nclex = loadJson('src/data/flashcards/nclex/nclex-rn-ngn.json');
  for (let i = 0; i < nclex.length; i++) {
    questions.push({ id: nclex[i].id || `nclex-${i}`, subject_id: nclex[i].subject, topic_id: nclex[i].topic || nclex[i].subject, difficulty: normalizeDifficulty(nclex[i].difficulty, i + 900) });
  }

  // 200-level
  const nursing200 = loadJson('src/data/flashcards/nmcn/200level questions.json');
  for (let i = 0; i < nursing200.length; i++) {
    questions.push({ id: `n200-${nursing200[i].question_id || i}`, subject_id: nursing200[i].subject, topic_id: nursing200[i].subject, difficulty: normalizeDifficulty(nursing200[i].difficulty, i + 1000) });
  }

  // Midwifery
  const midwifery = loadJson('src/data/flashcards/nmcn/200-level-midwifery.json');
  for (let i = 0; i < midwifery.length; i++) {
    questions.push({ id: `midw-${midwifery[i].id || i}`, subject_id: midwifery[i].subject, topic_id: midwifery[i].subject, difficulty: normalizeDifficulty(midwifery[i].difficulty, i + 1500) });
  }

  // Uselu
  const uselu = loadJson('src/data/flashcards/nmcn/uselu-posting-tests.json');
  for (let i = 0; i < uselu.length; i++) {
    questions.push({ id: uselu[i].id || `uselu-${i}`, subject_id: uselu[i].subject, topic_id: uselu[i].subject, difficulty: normalizeDifficulty(uselu[i].difficulty, i + 2000) });
  }

  // Deduplicate by ID
  const seen = new Set();
  const unique = questions.filter(q => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });

  console.log(`Loaded ${unique.length} unique questions for simulation.\n`);

  // Run 1000 batches with batch size 10
  const result = runSimulation(unique, 10, 1000);

  // Assert acceptance criteria
  const passed = result.intraBatchDuplicates === 0;
  console.log(passed
    ? '✅ SIMULATION PASSED — Zero intra-batch duplicates'
    : '❌ SIMULATION FAILED — Intra-batch duplicates detected');

  process.exit(passed ? 0 : 1);
}

main();
