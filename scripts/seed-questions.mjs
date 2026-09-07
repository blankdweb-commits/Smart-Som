// ============================================================
// Question Bank Seeder — Migrates JSON banks to Supabase `questions` table
//
// Usage:
//   node scripts/seed-questions.mjs
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// Reads from src/data/flashcards/ JSON files and src/data/richardBank.js
// Idempotent: uses UPSERT (ON CONFLICT id DO UPDATE).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load .env ──────────────────────────────────────────────
const envVars = {};
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) envVars[m[1]] = m[2];
}

// ── Supabase admin client ──────────────────────────────────
const url = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

// ── JSON loaders ───────────────────────────────────────────
const loadJson = (relPath) => {
  const p = resolve(ROOT, relPath);
  return JSON.parse(readFileSync(p, 'utf-8'));
};

// ── Difficulty normalizer ──────────────────────────────────
const DIFFICULTY_LABELS = new Set(['Easy', 'Moderate', 'Hard', 'Expert']);
const realDifficulty = (raw, fallbackIdx) => {
  const d = raw?.difficulty;
  if (typeof d === 'string' && DIFFICULTY_LABELS.has(d)) return d;
  if (typeof d === 'string' && /easy/i.test(d)) return 'Easy';
  if (typeof d === 'string' && /medium|moderate|intermediate/i.test(d)) return 'Moderate';
  if (typeof d === 'string' && /hard|difficult/i.test(d)) return 'Hard';
  if (typeof d === 'string' && /expert|advanced/i.test(d)) return 'Expert';
  // Deterministic fallback: ~30% Easy, ~40% Moderate, ~30% Hard
  const m = fallbackIdx % 10;
  if (m < 3) return 'Easy';
  if (m < 7) return 'Moderate';
  return 'Hard';
};

// ── Answer resolver ────────────────────────────────────────
const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

const resolveCorrectAnswer = (q) => {
  // Case 1: correctAnswer already full text (fluid, uselu, nclex-rn-ngn)
  if (q.correctAnswer && typeof q.correctAnswer === 'string' && q.correctAnswer.length > 2) {
    return q.correctAnswer;
  }
  // Case 2: answer field (nclex-rn-ngn flashcard)
  if (q.answer && typeof q.answer === 'string') {
    return q.answer;
  }
  // Case 3: correct_answer is a letter (Richard/200-level midwifery)
  const raw = String(q.correct_answer || '').trim();
  const letterIdx = LETTER_TO_INDEX[raw.toUpperCase()];
  if (letterIdx != null && Array.isArray(q.options)) {
    return q.correct_answer_text || String(q.options[letterIdx]);
  }
  // Case 4: correct_answer is full text (200-level nursing)
  return raw || q.correct_answer_text || '';
};

// ── Normalizers per bank shape ─────────────────────────────

function normalizeRichardBank(raw, { prefix, source, courseId, examFramework }) {
  return raw.map((q, i) => ({
    id: `${prefix}-${typeof q.id !== 'undefined' ? q.id : i}`,
    course_id: courseId,
    subject_id: q.subject || source,
    topic_id: q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: 'mcq',
    exam_framework: examFramework,
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || q.clinical_application || null,
    hint: q.hints || q.simplification || null,
    source,
    metadata: {},
  }));
}

function normalizeFluidElectrolytes(raw) {
  return raw.map((q, i) => ({
    id: q.id || `fluid-elec-${i}`,
    course_id: 'nclex',
    subject_id: q.subject || 'Medical Surgical',
    topic_id: q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: 'mcq',
    exam_framework: 'NCLEX',
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || null,
    hint: q.hint || null,
    source: q.source || "Richard's Bank",
    metadata: { category: q.category },
  }));
}

function normalizeNclexRnNgn(raw) {
  return raw.map((q, i) => ({
    id: q.id || `nclex-idx-${i}`,
    course_id: 'nclex',
    subject_id: q.subject || 'NCLEX-RN',
    topic_id: q.topic || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: 'flashcard',
    exam_framework: 'NCLEX',
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || null,
    hint: q.hint || 'Think through the nursing priority and reasoning being tested.',
    source: 'NCLEX',
    metadata: {
      important: q.important || false,
      level: q.level,
      semester: q.semester,
    },
  }));
}

function normalizeNursing200(raw) {
  return raw.map((q, i) => ({
    id: `n200-${typeof q.question_id !== 'undefined' ? q.question_id : i}`,
    course_id: 'nursing200',
    subject_id: q.subject || 'Nursing 200-Level',
    topic_id: q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: q.question_type || 'mcq',
    exam_framework: null,
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || null,
    hint: q.hints || null,
    source: 'Nursing 200-Level',
    metadata: {},
  }));
}

