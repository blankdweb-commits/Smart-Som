// ============================================================
// Nursing 200-Level question canonical normalizer + hard validator.
//
// POLYNURSE 200-LEVEL ANSWER-INTEGRITY FIX (shared module).
// Used by the audit script, the DB seeder, and the integrity test suite so the
// source-ingestion pipeline has ONE canonical answer representation.
//
// CANONICAL REPRESENTATION (the only one that survives ingestion):
//   questions.correct_answer == the EXACT string of one of the row's own
//   options (trimmed). Everything else (A/B/C/D letters, raw text, and the
//   "D. " prefix convention found in the nutrition/politics sources) is
//   resolved INTO that canonical form BEFORE the row is stored or served.
//
// RULES:
//   - Never guess. A question whose answer cannot be resolved to exactly one
//     option is flagged (UNRESOLVED / AMBIGUOUS) and never inserted.
//   - Scoring is deterministic: strict equality AFTER a small, medically-safe
//     character normalization (trim / collapse whitespace / case + a single
//     leading "A.".."D." prefix marker). No inclusion/fuzzy matching.
//   - No positional letter is ever carried past this module.
// ============================================================

export const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

// ── Text normalization ─────────────────────────────────────
// Collapse internal whitespace, trim, lowercase. Strips a leading option
// marker ("A.", "B)", "C:", and case variants) if present. This is a fixed,
// deterministic character transform — NOT fuzzy matching.
const LEADING_LETTER_RE = /^\s*[a-e]\s*[.)"':\-]?\s*/i;

export function normalizeText(v) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripOptionMarker(v) {
  return normalizeText(v).replace(LEADING_LETTER_RE, '');
}

// ── Difficulty normalization ───────────────────────────────
const DIFFICULTY_LABELS = new Set(['Easy', 'Moderate', 'Hard', 'Expert']);

export function realDifficulty(raw, fallbackIdx = 0) {
  const d = typeof raw === 'string' ? raw : raw?.difficulty;
  if (typeof d === 'string' && DIFFICULTY_LABELS.has(d)) return d;
  if (typeof d === 'string' && /easy/i.test(d)) return 'Easy';
  if (typeof d === 'string' && /medium|moderate|intermediate/i.test(d)) return 'Moderate';
  if (typeof d === 'string' && /hard|difficult/i.test(d)) return 'Hard';
  if (typeof d === 'string' && /expert|advanced/i.test(d)) return 'Expert';
  const m = Number(fallbackIdx) % 10;
  if (m < 3) return 'Easy';
  if (m < 7) return 'Moderate';
  return 'Hard';
}

// ── Canonical answer resolution ────────────────────────────
// Resolves a source answer (letter, raw text, or prefixed text) to the EXACT
// string of one of the question's options. Returns { ok } plus the resolved
// option text / index. Never guesses: 0 matches = UNRESOLVED, 2+ = AMBIGUOUS.
export function resolveCanonicalAnswer(q) {
  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length === 0) {
    return { ok: false, kind: 'NO_OPTIONS', reason: 'question has no options' };
  }

  const raw = q.correct_answer;
  const rawStr = String(raw ?? '').trim();
  if (!rawStr) {
    return {
      ok: false,
      kind: 'MISSING_KEY',
      reason: 'correct_answer is empty',
      canReuseText: q.correct_answer_text ? String(q.correct_answer_text).trim() : '',
    };
  }

  // Letter convention ("A".."E") → resolve via position ONLY at this boundary.
  const upper = rawStr.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/^[A-E]$/.test(upper) || (upper.length <= 3 && /^[A-E][\s.)]+$/.test(upper))) {
    const letter = upper[0];
    const idx = LETTER_TO_INDEX[letter];
    if (idx >= options.length) {
      return { ok: false, kind: 'INVALID_INDEX', reason: `${letter} is out of range for ${options.length} options`, optionIndex: idx };
    }
    return {
      ok: true,
      kind: 'LETTER',
      canonical: String(options[idx]).trim(),
      optionIndex: idx,
    };
  }

  // Prefer the explicit text field if the key is a letter with text alongside,
  // otherwise proceed to text resolution.
  const textCandidates = [];
  if (q.correct_answer_text && String(q.correct_answer_text).trim()) {
    textCandidates.push(String(q.correct_answer_text).trim());
  }
  textCandidates.push(rawStr);

  const rawNorms = textCandidates.map(normalizeText);
  const rawStrippedNorms = new Set(textCandidates.map(stripOptionMarker));

  const matches = [];
  for (let i = 0; i < options.length; i++) {
    const opt = String(options[i] ?? '');
    if (!opt) continue;
    const optNorm = normalizeText(opt);
    const optStrippedNorm = stripOptionMarker(opt);
    const hit = rawNorms.includes(optNorm) ||
      rawNorms.includes(optStrippedNorm) ||
      rawStrippedNorms.has(optNorm) ||
      rawStrippedNorms.has(optStrippedNorm);
    if (hit) matches.push(i);
  }

  if (matches.length === 0) {
    return {
      ok: false,
      kind: 'UNRESOLVED',
      reason: 'correct_answer does not match any option after normalization',
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      kind: 'AMBIGUOUS',
      reason: `correct_answer matches ${matches.length} options after normalization`,
      optionIndexes: matches,
    };
  }
  const optionIndex = matches[0];
  return {
    ok: true,
    kind: 'TEXT',
    canonical: String(options[optionIndex]).trim(),
    optionIndex,
  };
}

