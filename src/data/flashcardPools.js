// Central question-pool registry. All bundled banks live here so the quiz
// engine, the Setup Flow, and the Weakness Drill page can share the same
// canonical pools without circular imports.
import useluData from './flashcards/nmcn/uselu-posting-tests.json';
import respirationData from './flashcards/nmcn/Respiration-richard.json';
import fluidData from './flashcards/nmcn/fluid-electrolytes.json';
import rawNclex from './flashcards/nclex/nclex-rn-ngn.json';
import { pharmacologyData, musculoskeletalData, neurologicalData, nursing200Data, midwiferyData } from './richardBank';

export const USELU_POOL = useluData;

// NMCN-category exam banks (respiratory, pharmacology, musculoskeletal,
// neurological). fluid-electrolytes is NCLEX-category and is deliberately
// excluded from the NMCN pool.
export const NMCN_POOL = [
  ...respirationData,
  ...pharmacologyData,
  ...musculoskeletalData,
  ...neurologicalData
];

// NCLEX-category exam banks — drawn ONLY by the Clinical and Quick modes when
// the learner picks the NCLEX (or Both) source. The rich fluid-electrolytes
// bank is a full MCQ bank; nclex-rn-ngn is flashcard-shaped (single `answer`,
// no options array), so the quiz player synthesizes distractors for it.
export const NCLEX_POOL = [
  ...fluidData,
  ...(Array.isArray(rawNclex) ? rawNclex : []).map((q, i) => ({
    id: String(q.id || `nclex-idx-${i}`),
    question: q.question,
    options: Array.isArray(q.options) ? [...q.options] : [],
    correctAnswer: q.correctAnswer || q.answer || undefined,
    rationale: q.rationale || undefined,
    hint: q.hint || 'Think through the nursing priority and reasoning being tested.',
    subject: q.subject || 'NCLEX-RN',
    topic: q.topic,
    category: 'NCLEX',
    difficulty: q.difficulty || 'Medium',
    source: 'NCLEX'
  }))
];

// All exam-purpose banks (used by Clinical/Quick "Both" and Weakness modes).
export const ALL_EXAM_POOL = [...NMCN_POOL, ...NCLEX_POOL];

// Nursing 200-Level is a dedicated bank drawn by its own mode card only — it
// is intentionally NOT part of the NMCN/NCLEX exam pools.
export const NURSING200_POOL = nursing200Data;

// Midwifery 200-Level — dedicated bank with its own mode.
export const MIDWIFERY_POOL = midwiferyData;

// Every bundled question (used to rehydrate a learner's missed questions).
export const ALL_BANKS = [
  ...USELU_POOL,
  ...NMCN_POOL,
  ...NCLEX_POOL,
  ...NURSING200_POOL,
  ...MIDWIFERY_POOL
];