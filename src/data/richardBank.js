import rawPharmacology from './flashcards/nmcn/Phamarcology-Richard.json';
import rawMusculoskeletal from './flashcards/nmcn/muscleskeletal-Richard.json';
import rawNeurological from './flashcards/nmcn/Neurological-Nursing.json';

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

const normalizeRichardBank = (raw, { prefix, source }) =>
  raw.map((q, i) => {
    const letterIdx = LETTER_TO_INDEX[String(q.correct_answer || '').trim().toUpperCase()];
    const fromText = q.correct_answer_text ? String(q.correct_answer_text) : undefined;
    const fromLetter =
      letterIdx != null && Array.isArray(q.options) ? String(q.options[letterIdx]) : undefined;

    return {
      id: typeof q.id !== 'undefined' ? `${prefix}-${q.id}` : `${prefix}-idx-${i}`,
      question: q.question,
      options: Array.isArray(q.options) ? [...q.options] : [],
      correctAnswer: fromText || fromLetter,
      rationale: q.rationale || q.clinical_application || undefined,
      hint:
        q.hints ||
        q.simplification ||
        'Focus on the core nursing principle being tested.',
      subject: q.subject || source,
      category: 'NMCN',
      difficulty: tierForIndex(i),
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
