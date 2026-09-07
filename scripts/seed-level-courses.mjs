// ============================================================
// Level (200/300) Course Seeder — Migrates the dedicated NMCN
// level banks into the Supabase `questions` table.
//
// Banks seeded (as three separate per-subject courses):
//   300 Level Nursing.json            -> course_id 'nursing300'     (nursing-300)
//   300 level midwifery.json          -> course_id 'midwifery300'   (midwifery-300)
//   200-level-midwifery second semester.json -> course_id 'midwifery200s2' (midwifery-200-s2)
//
// Usage:
//   node scripts/seed-level-courses.mjs
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
// Idempotent: uses UPSERT (ON CONFLICT id DO UPDATE).
// Some banks reuse question_id across rows, so ids get a dedupe suffix.
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

// ── Difficulty normalizer (mirrors seed-questions.mjs) ─────
const DIFFICULTY_LABELS = new Set(['Easy', 'Moderate', 'Hard', 'Expert']);
const realDifficulty = (raw, fallbackIdx) => {
  const d = raw?.difficulty;
  if (typeof d === 'string' && DIFFICULTY_LABELS.has(d)) return d;
  if (typeof d === 'string' && /easy/i.test(d)) return 'Easy';
  if (typeof d === 'string' && /medium|moderate|intermediate/i.test(d)) return 'Moderate';
  if (typeof d === 'string' && /hard|difficult/i.test(d)) return 'Hard';
  if (typeof d === 'string' && /expert|advanced/i.test(d)) return 'Expert';
  const m = fallbackIdx % 10;
  if (m < 3) return 'Easy';
  if (m < 7) return 'Moderate';
  return 'Hard';
};

// ── Answer resolver (mirrors seed-questions.mjs) ───────────
const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

const resolveCorrectAnswer = (q) => {
  if (q.correctAnswer && typeof q.correctAnswer === 'string' && q.correctAnswer.length > 2) {
    return q.correctAnswer;
  }
  if (q.answer && typeof q.answer === 'string') {
    return q.answer;
  }
  const raw = String(q.correct_answer || '').trim();
  const letterIdx = LETTER_TO_INDEX[raw.toUpperCase()];
  if (letterIdx != null && Array.isArray(q.options)) {
    return String(q.options[letterIdx]);
  }
  return raw || q.correct_answer_text || '';
};

// ── Unique id generator (handles reused question_ids) ──────
const makeIdMaker = (prefix) => {
  const seen = new Set();
  return (q, idx) => {
    const base = typeof q.question_id !== 'undefined' && q.question_id !== null
      ? String(q.question_id)
      : `idx-${idx}`;
    let candidate = `${prefix}-${base}`;
    let counter = 1;
    while (seen.has(candidate)) {
      candidate = `${prefix}-${base}-${counter}`;
      counter += 1;
    }
    seen.add(candidate);
    return candidate;
  };
};

// ── Banks ──────────────────────────────────────────────────
const BANKS = [
  {
    file: 'src/data/flashcards/nmcn/300 Level Nursing.json',
    prefix: 'n300',
    courseId: 'nursing300',
    source: 'Nursing 300-Level',
  },
  {
    file: 'src/data/flashcards/nmcn/300 level midwifery.json',
    prefix: 'm300',
    courseId: 'midwifery300',
    source: 'Midwifery 300-Level',
  },
  {
    file: 'src/data/flashcards/nmcn/200-level-midwifery second semester.json',
    prefix: 'm200s2',
    courseId: 'midwifery200s2',
    source: 'Midwifery 200-Level (2nd Semester)',
  },
];

function normalizeBank(raw, { prefix, courseId, source }) {
  const makeId = makeIdMaker(prefix);
  return raw.map((q, i) => ({
    id: makeId(q, i),
    course_id: courseId,
    subject_id: q.subject || source,
    topic_id: q.topic || q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, i),
    question_type: q.question_type || 'mcq',
    exam_framework: 'NMCN',
    question_text: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || q.clinical_application || null,
    hint: q.hint || q.simplification || null,
    source,
    metadata: {},
    is_active: true,
  }));
}

async function main() {
  console.log('📦 Loading level question banks...\n');

  const banks = [];
  for (const b of BANKS) {
    const raw = loadJson(b.file);
    const normalized = normalizeBank(raw, b);
    banks.push(...normalized);
    const subjectCounts = {};
    const diffCounts = {};
    for (const q of normalized) {
      subjectCounts[q.subject_id] = (subjectCounts[q.subject_id] || 0) + 1;
      diffCounts[q.difficulty] = (diffCounts[q.difficulty] || 0) + 1;
    }
    console.log(`   ${b.courseId} (${b.source}): ${normalized.length} questions`);
    console.log(`      difficulty -> ${Object.entries(diffCounts).map(([d, n]) => `${d}:${n}`).join(', ')}`);
    console.log(`      subjects   -> ${Object.entries(subjectCounts).map(([s, n]) => `${s} (${n})`).join(', ')}\n`);
  }

  console.log(`   TOTAL: ${banks.length}\n`);

  const BATCH_SIZE = 100;
  let upserted = 0;

  for (let i = 0; i < banks.length; i += BATCH_SIZE) {
    const batch = banks.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('questions')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });

    if (error) {
      console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
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

  console.log('\n\n✅ Done. Upserted ' + upserted + ' level questions.\n');

  const { data, error } = await supabase
    .from('questions')
    .select('course_id, difficulty')
    .in('course_id', ['nursing300', 'midwifery300', 'midwifery200s2'])
    .eq('is_active', true);

  if (!error && data) {
    const counts = {};
    for (const q of data) {
      counts[q.course_id] = (counts[q.course_id] || 0) + 1;
    }
    console.log('📊 Live counts (active) by course:');
    for (const [course, count] of Object.entries(counts)) {
      console.log(`   ${course}: ${count}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});