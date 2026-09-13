# Nursing 200-Level — Answer-Integrity & Bank Structure Report

Date: 2026-09-13
Deliverable: POLYNURSE 200-LEVEL ANSWER-INTEGRITY + AUTHORITATIVE BANK v2

## 1. Reported problem
Users select a factually correct 200-level answer but PolyNurse marks it wrong
("correct answer selected shown as incorrect").
Regression risk: also affects red-flag "wrong" highlight, reviews, and scoring
integrity (score ≠ accuracy).

## 2. Root cause (proven, data-level)
The question sources store the answer key in two formats:
- exact option text (`correct_answer === an option`), and
- **prefixed marker text**: `correct_answer = "D. <text>"` while the option is
  just `"<text>"` (Nutrition & Dietetics and Politics sources — the live legacy
  bank contained **532** such rows).

The ingestion normalizers (`scripts/seed-questions.mjs`,
`scripts/seed-nursing200-missing.mjs`, `src/data/richardBank.js`) kept the raw
prefixed text in `correct_answer`. Because **client and server both graded by
exact normalized string equality** (`opt === q.correctAnswer` client-side;
`normalize(submitted) === normalize(stored_key)` server-side), a user picking the
correct unprefixed option text could never equal the stored prefixed key →
graded **wrong**. Diagnosed at the "DATA vs NORMALIZATION vs SHUFFLING vs
SCORING" level: scoring is positional-independent (text-based) and shuffle-safe;
the defect is purely the answer-key representation crossing the ingestion
boundary. No medical answer was changed.

## 3. Data audit (read-only, `scripts/audit-nursing200-sources.mjs`)
Artifact: `verification/nursing200-audit.json`
- 8 source files, **3,517 questions** total.
- All questions: 4 options, unique `question_id`, no duplicate option text.
- Answer-key formats: 6 files `TEXT-EXACT`, 2 files `TEXT-PREFIXED`
  (`nutrition_and_dietetics_questions.json` 280, `politics_..._questions.json` 252).
- **0 questions** failed validation; every key resolves to exactly one option
  after deterministic prefix-normalization. No sourcing errors, no guesses needed.

## 4. Canonical answer representation
`scripts/nursing200Normalizer.mjs` — the ONLY layer allowed to touch answers.
- `correct_answer` is always stored as the **exact trimmed text of one of the
  row's own options**.
- Letter keys (`A..E`) → option index → option text; prefixed text (`"D. <text>"`)
  → marker-strip → option text; zero/2+ matches → flagged `UNRESOLVED`/`AMBIGUOUS`
  and never inserted. Deterministic only — no fuzzy matching.

## 5. Scoring-layer hardening (the user-facing fix)
- Server: `api/_answerMatch.js` + `api/_questionSelectionService.js`
  `_gradeAnswer` — resolves the stored key against the question's OWN options
  before scoring (text, ragged case/whitespace, and integer-index submissions).
  Correctness can no longer depend on where the key text was written.
- Client: `src/utils/answerMatch.js` mirrors the identical deterministic logic so
  the on-screen highlight, instant feedback, and session review agree with the
  authoritative server decision (perfect parity is tested).
- `src/components/QuizPlayer.jsx` and `src/pages/Quiz.jsx` review now display the
  canonical **option text** (the thing the user actually sees), not the stored key.
- `src/data/richardBank.js` full-text answers now resolve through the same
  canonical path, purifying all client pools (DailyChallenge, WeaknessDrill,
  flashcard deck data).

## 6. Bank structure — 8 sources become the 200-level bank
- Seeder: `scripts/seed-nursing200-v2.mjs` (idempotent upsert on
  `n200v2-<slug>-<question_id>`; `slug` = chn/fon/ms/nut/ph3/pol/rh/rm).
- Inserted **3,517** rows (0 invalid skipped), `course_id='nursing200'`.
- Source → `subject_id` map:
  - community → `Community Health Nursing I` (392) [NEW subject in UI]
  - foundation → `Fundamentals of Nursing` (715)
  - medical-surgical → `Medical-Surgical Nursing` (360)
  - nutrition → `Nutrition & Dietetics` (280; units consolidated)
  - pharmacology → `Pharmacology III` (618)
  - politics → `Politics and Governance in Nursing` (252; subtopics consolidated)
  - reproductive → `Reproductive Health` (550)
  - research → `Research Methodology` (350)
- **Legacy rows deactivated** (`is_active=false`, reversible, no deletion):
  1,000 legacy nursing200 rows for the 7 subjects covered by v2 (Fundamentals 97,
  Pharmacology III 68, Reproductive 200, Research 350, Nutrition 600, Politics 432,
  Medical-Surgical 360 — of those active at seed time).
  Professional Writing and Seminar (**150**) intentionally left active (no
  v2 replacement file exists). Live counts verified per subject.
- UI: `src/components/QuizSetupFlow.jsx` selectable Nursing-200 subjects now
  includes `Community Health Nursing I` (+bankNote "9 core subjects"); server and
  deep-link subject filters already accept it.

## 7. Integrity test results (offline, no DB needed)
`verification/nursing200-integrity.spec.mjs` — 23/23 PASS:
- T1 full-bank validation (3,517 questions; canonical always an option text),
- T2 24-permutation option-reorder stability (canonical answer unique and stable
  under every ordering of 4 options),
- T3 server/client grader parity for every (question, option) pair,
- T4 wrong-answer invariance + prefixed-key correctness (correct grades TRUE in
  any casing/whitespace; every other option FALSE; index submissions TRUE only
  for the canonical option).

## 8. Verification status
- `node --check` on all new/edited server + script files: PASS.
- `npm run lint`: **0 errors on changed files** (2 pre-existing `react-hooks/purity`
  warnings in Quiz.jsx/QuizSetupFlow.jsx are baseline).
  NOTE: the default `stylish` formatter is broken in THIS sandbox because
  `node_modules/chalk` is a corrupted install (`main: "source"`); lint was run via
  `--format json`. This is environmental, not a repo defect.
- `npm run build`: OK. (`flashcard-data` 4.2 MB chunk warning is pre-existing.)
- Live DB check after seed: 3,517 `n200v2-*` rows; per-subject active counts match
  each source file exactly; legacy rows inactive; sample nutrition row verified
  `correct_answer` === one of its own options.

## 9. Deploy / follow-up steps for the dev box
1. Commit (after explicit go-ahead) and redeploy Vercel (12 functions unchanged).
2. QA: Nursing-200 → Nutrition & Dietetics and Politics and Governance rounds:
   picking the correct option must grade ✓, wrong option must grade ✗, and the
   one-look + exam review must show the exact option text.
3. QA: Community Health Nursing I and Medical-Surgical Nursing tiles now launch
   rounds (previously phantom).
4. Optional: re-run `node scripts/seed-nursing200-v2.mjs --keep-legacy` to restore
   legacy rows active if ever needed (the grader handles their prefixed keys
   deterministically).