// ── Hard validation ────────────────────────────────────────
// Returns { valid, flags, result }. A question is valid only when every hard
// invariant holds; the canonical answer resolves to exactly one option; and no
// duplicate option text exists (a duplicate would make text scoring ambiguous).
export function validateQuestion(q, { expectedOptions = 4, requireExplanation = false } = {}) {
  const flags = [];
  const id = q.question_id ?? q.id ?? null;
  const question = String(q.question ?? '').replace(/\s+/g, ' ').trim();

  if (id === null || id === undefined || String(id).trim() === '') flags.push('MISSING_ID');
  if (!question) flags.push('MISSING_QUESTION');
  if (!String(q.subject ?? '').trim()) flags.push('MISSING_SUBJECT');

  const options = Array.isArray(q.options) ? q.options : [];
  const optionStrings = options.map((o) => String(o ?? '').trim());
  if (optionStrings.length === 0) {
    flags.push('NO_OPTIONS');
  } else {
    if (optionStrings.some((o) => o === '')) flags.push('EMPTY_OPTION');
    if (optionStrings.length < 2) flags.push('TOO_FEW_OPTIONS');
    if (expectedOptions && optionStrings.length !== expectedOptions) {
      flags.push(`OPTION_COUNT_${optionStrings.length}`);
    }
    const seenRaw = new Set();
    const seenNorm = new Set();
    for (const o of optionStrings) {
      if (!o) continue;
      if (seenRaw.has(o)) flags.push('DUPLICATE_OPTION_TEXT');
      seenRaw.add(o);
      const n = normalizeText(o);
      if (seenNorm.has(n)) flags.push('DUPLICATE_NORMALIZED_OPTION');
      seenNorm.add(n);
    }
  }

  const resolved = resolveCanonicalAnswer(q);
  if (!resolved.ok) {
    flags.push(resolved.kind);
  } else if (optionStrings.length > 0) {
    const canonicalIsOption = optionStrings.some((o) => o === resolved.canonical);
    if (!canonicalIsOption) flags.push('CANONICAL_NOT_OPTION');
  }

  if (requireExplanation && !String(q.rationale ?? q.explanation ?? '').trim()) {
    flags.push('MISSING_EXPLANATION');
  }

  return {
    valid: flags.length === 0,
    flags,
    id,
    subject: String(q.subject ?? '').trim(),
    resolved,
    question: question.slice(0, 120),
  };
}

// ── Stable DB row mapping (seed-time only) ─────────────────
// Produces the canonical `questions`-table row for a validated source question.
// `keySalt` (e.g. "chn"/"fon") namespaces IDs so upsert never collides with
// pre-existing rows and stays idempotent across re-runs.
export function toDbRow(q, { subjectId, idPrefix, source }) {
  const resolved = resolveCanonicalAnswer(q);
  if (!resolved.ok) return null;
  const origId = q.question_id ?? q.id;
  const id = `${idPrefix}-${origId}`;
  const question = String(q.question ?? '').replace(/\s+/g, ' ').trim();
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o ?? '').trim());
  return {
    id,
    course_id: 'nursing200',
    subject_id: subjectId,
    topic_id: q.topic ? String(q.topic).trim() || null : q.subject ? String(q.subject).trim() : null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, origId ?? 0),
    question_type: q.question_type || 'mcq',
    exam_framework: null,
    question_text: question,
    options,
    correct_answer: resolved.canonical,
    explanation: q.rationale || q.explanation || q.clinical_application || null,
    hint: q.hints || q.hint || q.simplification || null,
    source,
    is_active: true,
    metadata: {
      question_version: 1,
      source_answer_key: String(q.correct_answer ?? ''),
      resolved_option_index: resolved.optionIndex,
      resolution_kind: resolved.kind,
      original_question_id: origId,
      original_subject: q.subject ?? null,
    },
  };
}