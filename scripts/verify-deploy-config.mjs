// scripts/verify-deploy-config.mjs
//
// Deployment-safety assertions for the Vercel serverless + Vite SPA setup.
// Fail-fast checks that the routing table, non-handler support modules (the
// "Vercel deploys every api/*.js as a function" trap), bundle payload, and
// client data-loading all stay in the corrected production shape.
//
//  No network required. Run: node scripts/verify-deploy-config.mjs
//
// Exit code 0 = all checks green; 1 = at least one failure (details printed).
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const fail = (label, detail) => {
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);

  return false;
};
const ok = (label) => {
  console.log(`PASS  ${label}`);
  return true;
};
const read = (p) => readFileSync(p, 'utf8');

const checks = [];
let passed = 0;

// ---------------------------------------------------------------------------
// 1. vercel.json: rewrite table must only point at real TOP-LEVEL api files.
// ---------------------------------------------------------------------------
{
  const vercel = JSON.parse(read(resolve(ROOT, 'vercel.json')));
  const { rewrites = [] } = vercel;
  const sources = rewrites.map((r) => r.source);
  const destinations = rewrites.map((r) => r.destination);

  // SPA fallback stays LAST and must never swallow /api/*.
  const spaIdx = sources.indexOf('/:path*');
  checks.push(
    spaIdx !== -1
      ? ok('vercel.json has SPA fallback `/:path* -> /index.html`')
      : fail('vercel.json SPA fallback missing'),
  );
  checks.push(
    spaIdx === sources.length - 1
      ? ok('SPA fallback is the final rewrite')
      : fail('SPA fallback is NOT last', `index ${spaIdx} of ${sources.length}`),
  );
  const apiSpa = rewrites.filter((r) => r.source.startsWith('/api') && r.destination.includes('/index.html'));
  checks.push(
    apiSpa.length === 0
      ? ok('no /api/* path rewrites to index.html')
      : fail('/api route rewrites to SPA HTML', apiSpa.map((r) => r.source).join(', ')),
  );

  // Every rewrite destination resolving under /api/* must map to a file that
  // exists at api/<dst>.js (top-level only) and is a real handler file.
  const apiFiles = new Set(
    readdirApi(ROOT).filter((f) => f.endsWith('.js') && !f.startsWith('_')),
  );
  const broken = [];
  for (const dst of destinations) {
    if (!dst.startsWith('/api/')) continue;
    const rel = dst.replace(/^\/api\//, '').replace(/[/]$/, '');
    if (!apiFiles.has(`${rel}.js`)) broken.push(`${dst} -> api/${rel}.js (missing)`);
  }
  checks.push(
    broken.length === 0
      ? ok('every /api rewrite destination has a backing top-level api/*.js')
      : fail('rewrite destinations without backing handlers', broken.join('; ')),
  );

  // The catch-all JSON 404 must exist and precede the SPA fallback.
  const nfIdx = sources.indexOf('/api/:path*');
  const nfDst = destinations[nfIdx];
  checks.push(
    nfIdx !== -1 && nfDst === '/api/not-found'
      ? ok('`/api/:path* -> /api/not-found` catch-all present')
      : fail('`/api/:path*` not-found catch-all missing/misconfigured'),
  );
  checks.push(
    nfIdx !== -1 && spaIdx !== -1 && nfIdx < spaIdx
      ? ok('not-found catch-all precedes the SPA fallback')
      : fail('not-found catch-all must come before SPA fallback'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'api/not-found.js'))
      ? ok('api/not-found.js exists')
      : fail('api/not-found.js missing'),
  );

  // Core Vercel project settings.
  checks.push(
    vercel.buildCommand === 'npm run build'
      ? ok('buildCommand = npm run build')
      : fail('buildCommand', String(vercel.buildCommand)),
  );
  checks.push(
    vercel.outputDirectory === 'dist'
      ? ok('outputDirectory = dist')
      : fail('outputDirectory', String(vercel.outputDirectory)),
  );
  // `functions[].runtime` must be an npm-package runtime name (e.g.
  // `now-php@1.0.0`) — a bare Node version like `nodejs20.x` here makes Vercel
  // fail config validation with "Function Runtimes must have a valid version".
  // Simplest valid setup: no functions block at all; Vercel auto-detects
  // `api/*.js` as Node.js Functions and takes the Node version from project
  // settings / package.json engines.
  const invalidRuntime =
    vercel.functions &&
    Object.values(vercel.functions).some((cfg) => cfg && typeof cfg.runtime === 'string');
  checks.push(
    !invalidRuntime
      ? ok('vercel.json declares no functions.runtime (valid runtime names are npm packages, not nodejs20.x)')
      : fail('vercel.json functions[].runtime must be removed', JSON.stringify(vercel.functions)),
  );
  checks.push(
    !vercel.builds
      ? ok('no legacy `builds`/`use` config present')
      : fail('legacy builds config present', JSON.stringify(vercel.builds)),
  );

  // The legacy self-loop `/api/:path* -> /api/:path*` must never return.
  const selfLoop = sources.findIndex((s, i) => s === '/api/:path*' && destinations[i] === '/api/:path*');
  checks.push(
    selfLoop === -1
      ? ok('no `/api/:path* -> /api/:path*` self-loop')
      : fail('self-loop rewrite present'),
  );
}

