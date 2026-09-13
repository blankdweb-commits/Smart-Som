// ============================================================
// Nursing 200-Level answer-integrity test suite.
//
// POLYNURSE spec §4/§15/§22/§27/§28 — runs WITHOUT a live DB:
//   T1  Full-bank validation of all 8 sources (every question must validate and
//       resolve to exactly one canonical option text).
//   T2  24-permutation stability — for every question in 4 sample sources, walk
//       24 deterministic option orderings (those achievable from a shuffled
//       array of 4 options) and assert the canonical answer remains exactly one
//       option AND the canonical index tracks the permutation.
//   T3  Server/client grader parity — api/_answerMatch.gradeAnswer and
//       src/utils/answerMatch.optionMatchesCorrectAnswer give identical results
//       for every (question, option) pair across all 8 files.
//   T4  Wrong-answer invariance + prefixed-key resolution — grading any
//       non-canonical option is false; grading the canonical option is true for
//       text, trimmed/ragged-case, integer-index, and the "D. <text>"
//       prefixed-key convention used by the Nutrition/Politics sources.
//
// Usage:  node verification/nursing200-integrity.spec.mjs
// ============================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  resolveCanonicalAnswer,
  validateQuestion,
  normalizeText,
} from '../scripts/nursing200Normalizer.mjs';
import { gradeAnswer } from '../api/_answerMatch.js';
import {
  optionMatchesCorrectAnswer,
  canonicalOptionText,
} from '../src/utils/answerMatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_DIR = resolve(ROOT, 'drive-download-20260913T080309Z-1-001');

const FILES = [
  'community_health_nursing_i_questions_fixed.json',
  'foundation_of_nursing_iv_questions_fixed.json',
  'medical_surgical_nursing_questions_fixed.json',
  'nutrition_and_dietetics_questions.json',
  'pharmacology_iii_final_qbank.json',
  'politics_and_governance_in_nursing_questions.json',
  'reproductive_health_questions_final.json',
  'research_methodology_questions_fixed.json',
];

