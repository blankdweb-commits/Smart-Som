// ============================================================
// Seed public.blitz_duel_questions from the three authoritative
// 1v1 question banks in src/data/flashcards/1v1-questions/.
//
//   Foundation_Tournament_Pool_500.json   (500)
//   medsurg_tournament_500.json           (500)
//   anat_bank_FINAL_1000_all_hard.json    (1000)
//
// This is the ONLY writer of the blitz bank. It uses the service
// role, so it must never run in a browser and the key must never
// be shipped to the client.
//
// DESIGN
//   * id + content_hash are a SHA-256 of the normalised stem and
//     the four trimmed, lower-cased options. Identical content
//     collapses to one row across all three files.
//   * Rows are content-addressed, so a re-run inserts nothing new
//     and a question edited in the source produces a new id.
//   * After upserting, any row in the table whose id is not in the
//     current files is deleted, so the table mirrors the files.
//   * Every malformed row is REJECTED with a reason and never
//     written, rather than being silently coerced.
//
// Usage:  node scripts/seed-blitz-duel-questions.mjs
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BANK_DIR = resolve(ROOT, 'src/data/flashcards/1v1-questions');

const envVars = {};
if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[2]) envVars[m[1]] = m[2];
  }
}
const url = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL;
const serviceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
}
const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OPT_KEYS = ['A', 'B', 'C', 'D'];
const TABLE = 'blitz_duel_questions';

// ------------------------------------------------------------
// Normalisers
// ------------------------------------------------------------

const normalizeDifficulty = (raw) => {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === 'easy') return 'Easy';
  if (s === 'moderate' || s === 'medium' || s === 'intermediate') return 'Moderate';
  if (s === 'hard' || s === 'difficult') return 'Hard';
  if (s === 'expert' || s === 'advanced') return 'Expert';
  return null;
};

const normalizeOptions = (o) => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const k of OPT_KEYS) {
    const v = o[k];
    if (typeof v !== 'string' || !v.trim()) return null;
    out[k] = v.trim();
  }
  return out;
};

// Turn "C", "C)", "C. text", or the full option text into a letter.
const toLetter = (raw, opts) => {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (OPT_KEYS.includes(s)) return s;
  const prefix = s.slice(0, 1).toUpperCase();
  if (OPT_KEYS.includes(prefix) && [')', '.', ' ', ':', '-'].includes(s[1])) return prefix;
  const lower = s.toLowerCase();
  for (const k of OPT_KEYS) {
    if (opts[k].toLowerCase() === lower) return k;
  }
  return null;
};

const normalizeExplanation = (raw) => {
  if (Array.isArray(raw)) {
    const items = raw.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    return items.length ? items : null;
  }
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return null;
};

const contentHash = (stem, opts) =>
  createHash('sha256')
    .update(
      stem.trim().toLowerCase() +
        '|' +
        OPT_KEYS.map((k) => opts[k].trim().toLowerCase()).join('|')
    )
    .digest('hex');

// ------------------------------------------------------------
// Build rows
// ------------------------------------------------------------

const prepared = [];
const rejected = [];
const byId = new Map();

function addRow(file, idx, { stem, rawOptions, correctRaw, explanation, subject, topic, difficulty, cognitive, category, source }) {
  const why = [];
  if (typeof stem !== 'string' || stem.trim().length < 8) why.push('STEM_TOO_SHORT');
  const opts = normalizeOptions(rawOptions);
  if (!opts) why.push('BAD_OPTIONS');
  const letter = opts ? toLetter(correctRaw, opts) : null;
  if (!letter) why.push('UNRESOLVED_CORRECT');
  const diff = normalizeDifficulty(difficulty);
  if (!diff) why.push('BAD_DIFFICULTY');
  if (!subject || !String(subject).trim()) why.push('NO_SUBJECT');
  if (!topic || !String(topic).trim()) why.push('NO_TOPIC');

  if (why.length) {
    rejected.push({ file, idx, source, reasons: why });
    return;
  }

  const clean = stem.trim();
  const id = contentHash(clean, opts);
  if (byId.has(id)) {
    rejected.push({ file, idx, source, reasons: ['DUPLICATE_OF:' + byId.get(id)] });
    return;
  }

  const row = {
    id,
    content_hash: id,
    question_text: clean,
    options: opts,
    correct_answer: letter,
    explanation: normalizeExplanation(explanation),
    subject: String(subject).trim(),
    topic: String(topic).trim(),
    difficulty: diff,
    cognitive_level: cognitive ? String(cognitive).trim() : null,
    category: category ? String(category).trim() : null,
    source,
  };
  byId.set(id, file + '#' + idx);
  prepared.push(row);
}

// Foundation: { question, options{A..D}, correct "C", explanation[], subject, topic, difficulty, cognitive_level, category }
{
  const file = 'Foundation_Tournament_Pool_500.json';
  const j = JSON.parse(readFileSync(resolve(BANK_DIR, file), 'utf8'));
  const list = Array.isArray(j) ? j : j.questions;
  list.forEach((q, i) =>
    addRow(file, i, {
      stem: q.question,
      rawOptions: q.options,
      correctRaw: q.correct ?? q.correct_text,
      explanation: q.explanation,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      cognitive: q.cognitive_level,
      category: q.category,
      source: file,
    })
  );
}

