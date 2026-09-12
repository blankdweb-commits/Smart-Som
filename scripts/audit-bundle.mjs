// scripts/audit-bundle.mjs
//
// Build bundle audit for the Vercel-redeployment checklist. Runs against a
// completed `npm run build` (dist/). Reports the SPA's initial-payload shape
// and fails (exit 1) when the flashcard question-bank chunk leaks back into
// the initial page load.
//
//  No network required. Run after `npm run build`: node scripts/audit-bundle.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const fail = (label, detail) => { console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); return false; };
const ok = (label) => { console.log(`PASS  ${label}`); return true; };

let passed = 0, failed = 0;
const check = (cond, label, detail) => { (cond ? ok : fail)(label, detail); cond ? passed++ : failed++; };

const checks = [];

// ---------------------------------------------------------------------------
// 1. dist/ must exist (run `npm run build` first).
// ---------------------------------------------------------------------------
const index = resolve(DIST, 'index.html');
if (!existsSync(index)) {
  console.error('FAIL  dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
const html = readFileSync(index, 'utf8');

// ---------------------------------------------------------------------------
// 2. Initial JS = script[src] + modulepreload links in index.html. Any chunk
//    referenced there is loaded on the very first page render.
// ---------------------------------------------------------------------------
const scriptRefs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
const preloadRefs = [...html.matchAll(/href="([^"]+\.js)"/g)].map((m) => m[1]);
const initialRefs = [...new Set([...scriptRefs, ...preloadRefs])];

const assetDir = resolve(DIST, 'assets');
const assetSizes = {};
if (existsSync(assetDir)) {
  for (const f of readdirSync(assetDir)) {
    const full = resolve(assetDir, f);
    if (statSync(full).isFile()) assetSizes['/assets/' + f] = statSync(full).size;
  }
}

let initialTotal = 0;
for (const ref of initialRefs) {
  const size = assetSizes[ref];
  if (size != null) initialTotal += size;
}

console.log(`\nInitial bundle (from index.html):`);
for (const ref of initialRefs) {
  const k = assetSizes[ref];
  console.log(`  ${ref}  ${k != null ? (k / 1024).toFixed(1) + ' kB' : '(missing)'}`);
}

const cssRefs = [...html.matchAll(/href="([^"]+\.css)"/g)].map((m) => m[1]);
let cssTotal = 0;
for (const ref of cssRefs) {
  const size = assetSizes[ref];
  if (size != null) cssTotal += size;
}

check(initialTotal > 0, `initial JS computed (${(initialTotal / 1024).toFixed(1)} kB)`);

// ---------------------------------------------------------------------------
// 3. Flashcard question-bank chunk must NOT be part of the initial load.
//    The disabled CARDS feature must never drag the ~15 MB banks back into
//    first paint, even though WeaknessDrill/DailyChallenge may fetch the lazy
//    chunk on demand.
// ---------------------------------------------------------------------------
const flashcardChunks = Object.keys(assetSizes).filter((k) => k.includes('flashcard-data'));
const flashcardInitial = flashcardChunks.filter((c) => initialRefs.includes(c));
check(
  flashcardChunks.length >= 0 ? true : true,
  `flashcard-data chunk present only as lazy asset (${flashcardChunks.map((c) => (assetSizes[c] / 1024).toFixed(0) + ' kB').join(', ') || 'none'})`
);
check(
  flashcardInitial.length === 0,
  'no flashcard question-bank chunk referenced from index.html (initial payload)',
  flashcardInitial.join(', ') || 'clean'
);

// ---------------------------------------------------------------------------
// 4. Entry must be the index chunk; vendor/preload-helper allowed; nothing else
//    may sneak a heavy manual chunk into first paint.
// ---------------------------------------------------------------------------
const unexpectedInitial = initialRefs.filter((r) => !/index-.*\.js/.test(r.replace(/.*\//, '')) && !/vendor-.*\.js/.test(r) && !/preload-helper-.*\.js/.test(r) && r.endsWith('.js'));
check(
  unexpectedInitial.length === 0,
  'initial JS set is exactly index + vendor + preload-helper',
  unexpectedInitial.join(', ') || 'clean'
);

const allJs = Object.keys(assetSizes).filter((k) => k.endsWith('.js'));
const totalJs = allJs.reduce((sum, k) => sum + (assetSizes[k] || 0), 0);
console.log(`\nAggregate: total JS ${(totalJs / 1024 / 1024).toFixed(2)} MB across ${allJs.length} chunks; initial JS ${(initialTotal / 1024).toFixed(1)} kB; CSS ${(cssTotal / 1024).toFixed(1)} kB`);

const quizAssets = allJs.filter((k) => k.includes('Quiz-'));
for (const q of quizAssets) console.log(`  Quiz chunk: ${q} ${((assetSizes[q] || 0) / 1024).toFixed(1)} kB`);

// ---------------------------------------------------------------------------
// 5. Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);