function normalizeMidwifery(raw) {
  return raw.map((q, i) => ({
    id: `midw-${typeof q.id !== 'undefined' ? q.id : i}`,
    course_id: 'midwifery',
    subject_id: q.subject || 'Midwifery 200-Level',
    topic_id: q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: 'mcq',
    exam_framework: null,
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || q.clinical_application || null,
    hint: q.hints || q.simplification || null,
    source: 'Midwifery 200-Level',
    metadata: {},
  }));
}

function normalizeUselu(raw) {
  return raw.map((q, i) => ({
    id: q.id || `uselu-${i}`,
    course_id: 'uselu',
    subject_id: q.subject || 'Mental Health',
    topic_id: q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: 'mcq',
    exam_framework: q.category === 'NCLEX' ? 'NCLEX' : 'NMCN',
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || null,
    hint: q.hint || null,
    source: q.source || 'Uselu',
    metadata: { category: q.category },
  }));
}

// ── Load and normalize all banks ───────────────────────────
async function main() {
  console.log('📦 Loading question banks...\n');

  const banks = [];

  // NMCN Richard banks
  const pharm = loadJson('src/data/flashcards/nmcn/Phamarcology-Richard.json');
  banks.push(...normalizeRichardBank(pharm, {
    prefix: 'pharm', source: "Richard's Pharmacology",
    courseId: 'nmcn', examFramework: 'NMCN',
  }));

  const resp = loadJson('src/data/flashcards/nmcn/Respiration-richard.json');
  banks.push(...normalizeRichardBank(resp, {
    prefix: 'resp', source: "Richard's Respiration",
    courseId: 'nmcn', examFramework: 'NMCN',
  }));

  const msk = loadJson('src/data/flashcards/nmcn/muscleskeletal-Richard.json');
  banks.push(...normalizeRichardBank(msk, {
    prefix: 'msk', source: "Richard's Musculoskeletal",
    courseId: 'nmcn', examFramework: 'NMCN',
  }));

  const neuro = loadJson('src/data/flashcards/nmcn/Neurological-Nursing.json');
  banks.push(...normalizeRichardBank(neuro, {
    prefix: 'neuro', source: "Richard's Neurological",
    courseId: 'nmcn', examFramework: 'NMCN',
  }));

  // NCLEX banks
  const fluid = loadJson('src/data/flashcards/nmcn/fluid-electrolytes.json');
  banks.push(...normalizeFluidElectrolytes(fluid));

  const nclex = loadJson('src/data/flashcards/nclex/nclex-rn-ngn.json');
  banks.push(...normalizeNclexRnNgn(nclex));

  // 200-level banks
  const nursing200 = loadJson('src/data/flashcards/nmcn/200level questions.json');
  banks.push(...normalizeNursing200(nursing200));

  const midwifery = loadJson('src/data/flashcards/nmcn/200-level-midwifery.json');
  banks.push(...normalizeMidwifery(midwifery));

  // Uselu bank
  const uselu = loadJson('src/data/flashcards/nmcn/uselu-posting-tests.json');
  banks.push(...normalizeUselu(uselu));

  // ── Summary ──────────────────────────────────────────────
  const counts = {};
  for (const q of banks) {
    counts[q.course_id] = (counts[q.course_id] || 0) + 1;
  }
  console.log('📊 Question counts by course:');
  for (const [course, count] of Object.entries(counts)) {
    console.log(`   ${course}: ${count}`);
  }
  console.log(`   TOTAL: ${banks.length}\n`);

  // ── Upsert in batches ────────────────────────────────────
  const BATCH_SIZE = 100;
  let upserted = 0;

  for (let i = 0; i < banks.length; i += BATCH_SIZE) {
    const batch = banks.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('questions')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
      // Try one-by-one to identify problematic rows
      for (const q of batch) {
        const { error: singleErr } = await supabase
          .from('questions')
          .upsert(q, { onConflict: 'id', ignoreDuplicates: false });
        if (singleErr) {
          console.error(`   ❌ ${q.id}: ${singleErr.message}`);
        } else {
          upserted++;
        }
      }
    } else {
      upserted += batch.length;
      process.stdout.write(`\r   Upserted ${upserted}/${banks.length}...`);
    }
  }

  console.log(`\n\n✅ Done. Upserted ${upserted} questions into the questions table.\n`);

  // ── Verify counts ────────────────────────────────────────
  const { count, error: countErr } = await supabase
    .from('questions')
    .select('*', { count: 'exact', head: true });

  if (!countErr) {
    console.log(`📊 Database now contains ${count} total questions.`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
