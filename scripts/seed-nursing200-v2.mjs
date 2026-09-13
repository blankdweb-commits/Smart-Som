// ============================================================
// Nursing 200-Level question-bank seed (AUTHORITATIVE, v2).
//
// Seeds the 8 approved source files from the upload folder into the Supabase
// `questions` table under course_id='nursing200' with stable, namespaced ids:
//
//     n200v2-<slug>-<question_id>
//
// slug map:  chn  community health nursing i
//            fon  foundation of nursing iv        -> "Fundamentals of Nursing"
//            ms   medical-surgical nursing
//            nut  nutrition and dietetics         -> "Nutrition & Dietetics" (all units)
//            ph3  pharmacology iii
//            pol  politics and governance         -> "Politics and Governance in Nursing" (all subtopics)
//            rh   reproductive health
//            rm   research methodology
//
// BEHAVIOUR
//   - Canonical answer representation (scripts/nursing200Normalizer.mjs) is the
//     ONLY layer allowed to touch answers: correct_answer is stored as the EXACT
//     trimmed text of one of the row's own options. Letter keys and "D. <text>"
//     prefixed keys are resolved deterministically; the source data is never
//     modified and no answer is ever guessed.
//   - INVALID/UNRESOLVED/AMBIGUOUS rows are skipped, counted and reported. They
//     are NEVER inserted.
//   - Idempotent: upsert on id; safe to re-run.
//   - Legacy rows: after a successful seed, legacy nursing200 rows whose subject
//     is covered by this bank (all except Professional Writing and Seminar) are
//     deactivated (is_active=false, reversible) and reported. Pass
//     `--keep-legacy` to skip deactivation.
//
// Usage:  node scripts/seed-nursing200-v2.mjs [--keep-legacy]
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.
// ============================================================

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { validateQuestion, toDbRow } from './nursing200Normalizer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_DIR = resolve(ROOT, 'drive-download-20260913T080309Z-1-001');

const envVars = {};
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) envVars[m[1]] = m[2];
}
const SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL;
if (!SERVICE_KEY || !SUPABASE_URL) {
  console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const KEEP_LEGACY = process.argv.includes('--keep-legacy');

// subject_id column value for each source (UI subject names, exact match).
const SOURCES = [
  { file: 'community_health_nursing_i_questions_fixed.json', slug: 'chn', subjectId: 'Community Health Nursing I' },
  { file: 'foundation_of_nursing_iv_questions_fixed.json', slug: 'fon', subjectId: 'Fundamentals of Nursing' },
  { file: 'medical_surgical_nursing_questions_fixed.json', slug: 'ms', subjectId: 'Medical-Surgical Nursing' },
  { file: 'nutrition_and_dietetics_questions.json', slug: 'nut', subjectId: 'Nutrition & Dietetics' },
  { file: 'pharmacology_iii_final_qbank.json', slug: 'ph3', subjectId: 'Pharmacology III' },
  { file: 'politics_and_governance_in_nursing_questions.json', slug: 'pol', subjectId: 'Politics and Governance in Nursing' },
  { file: 'reproductive_health_questions_final.json', slug: 'rh', subjectId: 'Reproductive Health' },
  { file: 'research_methodology_questions_fixed.json', slug: 'rm', subjectId: 'Research Methodology' },
];

// Legacy nursing200 rows deactivated after a successful seed — every subject
// covered by the v2 bank. Professional Writing and Seminar is intentionally
// EXCLUDED (no replacement file exists for it).
const SUBJECTS_COVERED = SOURCES.map((s) => s.subjectId);

const seenIds = new Set();
let totalInserted = 0;
let totalSkipped = 0;
const skippedRows = [];

async function seedFile({ file, slug, subjectId }) {
  const raw = JSON.parse(readFileSync(resolve(SOURCE_DIR, file), 'utf8'));
  const items = Array.isArray(raw) ? raw : raw.questions || raw.items || [];
  const inserted = [];
  let skipped = 0;

  for (const q of items) {
    const v = validateQuestion(q, { expectedOptions: 4 });
    if (!v.valid) {
      skipped++;
      skippedRows.push({ file, id: v.id, flags: v.flags.join(','), subject: v.subject });
      continue;
    }
    const row = toDbRow({ ...q, subject: subjectId }, {
      subjectId,
      idPrefix: `n200v2-${slug}`,
      source: `Nursing 200-Level (v2) - ${slug}`,
    });
    if (!row) {
      skipped++;
      skippedRows.push({ file, id: v.id, flags: 'RESOLVE_FAILED', subject: v.subject });
      continue;
    }
    if (seenIds.has(row.id)) {
      // Duplicate normalized id within/across files: suffix deterministically.
      row.id = `${row.id}-d`;
      if (seenIds.has(row.id)) row.id = `${row.id}${seenIds.size}`;
    }
    seenIds.add(row.id);
    inserted.push(row);
  }

  const { error } = await supabase.from('questions').upsert(inserted, { onConflict: 'id' });
  if (error) throw new Error(`upsert failed for ${file}: ${error.message}`);

  totalInserted += inserted.length;
  totalSkipped += skipped;
  console.log(`${file.padEnd(48)} ${String(inserted.length).padStart(4)} inserted  ${String(skipped).padStart(4)} skipped  (subject_id: ${subjectId})`);
}

async function deactivateLegacy() {
  const { data: existing, error: selErr } = await supabase
    .from('questions')
    .select('id')
    .eq('course_id', 'nursing200')
    .in('subject_id', SUBJECTS_COVERED)
    .eq('is_active', true)
    .not('id', 'like', 'n200v2-%');
  if (selErr) throw new Error(`legacy select failed: ${selErr.message}`);

  if (!existing.length) {
    console.log('No active legacy nursing200 rows to deactivate (subjects covered by v2 bank).');
    return;
  }

  const { error } = await supabase
    .from('questions')
    .update({ is_active: false })
    .eq('course_id', 'nursing200')
    .in('subject_id', SUBJECTS_COVERED)
    .eq('is_active', true)
    .not('id', 'like', 'n200v2-%');
  if (error) throw new Error(`legacy deactivation failed: ${error.message}`);

  console.log(`Legacy deactivated: ${existing.length} nursing200 rows (is_active=false) for subjects covered by v2 bank.`);
}

async function main() {
  console.log('Seeding Nursing 200-Level (v2) from 8 source files...');
  console.log('Canonical answers are resolved against each question\'s own options; invalid rows are never inserted.\n');

  for (const src of SOURCES) {
    await seedFile(src);
  }

  console.log(`\nInserted ${totalInserted}, skipped ${totalSkipped} across ${SOURCES.length} sources.`);

  if (skippedRows.length) {
    console.log('\nSkipped rows (never inserted — verifier: see verification/nursing200-audit.json):');
    for (const s of skippedRows.slice(0, 20)) {
      console.log(`  ${s.file}  id=${s.id}  [${s.flags}]  ${s.subject}`);
    }
    if (skippedRows.length > 20) console.log(`  ... +${skippedRows.length - 20} more`);
  }

  if (!KEEP_LEGACY) {
    console.log('\nDeactivating legacy nursing200 rows...');
    await deactivateLegacy();
  } else {
    console.log('\n--keep-legacy: legacy rows left active.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nSEED FAILED:', err.message);
  process.exit(1);
});