// Medsurg: { stem, options{A..D}, correct "C) full text", rationale[], tag "S · T · Hard · Cognitive · Category" }
{
  const file = 'medsurg_tournament_500.json';
  const j = JSON.parse(readFileSync(resolve(BANK_DIR, file), 'utf8'));
  const list = Array.isArray(j) ? j : j.questions;
  list.forEach((q, i) => {
    const parts = String(q.tag || '')
      .split('·')
      .map((s) => s.trim());
    addRow(file, i, {
      stem: q.stem,
      rawOptions: q.options,
      correctRaw: q.correct,
      explanation: q.rationale,
      subject: parts[0],
      topic: parts[1],
      difficulty: parts[2],
      cognitive: parts[3],
      category: parts[4],
      source: file,
    });
  });
}

// Anatomy: { question, options{A..D}, correct_answer "full text", rationale[], course, topic, difficulty "hard", cognitive_level, tested_concept }
{
  const file = 'anat_bank_FINAL_1000_all_hard.json';
  const j = JSON.parse(readFileSync(resolve(BANK_DIR, file), 'utf8'));
  const list = Array.isArray(j) ? j : j.questions;
  list.forEach((q, i) =>
    addRow(file, i, {
      stem: q.question,
      rawOptions: q.options,
      correctRaw: q.correct_answer,
      explanation: q.rationale,
      subject: q.course,
      topic: q.topic,
      difficulty: q.difficulty,
      cognitive: q.cognitive_level,
      category: null,
      source: file,
    })
  );
}

// ------------------------------------------------------------
// Diff against the table
// ------------------------------------------------------------

async function fetchExisting() {
  const map = new Map();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(TABLE)
      .select(
        'id,content_hash,question_text,options,correct_answer,explanation,subject,topic,difficulty,cognitive_level,category,source'
      )
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error('select failed: ' + error.message);
    for (const r of data || []) map.set(r.id, r);
    if (!data || data.length < page) break;
  }
  return map;
}

const signature = (r) =>
  JSON.stringify([
    r.question_text,
    OPT_KEYS.map((k) => (r.options ? r.options[k] : undefined)),
    r.correct_answer,
    r.explanation,
    r.subject,
    r.topic,
    r.difficulty,
    r.cognitive_level,
    r.category,
  ]);

async function chunkedUpsert(rows, label) {
  const BATCH = 250;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(TABLE).upsert(batch, { onConflict: 'id' });
    if (error) {
      // Retry row-by-row so one bad row cannot hide the rest.
      for (const r of batch) {
        const { error: e2 } = await supabase.from(TABLE).upsert(r, { onConflict: 'id' });
        if (e2) {
          rejected.push({ file: label, idx: -1, source: r.source, reasons: ['WRITE_FAILED:' + e2.message] });
          prepared.splice(prepared.indexOf(r), 1);
        } else written++;
      }
    } else {
      written += batch.length;
    }
  }
  return written;
}

const existing = await fetchExisting();
const toInsert = prepared.filter((r) => !existing.has(r.id));
const toUpdate = prepared.filter((r) => existing.has(r.id) && signature(existing.get(r.id)) !== signature(r));
const skipped = prepared.length - toInsert.length - toUpdate.length;
const staleIds = [...existing.keys()].filter((id) => !byId.has(id));

console.log('----------------------------------------------------------');
console.log('Blitz Duel question bank seed');
console.log('----------------------------------------------------------');
console.log(`parsed/valid  : ${prepared.length}`);
console.log(`rejected      : ${rejected.length}`);
console.log(`in DB before  : ${existing.size}`);
console.log(`  -> insert   : ${toInsert.length}`);
console.log(`  -> update   : ${toUpdate.length}`);
console.log(`  -> skip     : ${skipped}`);
console.log(`stale in DB   : ${staleIds.length}`);

let inserted = 0;
let updated = 0;

if (toUpdate.length) {
  const stamped = toUpdate.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  updated = await chunkedUpsert(stamped, 'update');
}
if (toInsert.length) {
  inserted = await chunkedUpsert(toInsert, 'insert');
}

let removed = 0;
if (staleIds.length) {
  const BATCH = 200;
  for (let i = 0; i < staleIds.length; i += BATCH) {
    const batch = staleIds.slice(i, i + BATCH);
    const { error } = await supabase.from(TABLE).delete().in('id', batch);
    if (error) {
      rejected.push({ file: 'stale-delete', idx: -1, source: null, reasons: ['DELETE_FAILED:' + error.message] });
    } else {
      removed += batch.length;
    }
  }
}

console.log('----------------------------------------------------------');
console.log(`RESULT: inserted ${inserted} · updated ${updated} · skipped ${skipped} · removed ${removed} · rejected ${rejected.length}`);
if (rejected.length) {
  console.log('----------------------------------------------------------');
  console.log('Rejected rows:');
  for (const r of rejected.slice(0, 50)) {
    console.log(`  ${r.file}#${r.idx} [${r.source || '-'}] ${r.reasons.join(', ')}`);
  }
  if (rejected.length > 50) console.log(`  ...and ${rejected.length - 50} more`);
}

const { count, error: cErr } = await supabase.from(TABLE).select('id', { count: 'exact', head: true });
console.log('----------------------------------------------------------');
console.log('final row count:', cErr ? 'unknown (' + cErr.message + ')' : count);
process.exit(rejected.length ? 1 : 0);