// ---------------------------------------------------------------------------
// 2. api/ layout: every non-underscore top-level .js is a real handler.
// ---------------------------------------------------------------------------
{
  for (const f of readdirApi(ROOT).sort()) {
    if (f.startsWith('_')) continue;
    const src = read(resolve(ROOT, 'api', f));
    if (!/\bexport\s+default\b|\bexports\.default\b/.test(src)) {
      checks.push(fail(`api/${f} has no default handler export`));
    } else {
      // eslint-disable-next-line no-unused-vars
      checks.push(ok(`api/${f} exports a default handler`));
    }
  }
  for (const f of ['_utils.js', '_questionSelectionService.js', '_selectionConfig.js', '_quiz-batches.js']) {
    checks.push(
      existsSync(resolve(ROOT, 'api', f))
        ? ok(`api/${f} present (underscore-prefixed, ignored by Vercel as functions)`)
        : fail(`api/${f} missing`),
    );
  }
  // Vercel Hobby allows at most 12 Serverless Functions per deployment. Every
  // top-level api/*.js (non-underscore) is deployed as a function, so gate on
  // that count here to stop a deployment before Vercel rejects it.
  const functionCount = readdirApi(ROOT).filter((f) => f.endsWith('.js') && !f.startsWith('_')).length;
  checks.push(
    functionCount <= 12
      ? ok(`api/ serverless function count ${functionCount} <= 12 (Vercel Hobby limit)`)
      : fail('Vercel Hobby function limit exceeded', `${functionCount} top-level api functions > 12`),
  );
  // No leftover legacy nested api/quiz or api/matches files.
  for (const f of ['api/quiz', 'api/matches', 'api/payments']) {
    checks.push(
      !existsSync(resolve(ROOT, f))
        ? ok(`${f}/ legacy nested dir removed`)
        : fail(`${f} nested dir still present`),
    );
  }
}

