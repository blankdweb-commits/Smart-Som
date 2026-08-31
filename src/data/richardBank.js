import rawPharmacology from './flashcards/nmcn/Phamarcology-Richard.json';
import rawMusculoskeletal from './flashcards/nmcn/muscleskeletal-Richard.json';
import rawNeurological from './flashcards/nmcn/Neurological-Nursing.json';
import rawNursing200 from './flashcards/nmcn/200level questions.json';
import rawMidwifery from './flashcards/nmcn/200-level-midwifery.json';

// Normalizes Richard-style question banks to the shared question shape used
// by the quiz engine. These raw files store answers as letters ("A".."D")
// with the text duplicated in correct_answer_text, and use "hints"
// (plural) instead of "hint".
const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

// The Richard banks carry no difficulty metadata. To keep every bank
// available in each difficulty tier (the quiz filters tiers strictly),
// cards are distributed deterministically: ~30% Easy, ~40% Moderate,
// ~30% Hard by position.
const tierForIndex = (i) => {
  const m = i % 10;
  if (m < 3) return 'Easy';
  if (m < 7) return 'Moderate';
  return 'Hard';
};

// The app's difficulty scale is Easy / Medium / Hard / Expert (plus higher
// tiers used in other pools). When a bank card carries an explicit difficulty
// value on the fancier scale, honor it so curated metadata is used instead of
// the deterministic position fallback.
const DIFFICULTY_LABELS = new Set(['Easy', 'Medium', 'Hard', 'Expert', 'Master', 'Extreme']);

const realDifficulty = (q, i) => {
  const d = q.difficulty;
  if (typeof d === 'string' && DIFFICULTY_LABELS.has(d)) return d;
  if (typeof d === 'string' && /easy/i.test(d)) return 'Easy';
  if (typeof d === 'string' && /medium|moderate|intermediate/i.test(d)) return 'Medium';
  if (typeof d === 'string' && /hard|difficult/i.test(d)) return 'Hard';
  if (typeof d === 'string' && /expert|advanced/i.test(d)) return 'Expert';
  return tierForIndex(i);
};

// A bank stores its answer either as a single option letter ("A".."E") with the
// text duplicated in correct_answer_text (Richard-style), OR as the full answer
// text directly in correct_answer with no separate text field (200-level file).
// Detect which convention a row uses so the correct answer is never left
// undefined.
const resolveCorrectAnswer = (q) => {
  const raw = String(q.correct_answer || '').trim();
  const letterIdx = LETTER_TO_INDEX[raw.toUpperCase()];
  // Letter convention: correct_answer is a single letter A–E.
  if (letterIdx != null && Array.isArray(q.options)) {
    return q.correct_answer_text || String(q.options[letterIdx]);
  }
  // Full-text convention: correct_answer IS the answer text.
  return raw || q.correct_answer_text || undefined;
};

// Prefer the bank's own numeric id when present. The 200-level file uses
// `question_id`; the midwifery/other banks use `id`.
const bankItemId = (q, prefix, i) => {
  const numeric = typeof q.id !== 'undefined' ? q.id : q.question_id;
  return typeof numeric !== 'undefined' ? `${prefix}-${numeric}` : `${prefix}-idx-${i}`;
};

const normalizeRichardBank = (raw, { prefix, source }) =>
  raw.map((q, i) => {
    return {
      id: bankItemId(q, prefix, i),
      question: q.question,
      options: Array.isArray(q.options) ? [...q.options] : [],
      correctAnswer: resolveCorrectAnswer(q),
      rationale: q.rationale || q.clinical_application || undefined,
      hint:
        q.hints ||
        q.simplification ||
        'Focus on the core nursing principle being tested.',
      subject: q.subject || source,
      category: 'NMCN',
      difficulty: realDifficulty(q, i),
      source
    };
  });

export const pharmacologyData = normalizeRichardBank(rawPharmacology, {
  prefix: 'pharm',
  source: "Richard's Pharmacology"
});

export const musculoskeletalData = normalizeRichardBank(rawMusculoskeletal, {
  prefix: 'msk',
  source: "Richard's Musculoskeletal"
});

export const neurologicalData = normalizeRichardBank(rawNeurological, {
  prefix: 'neuro',
  source: "Richard's Neurological"
});

export const nursing200Data = normalizeRichardBank(rawNursing200, {
  prefix: 'n200',
  source: 'Nursing 200-Level'
});

export const midwiferyData = normalizeRichardBank(rawMidwifery, {
  prefix: 'midw',
  source: 'Midwifery 200-Level'
});
