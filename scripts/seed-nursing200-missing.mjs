// ============================================================
// Seed missing nursing-200 subjects into the DB `questions` table.
// The 2 "phantom" subjects (Nutrition & Dietetics, Politics and
// Governance in Nursing) have question data in the client bank
// file (`200level questions.json`) but were never migrated to the
// DB. This script migrates ONLY those rows using the same normalizer
// as seed-questions.mjs (id/answer/difficulty normalization) so the
// server-authoritative quiz engine can serve them.
// Idempotent: fixed id prefixes + upsert on id.
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const envVars = {};
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) envVars[m[1]] = m[2];
}
const url = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL;
const key = envVars.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(url, key);

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

// Map the full set of related file subject labels onto the two UI subjects.
// Nutrition & Dietetics: the "Nutrition and Dietetics" unit + its 3 sub-units.
// Politics and Governance in Nursing: main unit + 3 politics sub-topics.
const NUTRITION = new Set(['Nutrition and Dietetics', 'Unit I: Introduction to Nutrition', 'Unit II: Nutritional Needs', 'Unit III: Food Planning, Preparation, and Safety']);
const POLITICS = new Set(['Politics and Governance in Nursing', 'Concept of Politics and Government', 'Political Activities', 'Political Interaction']);

const bank = JSON.parse(readFileSync(resolve(ROOT, 'src/data/flashcards/nmcn/200level questions.json'), 'utf8'));

const rows = [];
for (const q of bank) {
  let subject = null;
  if (NUTRITION.has(q.subject)) subject = 'Nutrition & Dietetics';
  else if (POLITICS.has(q.subject)) subject = 'Politics and Governance in Nursing';
  if (!subject) continue;

  const origId = q.question_id ?? q.id ?? null;
  const id = origId != null ? `n200x-${subject === 'Nutrition & Dietetics' ? 'nut' : 'pol'}-${origId}` : null;
  if (!id) continue;

  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length < 2) continue;

  rows.push({
    id,
    course_id: 'nursing200',
    subject_id: subject,
    topic_id: q.topic || q.subject || null,
    subtopic_id: null,
    concept_id: null,
    difficulty: realDifficulty(q, origId ?? rows.length),
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
const bySub = {};
for (const r of rows) bySub[r.subject_id] = (bySub[r.subject_id] || 0) + 1;
for (const k of Object.keys(bySub).sort()) console.log('  ', k, bySub[k]);

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