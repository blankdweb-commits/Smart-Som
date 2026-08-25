import rawPharmacologyData from './flashcards/nmcn/Phamarcology-Richard.json';

// Normalizes Richard's Pharmacology bank to the shared question shape used
// by the quiz engine. The raw file stores answers as letters ("A".."D")
// with the text duplicated in correct_answer_text, and uses "hints"
// (plural) instead of "hint".
const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

// The source file carries no difficulty metadata. To keep the bank
// available in every difficulty tier (the quiz filters each tier
// strictly), cards are distributed deterministically:
// ~30% Easy, ~40% Moderate, ~30% Hard by position.
const tierForIndex = (i) => {
  const m = i % 10;
  if (m < 3) return 'Easy';
  if (m < 7) return 'Moderate';
  return 'Hard';
};

const pharmacologyData = rawPharmacologyData.map((q, i) => {
  const letterIdx = LETTER_TO_INDEX[String(q.correct_answer || '').trim().toUpperCase()];
  const fromText = q.correct_answer_text ? String(q.correct_answer_text) : undefined;
  const fromLetter =
    letterIdx != null && Array.isArray(q.options) ? String(q.options[letterIdx]) : undefined;
  const correctAnswer = fromText || fromLetter;

  return {
    id: typeof q.id !== 'undefined' ? `pharm-${q.id}` : `pharm-idx-${i}`,
    question: q.question,
    options: Array.isArray(q.options) ? [...q.options] : [],
    correctAnswer,
    rationale: q.rationale || q.clinical_application || undefined,
    hint:
      q.hints ||
      q.simplification ||
      'Focus on the pharmacological principle being tested.',
    subject: q.subject || 'Pharmacology',
    category: 'NMCN',
    difficulty: tierForIndex(i),
    source: "Richard's Pharmacology"
  };
});

export default pharmacologyData;
