// ============================================================
// Seed the restored nursing-200 course "Professional Writing and
// Seminar" into the DB `questions` table.
//
// The product catalogue (Phase 14) restores three nursing-200
// courses. Nutrition & Dietetics and Politics and Governance in
// Nursing were seeded earlier (scripts/seed-nursing200-missing.mjs);
// this script completes the set from the same authoritative client
// bank file. Uses the same normalizer (id/difficulty/answer) as
// seed-questions.mjs so the server-authoritative quiz engine can
// serve it.
//
// Idempotent: fixed id prefix `n200x-pws-` + upsert on id.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const envVars = {};
if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[2]) envVars[m[1]] = m[2];
  }
}
const url = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL;
const key = envVars.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(url, key);

const SOURCE_SUBJECT = 'Professional Writing and Seminar in Nursing';
const TARGET_SUBJECT = 'Professional Writing and Seminar'; // UI subject_id (nursing-200 resolves suffix directly)

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

const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const resolveCorrectAnswer = (q) => {
  if (q.correctAnswer && typeof q.correctAnswer === 'string' && q.correctAnswer.length > 2) return q.correctAnswer;
  if (q.answer && typeof q.answer === 'string') return q.answer;
  const raw = String(q.correct_answer || '').trim();
  const letterIdx = LETTER_TO_INDEX[raw.toUpperCase()];
  if (letterIdx != null && Array.isArray(q.options)) {
    return q.correct_answer_text || String(q.options[letterIdx]);
  }
  return raw || q.correct_answer_text || '';
};

const bank = JSON.parse(
  readFileSync(resolve(ROOT, 'src/data/flashcards/nmcn/200level questions.json'), 'utf8')
);

const rows = [];
const seenIds = new Set();
for (const q of bank) {
  if (String(q.subject || '') !== SOURCE_SUBJECT) continue;

  const origId = q.question_id ?? q.id ?? null;
  if (origId == null) continue;
  const id = `n200x-pws-${origId}`;
  if (seenIds.has(id)) continue;
  seenIds.add(id);

  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length < 2) continue;

  rows.push({
    id,
    course_id: 'nursing200',
    subject_id: TARGET_SUBJECT,
    topic_id: q.topic || q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, origId),
    question_type: q.question_type || 'mcq',
    exam_framework: null,
    question_text: q.question || '',
    options,
    correct_answer: resolveCorrectAnswer(q),
    explanation: q.rationale || q.explanation || null,
    hint: q.hints || q.hint || null,
    source: 'Nursing 200-Level',
    is_active: true,
    metadata: {},
  });
}

console.log('prepared rows:', rows.length);

const BATCH = 100;
let upserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await supabase.from('questions').upsert(batch, { onConflict: 'id', ignoreDuplicates: false });
  if (error) {
    console.error('batch failed at', i, error.message);
    for (const r of batch) {
      const { error: e2 } = await supabase.from('questions').upsert(r, { onConflict: 'id', ignoreDuplicates: false });
      if (e2) console.error('   row', r.id, e2.message);
      else upserted++;
    }
  } else {
    upserted += batch.length;
  }
}
console.log('done. upserted', upserted, 'of', rows.length);
process.exit(0);