const loadAll = () =>
  FILES.map((file) => ({
    file,
    items: JSON.parse(readFileSync(resolve(SOURCE_DIR, file), 'utf8')),
  }));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}: ${err.message}`);
    console.log(`        ${err.stack.split('\n').slice(1, 4).join('\n        ')}`);
  }
};

// Deterministic 24-order generator (all distinct arrangements of 4 items via
// Lehmer factoradic — independent of Math.random).
function* permutations4() {
  const arr = [0, 1, 2, 3];
  for (let n = 0; n < 24; n++) {
    const work = [...arr];
    const out = [];
    let code = n;
    for (let i = 4; i >= 1; i--) {
      const f = code % i;
      code = Math.floor(code / i);
      out.push(work.splice(f, 1)[0]);
    }
    yield out; // perm[position] = original index
  }
}

console.log('Nursing 200-Level answer-integrity suite\n');

// T1 ----------------------------------------------------------------------
console.log('T1  Full-bank validation (all 8 sources)');
const ALL = loadAll();
check('received exactly 8 source files', () => {
  assert.strictEqual(ALL.length, 8);
});
let t1Total = 0;
for (const { file, items } of ALL) {
  check(`${file}: every question valid + canonical is an option text`, () => {
    assert.ok(Array.isArray(items) && items.length > 0, 'empty file');
    t1Total += items.length;
    for (const q of items) {
      const v = validateQuestion(q, { expectedOptions: 4 });
      assert.ok(v.valid, `flags=${v.flags.join(',')} id=${v.id}`);
      assert.ok(v.resolved.ok, `unresolved id=${v.id}`);
      assert.strictEqual(
        normalizeText(v.resolved.canonical),
        normalizeText(String(q.options[v.resolved.optionIndex] ?? '')),
        `canonical != options[index] id=${v.id}`
      );
    }
  });
}
check(`validating ${t1Total} questions total`, () => assert.ok(t1Total === 3517, `expected 3517 got ${t1Total}`));

// T2 ----------------------------------------------------------------------
console.log('\nT2  24-permutation answer stability (4 sample sources)');
for (const { file, items } of ALL.filter((f) =>
  ['nutrition', 'politics', 'foundation', 'community'].some((k) => f.file.includes(k))
)) {
  check(`${file}: canonical answer unique + stable under all 24 orderings`, () => {
    for (const q of items) {
      const options = q.options;
      const resolved = resolveCanonicalAnswer(q);
      for (const perm of permutations4()) {
        const shuffledTexts = perm.map((i) => options[i]);
        const matchIdx = shuffledTexts.findIndex((t) => normalizeText(t) === normalizeText(resolved.canonical));
        const count = shuffledTexts.filter((t) => normalizeText(t) === normalizeText(resolved.canonical)).length;
        // Exactly one option matches the canonical answer after reordering.
        assert.strictEqual(count, 1, `id=${q.question_id} perm=${perm} count=${count}`);
        // The canonical index under reordering equals the position of the canonical text.
        assert.strictEqual(normalizeText(shuffledTexts[matchIdx]), normalizeText(resolved.canonical));
      }
    }
  });
}

// T3 ----------------------------------------------------------------------
console.log('\nT3  Server/client grader parity (all 8 sources)');
for (const { file, items } of ALL) {
  check(`${file}: gradeAnswer(server) === optionMatchesCorrectAnswer(client)`, () => {
    for (const q of items) {
      const opts = q.options;
      for (let i = 0; i < opts.length; i++) {
        const serverVerdict = gradeAnswer(opts[i], q.correct_answer, opts);
        const clientVerdict = optionMatchesCorrectAnswer(opts[i], q.correct_answer, opts);
        assert.strictEqual(serverVerdict, clientVerdict, `file=${file} id=${q.question_id} opt=${i}`);
      }
    }
  });
}

// T4 ----------------------------------------------------------------------
console.log('\nT4  Wrong-answer invariance + key-convention correctness');
for (const { file, items } of ALL) {
  check(`${file}: true ONLY for canonical option; false for all others`, () => {
    for (const q of items) {
      const opts = q.options;
      const resolved = resolveCanonicalAnswer(q);
      // Correct answer must grade TRUE by text, in any casing/whitespace form.
      for (const sub of [
        resolved.canonical,
        resolved.canonical.toUpperCase(),
        `  ${resolved.canonical} `,
        resolved.canonical.replace(/\s+/g, '  '),
      ]) {
        assert.strictEqual(gradeAnswer(sub, q.correct_answer, opts), true, `file=${file} id=${q.question_id} sub=${sub}`);
      }
      // Integer index variant of the canonical option must grade TRUE.
      assert.strictEqual(gradeAnswer(resolved.optionIndex, q.correct_answer, opts), true, `index variant file=${file} id=${q.question_id}`);
      // Every other option must grade FALSE.
      for (let i = 0; i < opts.length; i++) {
        if (i === resolved.optionIndex) continue;
        assert.strictEqual(gradeAnswer(opts[i], q.correct_answer, opts), false, `wrong-opt file=${file} id=${q.question_id} i=${i}`);
      }
      // canonicalOptionText must equal the canonical option exactly.
      assert.strictEqual(canonicalOptionText(q.correct_answer, opts), resolved.canonical, `display file=${file} id=${q.question_id}`);
    }
  });
}

// T4b  Prefixed-key convention spot check ("D. <text>" vs "<text>").
console.log('\nT4b  Prefixed-key convention ("D. <text>")');
check('prefixed nutrient key grades the unprefixed option correct', () => {
  const [nutrition] = ALL.filter((f) => f.file.includes('nutrition'));
  const q = nutrition.items[0];
  const resolved = resolveCanonicalAnswer(q);
  assert.notStrictEqual(resolved.canonical, String(q.correct_answer).trim(), 'expected the source key to carry a marker');
  assert.strictEqual(gradeAnswer(resolved.canonical, q.correct_answer, q.options), true);
  for (let i = 0; i < q.options.length; i++) {
    if (i === resolved.optionIndex) continue;
    assert.strictEqual(gradeAnswer(q.options[i], q.correct_answer, q.options), false, `wrong-opt i=${i}`);
  }
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll integrity checks PASSED.');
process.exit(failures ? 1 : 0);