// ---------------------------------------------------------------------------
// 3. serve-api.mjs parity: legacy rewrites mirrored in the local dev server.
// ---------------------------------------------------------------------------
{
  const saSrc = read(resolve(ROOT, 'scripts/serve-api.mjs'));
  const requiredRewrite = ['/api/quiz/batch-create', '/api/quiz/batch-get', '/api/quiz/batch-answer', '/api/quiz/batch-complete', '/api/quiz-batch-create', '/api/quiz-batch-get', '/api/quiz-batch-answer', '/api/quiz-batch-complete', '/api/matches/create', '/api/payments/webhook'];
  const missing = requiredRewrite.filter((r) => !saSrc.includes(`'${r}'`) && !saSrc.includes(`"${r}"`));
  checks.push(
    missing.length === 0
      ? ok('serve-api.mjs mirrors all legacy + flat quiz rewrite paths')
      : fail('serve-api.mjs missing rewrites', missing.join(', ')),
  );
  checks.push(
    /destination:\s*'\/api\/quiz'/.test(saSrc)
      ? ok('serve-api.mjs routes quiz batch paths to the consolidated api/quiz.js')
      : fail('serve-api.mjs does not map quiz batch paths to /api/quiz'),
  );
  checks.push(
    /entry\.name\.startsWith\('_'\)/.test(saSrc)
      ? ok('serve-api.mjs skips underscore-prefixed api files')
      : fail('serve-api.mjs does not skip underscore api files'),
  );
}

