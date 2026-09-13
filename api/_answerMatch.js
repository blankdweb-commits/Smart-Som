// api/_answerMatch.js
//
// POLYNURSE 200-LEVEL SCORING-INTEGRITY FIX — canonical answer matching.
//
// Single source of truth for server-side grading. Scoring is DETERMINISTIC:
//
//   1. The stored `correct_answer` key is resolved against the question's OWN
//      options using exact-equality-after-normalization (trim, collapse
//      whitespace, case, and a single leading "A.".."E." marker).
//      -> There is no positional dependency, and the prefix convention found
//         in the Nutrition / Politics sources ("D. <text>" vs option "<text>")
//         scores correctly WITHOUT fuzzy matching.
//   2. A client-submitted integer option index is compared to the resolved
//      canonical option text.
//   3. Strict key equality is the final fallback.
//
// When the key cannot be resolved to exactly ONE option (duplicates/ambiguity),
// grading never guesses: it falls back to strict key equality only.
//
// Underscore prefix: not deployed to Vercel as a separate function.

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

// Resolves a stored answer key to exactly one option. Returns
// { index, text } on exactly one hit, else null (never guesses).
export function resolveCanonicalOptionKey(canonicalKey, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const keyNorms = [normalizeAnswerText(canonicalKey), stripOptionMarker(canonicalKey)];
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

// Is `submitted` (option text OR integer option index) the correct answer?
export function gradeAnswer(submitted, canonicalKey, options) {
  if (submitted === null || submitted === undefined || submitted === '') return false;

  const submittedNorm = normalizeAnswerText(submitted);
  const keyNorm = normalizeAnswerText(canonicalKey);

  const canonical = resolveCanonicalOptionKey(canonicalKey, options);
  if (canonical) {
    const optNorms = [normalizeAnswerText(canonical.text), stripOptionMarker(canonical.text)];
    if (optNorms.includes(submittedNorm)) return true;
  }

  // Integer-index submission (stability fallback for legacy clients).
  const asIndex = Number(submitted);
  if (Array.isArray(options) && Number.isInteger(asIndex) && asIndex >= 0 && asIndex < options.length) {
    const idxNorms = [normalizeAnswerText(String(options[asIndex] ?? '')), stripOptionMarker(String(options[asIndex] ?? ''))];
    if (canonical) {
      if (idxNorms.includes(normalizeAnswerText(canonical.text))) return true;
    } else if (idxNorms.includes(keyNorm)) return true;
  }

  // Strict key equality (last resort, deterministic).
  if (submittedNorm === keyNorm) return true;

  return false;
}