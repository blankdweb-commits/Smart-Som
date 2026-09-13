// src/utils/answerMatch.js
//
// POLYNURSE 200-LEVEL answer-integrity fix — client mirror of the server's
// canonical answer matching (api/_answerMatch.js). The quiz-player highlight
// and one-look review MUST agree with the authoritative server decision, so
// both sides resolve a question's correct answer key against its own options
// with the same deterministic normalization.
//
// Deterministic rules (NO fuzzy matching, NO positional dependency):
//   - normalize: trim, collapse internal whitespace, lowercase, and strip a
//     single leading "A.".."E." option marker if present.
//   - An answer key that resolves to exactly one of the options = canonical.
//   - Submissions equal to that canonical option (after normalization) are
//     correct; anything else is wrong.

const LEADING_LETTER_RE = /^\s*[a-e]\s*[.)"':-]?\s*/i;

export function normalizeAnswerText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripOptionMarker(value) {
  return normalizeAnswerText(value).replace(LEADING_LETTER_RE, '');
}

// Resolve a question's correct-answer key to exactly one of its options.
// Returns { index, text } when uniquely resolvable, else null.
export function resolveCanonicalOption(correctAnswer, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const keyNorms = [normalizeAnswerText(correctAnswer), stripOptionMarker(correctAnswer)];
  const matches = [];
  for (let i = 0; i < options.length; i++) {
    const opt = String(options[i] ?? '');
    if (!opt) continue;
    const optNorm = normalizeAnswerText(opt);
    const optStripped = stripOptionMarker(opt);
    if (keyNorms.includes(optNorm) || keyNorms.includes(optStripped)) {
      matches.push({ index: i, text: opt });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

// The exact option text to DISPLAY as the correct answer (review + feedback),
// guaranteed to be one of the rendered options whenever the key is resolvable.
export function canonicalOptionText(correctAnswer, options) {
  const resolved = resolveCanonicalOption(correctAnswer, options);
  return resolved ? resolved.text : String(correctAnswer ?? '');
}

// Boolean: does this option text represent the correct answer?
export function optionMatchesCorrectAnswer(optionText, correctAnswer, options) {
  const submittedNorm = normalizeAnswerText(optionText);
  const resolved = resolveCanonicalOption(correctAnswer, options);
  if (resolved) {
    const optNorms = [normalizeAnswerText(resolved.text), stripOptionMarker(resolved.text)];
    return optNorms.includes(submittedNorm);
  }
  return submittedNorm === normalizeAnswerText(correctAnswer);
}