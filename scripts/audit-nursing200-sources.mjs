// ============================================================
// Nursing 200-Level question-source schema audit (DIAGNOSTIC ONLY).
//
// POLYNURSE spec §2/§3/§4/§22: audits every approved Nursing 200-Level source
// and produces a per-file diagnostic report. This script NEVER writes to the
// DB and NEVER modifies the source JSON files.
//
// Usage:  node scripts/audit-nursing200-sources.mjs
// Output: table on stdout + artifacts in verification/nursing200-audit.json
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  normalizeText,
  stripOptionMarker,
  resolveCanonicalAnswer,
  validateQuestion,
  LETTER_TO_INDEX,
} from './nursing200Normalizer.mjs';

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

const classifyKeyFormat = (q, resolved) => {
  const raw = String(q.correct_answer ?? '').trim();
  if (!raw) return 'MISSING';
  const upper = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (LETTER_TO_INDEX[upper[0]] != null && upper.length <= 3) return 'LETTER';
  if (resolved.ok) {
    // Text that resolved exactly (still may have carried a marker).
    if (normalizeText(raw) === normalizeText(resolved.canonical)) return 'TEXT-EXACT';
    return stripOptionMarker(raw) === normalizeText(resolved.canonical) ? 'TEXT-PREFIXED' : 'TEXT-RESOLVED';
  }
  return 'TEXT-UNRESOLVED';
};

function auditFile(fileName) {
  const raw = readFileSync(resolve(SOURCE_DIR, fileName), 'utf8');
  const data = JSON.parse(raw);
  const items = Array.isArray(data) ? data : data.questions || data.items || [];

  const ids = new Map(); // normalized id string -> count
  const idKind = new Set(); // which field holds the id
  const optionCounts = new Map();
  const keyFormats = new Map();
  const difficulties = new Map();
  const subjects = new Map();
  const duplicateOptions = [];
  const flagged = []; // per-question validation flags

  for (const q of items) {
    const idRaw = q.question_id ?? q.id ?? '(missing)';
    const idKey = typeof idRaw === 'number' ? `n:${idRaw}` : `s:${String(idRaw)}`;
    ids.set(idKey, (ids.get(idKey) || 0) + 1);
    if (q.question_id !== undefined) idKind.add('question_id');
    if (q.id !== undefined) idKind.add('id');

    const optLen = Array.isArray(q.options) ? q.options.length : 0;
    optionCounts.set(optLen, (optionCounts.get(optLen) || 0) + 1);

    const resolved = resolveCanonicalAnswer(q);
    const fmt = classifyKeyFormat(q, resolved);
    keyFormats.set(fmt, (keyFormats.get(fmt) || 0) + 1);

    const d = q.difficulty ?? '(none)';
    difficulties.set(String(d), (difficulties.get(String(d)) || 0) + 1);

    const s = String(q.subject ?? '(none)');
    subjects.set(s, (subjects.get(s) || 0) + 1);

    if (Array.isArray(q.options)) {
      const strs = q.options.map((o) => String(o ?? '').trim());
      const seen = new Set();
      const seenNorm = new Set();
      for (const o of strs) {
        if (seen.has(o)) duplicateOptions.push(`q=${idRaw} raw="${o}"`);
        seen.add(o);
        if (seenNorm.has(normalizeText(o))) duplicateOptions.push(`q=${idRaw} norm="${o}"`);
        seenNorm.add(normalizeText(o));
      }
    }

    const v = validateQuestion(q);
    if (!v.valid) {
      flagged.push({
        id: idRaw,
        subject: s,
        question: String(q.question ?? '').slice(0, 140),
        flags: v.flags,
        correct_answer: String(q.correct_answer ?? ''),
        reason: v.resolved.reason || '',
      });
    }
  }

  const duplicateIds = [...ids].filter(([, c]) => c > 1).map(([k, c]) => ({ id: k, count: c }));
  const total = items.length;

  return {
    file: fileName,
    total,
    idField: [...idKind].join('|') || '(none)',
    uniqueIds: ids.size,
    duplicateIds: duplicateIds.length,
    duplicateIdList: duplicateIds.slice(0, 20),
    optionCounts: Object.fromEntries([...optionCounts].sort((a, b) => a[0] - b[0])),
    keyFormats: Object.fromEntries([...keyFormats].sort()),
    difficulties: Object.fromEntries([...difficulties].sort()),
    subjects: Object.fromEntries([...subjects].sort()),
    duplicateOptionPairs: duplicateOptions.length,
    flaggedCount: flagged.length,
    flagged,
  };
}

const reportPerFile = FILES.map(auditFile);

// ── Combined summary ───────────────────────────────────────
const summary = {
  generatedAt: new Date().toISOString(),
  scopeDescription:
    'The 8 approved Nursing 200-Level source files (Polynurse 200-level question banks). Diagnostic only — no source data modified, no DB writes.',
  capital:
    'Questions audited / unique IDs / duplicate IDs / option-count errors / missing or invalid answer keys / questions whose answer key does not resolve to exactly one option / duplicate option text.',
  files: reportPerFile,
  totals: reportPerFile.reduce(
    (acc, r) => {
      acc.totalQuestions += r.total;
      acc.duplicateIds += r.duplicateIds;
      acc.flagged += r.flaggedCount;
      acc.duplicateOptionPairs += r.duplicateOptionPairs;
      return acc;
    },
    { totalQuestions: 0, duplicateIds: 0, flagged: 0, duplicateOptionPairs: 0 }
  ),
};

const outDir = resolve(ROOT, 'verification');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'nursing200-audit.json'), JSON.stringify(summary, null, 2));
console.log(`artifact written: verification/nursing200-audit.json\n`);

for (const r of reportPerFile) {
  console.log(`=== ${r.file}`);
  console.log(`Questions: ${r.total}`);
  console.log(`ID field: ${r.idField} | unique IDs: ${r.uniqueIds} | duplicate IDs: ${r.duplicateIds}`);
  console.log(`Option counts: ${JSON.stringify(r.optionCounts)}`);
  console.log(`Answer-key formats: ${JSON.stringify(r.keyFormats)}`);
  console.log(`Difficulties: ${JSON.stringify(r.difficulties)}`);
  console.log(`Duplicate option pairs: ${r.duplicateOptionPairs}`);
  console.log(`Flagged invalid/ambiguous/unresolved questions: ${r.flaggedCount}`);
  if (r.duplicateIdList.length) console.log(`  duplicate ids: ${JSON.stringify(r.duplicateIdList)}`);
  if (r.flagged.length) {
    for (const f of r.flagged.slice(0, 12)) {
      console.log(`  FLAG q=${f.id} [${f.flags.join(',')}] ${f.question}`);
      if (f.flags.includes('UNRESOLVED') || f.flags.includes('AMBIGUOUS')) {
        console.log(`         key="${f.correct_answer}" reason=${f.reason}`);
      }
    }
    if (r.flagged.length > 12) console.log(`  ... +${r.flagged.length - 12} more`);
  }
  console.log('Subjects: ' + Object.entries(r.subjects).map(([k, v]) => `${k}(${v})`).join(' | '));
  console.log('');
}

console.log(`TOTALS: ${summary.totals.totalQuestions} questions audited across 8 sources`);
console.log(`        ${summary.totals.flagged} questions flagged (never to be auto-inserted)`);
console.log(`        ${summary.totals.duplicateIds} duplicate IDs, ${summary.totals.duplicateOptionPairs} duplicate option pairs`);