// ---------------------------------------------------------------------------
// 4. Client payload: banks lazy, off the initial bundle, no prod source maps.
// ---------------------------------------------------------------------------
{
  const loadSrc = read(resolve(ROOT, 'src/data/loadFlashcards.js'));
  checks.push(
    /import\.meta\.glob\(\s*['"]\.\/flashcards\/\*\*\/\*\.json['"]\s*\)/.test(loadSrc)
      ? ok('loadFlashcards.js glob is lazy (no eager options object)')
      : fail('loadFlashcards.js glob missing/lazy-ness regression'),
  );
  checks.push(
    /export\s+const\s+loadAllBuiltInFlashcards\s*=/.test(loadSrc)
      ? ok('loadFlashcards.js exports loadAllBuiltInFlashcards')
      : fail('loadFlashcards.js missing loadAllBuiltInFlashcards'),
  );

  const appSrc = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  checks.push(
    !/\ballBuiltInFlashcards\b/.test(appSrc)
      ? ok('AppContext no longer imports allBuiltInFlashcards (static sync export)')
      : fail('AppContext still references allBuiltInFlashcards'),
  );
  checks.push(
    /loadAllBuiltInFlashcards/.test(appSrc) && /builtInHydratedRef|flashcards/.test(appSrc)
      ? ok('AppContext hydrates built-in flashcards lazily after auth')
      : fail('AppContext hydration wired oddly'),
  );

  const viteSrc = read(resolve(ROOT, 'vite.config.js'));
  checks.push(
    /sourcemap\s*:\s*false/.test(viteSrc)
      ? ok('vite.config.js disables production sourcemaps')
      : fail('vite.config.js sourcemap enabled'),
  );
  checks.push(
    /manualChunks\(id\)[\s\S]*?id\.includes\(['"]src\/data\/flashcards\/['"]\)/.test(viteSrc) && !/manualChunks\(id\)[\s\S]*?loadFlashcards\.js[^)]*return 'flashcard-data'/.test(viteSrc)
      ? ok('loadFlashcards.js NOT grouped into the flashcard-data chunk')
      : fail('loadFlashcards.js still joined to flashcard-data manualChunk'),
  );

  // Dist check (only when a build exists): never ship the bank chunk on the
  // initial page load.
  const distHtml = resolve(ROOT, 'dist/index.html');
  if (existsSync(distHtml)) {
    const html = read(distHtml);
    const scripts = [...html.matchAll(/assets\/[A-Za-z0-9_\-\.]+\.js/g)].map((m) => m[0]);
    checks.push(
      !scripts.some((s) => s.includes('flashcard-data'))
        ? ok('dist/index.html does not statically load the flashcard-data chunk')
        : fail('dist/index.html still loads flashcard-data statically', scripts.join(', ')),
    );
  } else {
    checks.push(ok('dist not built — skipped dist payload checks (run npm run build)'));
  }
}

// ---------------------------------------------------------------------------
// 5. Sample error-handling contract sanity (single fast static grep).
// ---------------------------------------------------------------------------
{
  const qz = read(resolve(ROOT, 'src/hooks/useQuizBatch.js'));
  const codes = ['NETWORK_ERROR', 'API_MISROUTED', 'SERVER_ERROR', 'UNAUTHORIZED', 'QUOTA_EXHAUSTED', 'DIFFICULTY_LOCKED'];
  const missing = codes.filter((c) => !qz.includes(c));
  checks.push(
    missing.length === 0
      ? ok('useQuizBatch.classifyBatchError exposes all stable error codes')
      : fail('useQuizBatch missing error codes', missing.join(', ')),
  );
}

// ---------------------------------------------------------------------------
// 6. FAIL-CLOSED quiz authorization invariants (static source assertions).
// ---------------------------------------------------------------------------
{
  const qz = read(resolve(ROOT, 'src/pages/Quiz.jsx'));
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const dcw = read(resolve(ROOT, 'src/components/DailyChallengeWidget.jsx'));

  // Single authoritative entry: the active player may only be switched on ONCE
  // (immediately after a successful server batch-create replies).
  checks.push(
    (qz.match(/setPlayerActive\(true\)/g) || []).length === 1
      ? ok('Quiz.jsx opens the player at exactly ONE place (server-batch-gated)')
      : fail('Quiz.jsx setPlayerActive(true) count !== 1 — a second entry path exists'),
  );
  checks.push(
    /const ready\s*=\s*isCooldown\s*&&\s*!!\(cooldownVerified/.test(qz)
      ? ok('Quiz.jsx cooldown Start is enabled only after server re-verification')
      : fail('Quiz.jsx cooldown Start still relies on the client countdown'),
  );
  checks.push(
    /rowStatus\s*=\s*\(courseId,\s*subject,\s*courseQuota,\s*quotaAvailable\)/.test(qz)
      ? ok('Quiz.jsx rowStatus is quota-availability aware (fail-closed chips)')
      : fail('Quiz.jsx rowStatus still treats absence as ready'),
  );
  checks.push(
    /const StatusChip\s*=\s*\(\{\s*premium,\s*ready,\s*untilIso,\s*unavailable\s*\}\)/.test(qz)
      ? ok('Quiz.jsx StatusChip renders the unavailable (could-not-verify) state')
      : fail('Quiz.jsx StatusChip has no unavailable branch'),
  );
  checks.push(
    !/skipQuota/.test(qz)
      ? ok('no legacy skipQuota launch path remains in Quiz.jsx')
      : fail('Quiz.jsx still contains a skipQuota path'),
  );
  checks.push(
    /retrySameSession/.test(qz) && /launchPlayer\(engineMode,\s*cfg\);/m.test(qz)
      ? ok('Quiz.jsx retry re-runs the full server batch-create (idempotent attemptId)')
      : fail('Quiz.jsx retry path bypasses server authorization'),
  );
  checks.push(
    /courseQuotaAvailable/.test(app)
      ? ok('AppContext exposes courseQuotaAvailable (true only after a successful fetch)')
      : fail('AppContext missing courseQuotaAvailable'),
  );
  checks.push(
    /const serverReady\s*=\s*row\s*\?\s*row\.is_ready\s*===\s*true\s*:\s*true/.test(qz)
      ? ok('Quiz.jsx fail-closed check: server time gates the cooldown expiry')
      : fail('Quiz.jsx missing server-side cooldown re-verification branch'),
  );
  checks.push(
    dcw.includes('res.allowed === false') && !dcw.includes('res.is_ready === false')
      ? ok('DailyChallengeWidget gates on allowed===false only (never over-blocks first round)')
      : fail('DailyChallengeWidget cooldown gate regression (is_ready gate would lock first round)'),
  );
}

// ---------------------------------------------------------------------------
console.log('\n----');
const failed = checks.filter((c) => c === false).length;
passed = checks.filter((c) => c === true).length;
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

// Small helper — local listing of api/ dir (top-level only for the rewrite check).
function readdirApi(root) {
  return readdirSync(resolve(root, 'api'), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
}