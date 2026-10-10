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
  for (const f of ['_utils.js', '_questionSelectionService.js', '_selectionConfig.js', '_quiz-batches.js', '_community.js']) {
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
  const requiredRewrite = ['/api/quiz/batch-create', '/api/quiz/batch-get', '/api/quiz/batch-answer', '/api/quiz/batch-complete', '/api/quiz-batch-create', '/api/quiz-batch-get', '/api/quiz-batch-answer', '/api/quiz-batch-complete', '/api/matches/create', '/api/payments/webhook', '/api/community/:path*'];
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
    !/import\.meta\.glob/.test(loadSrc) && /\bmodules\s*=\s*\{\}/.test(loadSrc)
      ? ok('loadFlashcards.js ships NO flashcard data (modules = {} — feature disabled)')
      : fail('loadFlashcards.js still bundles flashcard JSON (glob/eager regression)'),
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
    /hydrateBuiltInFlashcards/.test(appSrc)
      && !/from\s+['"]\.\.\/data\/loadFlashcards/.test(appSrc)
      && !/import\(.+data\/loadFlashcards/.test(appSrc)
      ? ok('AppContext flashcard hydration is a stub — no static OR dynamic bank import (feature disabled)')
      : fail('AppContext still imports the built-in flashcard bank'),
  );

  const dcwSrc = read(resolve(ROOT, 'src/components/DailyChallengeWidget.jsx'));
  checks.push(
    !/from\s+['"]\.\.\/data\/flashcards\//.test(dcwSrc) && !/from\s+['"]\.\.\/data\/richardBank['"]/.test(dcwSrc)
      ? ok('DailyChallengeWidget has NO static bank imports (loads banks on demand only)')
      : fail('DailyChallengeWidget still statically imports the 15.6MB bank'),
  );

  const libSrc = read(resolve(ROOT, 'src/components/FlashcardLibrary.jsx'));
  checks.push(
    /HIGHLY CLASSIFIED/.test(libSrc)
      && !/hydrateBuiltInFlashcards/.test(libSrc)
      && !/flashcardAccess/.test(libSrc)
      ? ok('FlashcardLibrary ALWAYS renders the locked gate — no bank hydration/access check')
      : fail('FlashcardLibrary still hydrates the flashcard bank (feature should be disabled)'),
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
  const codes = ['NETWORK_ERROR', 'API_MISROUTED', 'SERVER_ERROR', 'UNAUTHORIZED', 'QUOTA_EXHAUSTED', 'COOLDOWN_ACTIVE', 'DIFFICULTY_LOCKED'];
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
    /const rowState\s*=\s*\(courseId,\s*subject,\s*courseQuota,\s*quotaStatus,\s*isPremium\)/.test(qz)
      ? ok('Quiz.jsx rowState decides selectability ONLY from the server quota map')
      : fail('Quiz.jsx rowState missing/not quota-server-authoritative'),
  );
  checks.push(
    /if \(quotaStatus === 'error'\) return \{ state: ROW_STATE\.ERROR, expiresAt: null \}/.test(qz)
      ? ok('Quiz.jsx rowState fails closed on a failed status fetch (ERROR=not selectable)')
      : fail('Quiz.jsx rowState does not fail closed on quota status ERROR'),
  );
  checks.push(
    qz.includes('ROW_STATE.COOLDOWN') && /\.is_ready === true\) return \{ state: ROW_STATE\.AVAILABLE/.test(qz)
      ? ok('Quiz.jsx a locked course stays locked until the map says is_ready')
      : fail('Quiz.jsx cooldown rows can look selectable without server readiness'),
  );
  checks.push(
    /const StatusChip\s*=\s*\(\{\s*premium\s*\}\)/.test(qz)
      ? ok('Quiz.jsx StatusChip is now ready-only (locked rows render the lock badge, never a ready pill)')
      : fail('Quiz.jsx StatusChip regression'),
  );
  checks.push(
    /tabIndex=\{-1\}/.test(qz) && /aria-disabled="true"/.test(qz)
      ? ok('Quiz.jsx locked course cards are not keyboard-activatable (tabIndex -1 + aria-disabled)')
      : fail('Quiz.jsx locked course cards remain keyboard-selectable'),
  );
  checks.push(
    /handleCourseBlocked/.test(qz) && /setSelectionLock\(\{ setupId: bankId, subject: null \}\)/.test(qz)
      ? ok('Quiz.jsx tapping a locked course shows the lock overlay — never opens setup')
      : fail('Quiz.jsx locked-course tap path can open setup'),
  );
  checks.push(
    /directoryCooldownExpiry/.test(qz) && /fetchCourseQuotaStatus\(\)/.test(qz)
      ? ok('Quiz.jsx refetch-on-expiry pings the server; local clock never unlocks')
      : fail('Quiz.jsx cooldown expiry can unlock from the device clock'),
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
    /quotaFetchStatus/.test(app) && /courseQuotaAvailable: quotaFetchStatus === 'ok'/.test(app)
      ? ok('AppContext exposes quotaFetchStatus tri-state; courseQuotaAvailable only on ok')
      : fail('AppContext quotaFetchStatus tri-state missing'),
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
// 7. COURSE-LEVEL COOLDOWN LOCK invariants (backend + setup-flow defense).
//    The server must answer a direct batch-create during cooldown with the
//    distinct COOLDOWN_ACTIVE code; the setup-flow tiles must refuse selection.
// ---------------------------------------------------------------------------
{
  const qb = read(resolve(ROOT, 'api/_quiz-batches.js'));
  const uqb = read(resolve(ROOT, 'src/hooks/useQuizBatch.js'));
  const ssf = read(resolve(ROOT, 'src/components/QuizSetupFlow.jsx'));

  checks.push(
    /error: cooling \? 'COOLDOWN_ACTIVE' : 'QUOTA_EXHAUSTED'/.test(qb)
      ? ok('api/_quiz-batches.js returns COOLDOWN_ACTIVE (not generic QUOTA_EXHAUSTED) while a cooldown is active')
      : fail('api/_quiz-batches.js does not emit the COOLDOWN_ACTIVE code'),
  );
  checks.push(
    qb.includes('Number(quotaBody.cooldown_remaining_seconds)') && /cooldown_remaining_seconds: quotaBody\.cooldown_remaining_seconds/.test(qb)
      ? ok('api/_quiz-batches.js derives the cooldown verdict from server seconds, not client input')
      : fail('api/_quiz-batches.js COOLDOWN_ACTIVE not driven by server cooldown seconds'),
  );
  checks.push(
    /['QUOTA_EXHAUSTED', 'COOLDOWN_ACTIVE']/.test(uqb)
      ? ok('useQuizBatch.classifyBatchError passes the COOLDOWN_ACTIVE code through')
      : fail('useQuizBatch missing COOLDOWN_ACTIVE in the 403 code set'),
  );
  checks.push(
    /const tileLocked\s*=\s*cooling\s*\|\|\s*\(!isPremium && quotaFetchStatus === 'error'\)/.test(ssf)
      ? ok('QuizSetupFlow cooling/error subject tiles are NOT selectable (defense-in-depth)')
      : fail('QuizSetupFlow subject tiles are still selectable during cooldown'),
  );
}

// ---------------------------------------------------------------------------
// 8. COMMUNITY RESET + EPHEMERAL POSTS + ANONYMOUS GROUP invariants.
//    Ser record — client never writes community tables directly (migration v29
//    removed the RLS write grants); every write flows through /api/community.
// ---------------------------------------------------------------------------
{
  const mig = read(resolve(ROOT, 'scripts/migration-v29-community-ephemeral-anonymous.sql'));
  const apiC = read(resolve(ROOT, 'api/community.js'));
  const apiCm = read(resolve(ROOT, 'api/_community.js'));
  const com = read(resolve(ROOT, 'src/pages/Community.jsx'));
  const grp = read(resolve(ROOT, 'src/pages/GroupPage.jsx'));
  const sg = read(resolve(ROOT, 'src/components/StudyGroups.jsx'));
  const hub = read(resolve(ROOT, 'src/components/CommunityHubWidget.jsx'));

  // Migration: ephemeral expiry math + anonymous group lifecycle.
  checks.push(
    /grace_until\s*=\s*now\(\) \+ interval '24 hours'/.test(mig) && /interval '1 hour'/.test(mig)
      ? ok('v29 migration: legacy 24h grace + 1h ephemeral life live in community_post_lives_until')
      : fail('v29 migration missing the legacy-grace / 1h ephemeral window'),
  );
  checks.push(
    /\+\s*interval '110 seconds'/.test(mig)
      ? ok('v29 migration: 110s cold marker (active|cold) is server-computed')
      : fail('v29 migration missing the 110-second cold marker'),
  );
  checks.push(
    /anonymous_spectators/.test(mig) && /spectator_price/.test(mig) && /minimum_members_to_activate/.test(mig) && /minimum_members_to_remain_active/.test(mig)
      ? ok('v29 migration: anonymous group lifecycle columns + spectator ledger present')
      : fail('v29 migration anonymous lifecycle DDL missing'),
  );
  checks.push(
    /group_state in \('normal', 'waiting', 'active', 'wiped'\)/.test(mig)
      ? ok('v29 migration: study_groups state check spans normal/waiting/active/wiped')
      : fail('v29 migration study_groups state check missing wiped'),
  );
  // Server-side identity masking for anonymous rooms (community_profiles is
  // globally readable by authenticated users, so the feed must mask it).
  checks.push(
    /case when v_anon then 'Anonymous Member' else cp\.display_name end/.test(mig) && /case when v_anon then null else cp\.avatar_url end/.test(mig)
      ? ok('community_group_feed masks display_name/avatar_url/year for anonymous rooms')
      : fail('community_group_feed does not mask anonymous identities'),
  );
  // The waitlist counter is public during the OPEN waiting round only.
  checks.push(
    /v_gr\.type = 'anonymous' and v_gr\.group_state = 'waiting'/.test(mig)
      ? ok('community_panel exposes member_count while an anonymous room is waiting')
      : fail('community_panel does not expose the public waitlist count'),
  );

  // API router: all write endpoints + comment edit/delete wired.
  for (const route of ['/posts/edit-comment$', '/posts/delete-comment$', '/posts/reply$', '/groups/feed$', '/groups/panel$', '/anonymous/room$', '/anonymous/feed$', '/anonymous/message$', '/anonymous/send$', '/anonymous/react$']) {
    // Handlers are declared as `re: /\/posts\/edit-comment$/` — the source text
    // carries escaped slashes (`\/`), so match the escaped literal form.
    const escaped = route.replace(/\//g, '\\/');
    checks.push(
      apiC.includes(escaped)
        ? ok(`api/community.js routes ${route}`)
        : fail(`api/community.js missing route ${route}`),
    );
  }
  // Rate-limited interaction bump: a repeat interaction within 15s must NOT
  // extend a post's lifetime (a single user cannot keep a post alive forever).
  checks.push(
    /bumpInteraction/.test(apiCm) && /INTERACTION_COOLDOWN_MS/.test(apiCm) && /last_interaction_at\.lt\.\$\{cutoff\}/.test(apiCm)
      ? ok('api/_community.js bumpInteraction is rate-limited (INTERACTION_COOLDOWN_MS guard)')
      : fail('api/_community.js bumpInteraction lacks the 15s interaction rate limit'),
  );

  // Client: Community.jsx is a single unified feed driven entirely by the API.
  checks.push(
    /EPHEMERAL_POLL_MS\s*=\s*15000/.test(com) && /activeSection\s*=\s*'all'/.test(com)
      ? ok('Community.jsx is a 15s-polled single general feed (no section tabs)')
      : fail('Community.jsx still has section tabs / missing ephemeral poll'),
  );
  checks.push(
    com.includes("communityApi(session, '/posts/edit-comment'") && com.includes("communityApi(session, '/posts/delete-comment'")
      ? ok('Community.jsx comment edit/delete go through the router')
      : fail('Community.jsx comment edit/delete not via communityApi'),
  );
  checks.push(
    /post\.post_state === 'active'/.test(com) && /lives_until/.test(com) && !/Expiring soon/.test(com)
      ? ok('Community.jsx renders the LIVE badge + gone note from server post_state (stale EXPIRING SOON removed)')
      : fail('Community.jsx ephemeral badge wiring missing / still shows EXPIRING SOON'),
  );
  checks.push(
    !com.includes("from('community_posts').insert") && !com.includes("from('community_post_likes').insert") && !com.includes("from('community_comments').insert")
      ? ok('Community.jsx has no direct community table writes')
      : fail('Community.jsx still writes community tables directly'),
  );

  // Anonymous ROOM (chat-first rebuild): pages/AnonymousRoom.jsx owns the room,
  // GroupPage only redirects anonymous groups to it.
  const anon = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  checks.push(
    anon.includes("communityApi(session, '/anonymous/room'") && anon.includes("communityApi(session, '/anonymous/feed'") && anon.includes("communityApi(session, '/anonymous/send'") && anon.includes("communityApi(session, '/anonymous/react'")
      ? ok('AnonymousRoom.jsx drives the room through /anonymous/* router endpoints')
      : fail('AnonymousRoom.jsx missing /anonymous/* router calls'),
  );
  checks.push(
    anon.includes("communityApi(session, '/groups/join'") && /product: 'anonymous_spectate'/.test(anon) && /authorization_url/.test(anon)
      ? ok('AnonymousRoom.jsx join + hosted spectator checkout (anonymous_spectate)')
      : fail('AnonymousRoom.jsx join/spectator purchase not wired to the router/checkout'),
  );
  checks.push(
    /access === 'wiped'/.test(anon) && /access === 'join'/.test(anon) && /access === 'closed'/.test(anon) && /access === 'banned'/.test(anon)
      ? ok('AnonymousRoom.jsx renders wiped/waiting/closed/banned gates from server access state')
      : fail('AnonymousRoom.jsx server access gates missing'),
  );
  checks.push(
    !/author_id/.test(anon) && !(/\?\?\s*30/.test(anon)) && /room\?\.thresholds/.test(anon)
      ? ok('AnonymousRoom.jsx: no author_id exposure, thresholds come from the server (no ?? 30 default)')
      : fail('AnonymousRoom.jsx hardcodes thresholds or references author_id'),
  );
  checks.push(
    /room\?\.group\?\.spectator_price/.test(anon) && !/\b(499|599)\b/.test(anon) && /product: 'anonymous_spectate'/.test(anon)
      ? ok('AnonymousRoom.jsx: spectator price is server-resolved (no hardcoded 499/599) via Paystack')
      : fail('AnonymousRoom.jsx hardcodes the spectator price'),
  );

  // v42: server-authoritative up/down votes + opening new anonymous rooms.
  const apiCommunitySrc = read(resolve(ROOT, 'api/_community.js'));
  const communityRouterSrc = read(resolve(ROOT, 'api/community.js'));
  const migrationV42Src = read(resolve(ROOT, 'scripts/migration-v42-anonymous-voting.sql'));
  checks.push(
    /export async function handleVote/.test(apiCommunitySrc) && /community_post_votes/.test(apiCommunitySrc) && /onConflict: 'post_id,user_id'/.test(apiCommunitySrc)
      ? ok('api/_community.js: handleVote upserts community_post_votes (one vote per post+user)')
      : fail('api/_community.js missing server-authoritative handleVote'),
  );
  checks.push(
    /export async function handleCreateAnonRoom/.test(apiCommunitySrc) && /type: 'anonymous'/.test(apiCommunitySrc) && /group_state: 'waiting'/.test(apiCommunitySrc)
      ? ok('api/_community.js: handleCreateAnonRoom opens a waiting anonymous room server-side')
      : fail('api/_community.js missing handleCreateAnonRoom'),
  );
  checks.push(
    communityRouterSrc.includes('vote$/') && communityRouterSrc.includes('room-create$/') && /handleVote/.test(communityRouterSrc) && /handleCreateAnonRoom/.test(communityRouterSrc)
      ? ok('community.js router exposes /posts/vote and /anonymous/room-create')
      : fail('community.js router missing vote/create routes'),
  );
  checks.push(
    /community_post_votes/.test(migrationV42Src) && /enable row level security/i.test(migrationV42Src) && /spectator_price set default 499/.test(migrationV42Src)
      ? ok('migration-v42: votes table + RLS + spectator_price default 499')
      : fail('migration-v42 missing votes table/RLS/default price'),
  );
  checks.push(
    /ArrowUp/.test(anon) && /voteMessage/.test(anon) && /my_vote/.test(anon) && /'\/posts\/vote'/.test(anon)
      ? ok('AnonymousRoom.jsx: up/down vote UI wired to /posts/vote with my_vote state')
      : fail('AnonymousRoom.jsx missing vote UI'),
  );
  checks.push(
    /Create a new Anonymous room/.test(anon) && /Watch as Spectator/.test(anon) && /Return to groups/.test(anon) && /setConfirmSpectate/.test(anon)
      ? ok('AnonymousRoom.jsx: locked-room 3-option flow (spectate/create/return) with confirmation')
      : fail('AnonymousRoom.jsx missing locked-room 3-option flow'),
  );

  // v43: anonymous-room messages live EXACTLY 5 minutes (server-authoritative
  // expires_at, never extendable by reactions/replies/votes); cleanup batched.
  const migrationV43Src = read(resolve(ROOT, 'scripts/migration-v43-anonymous-message-lifetime.sql'));
  checks.push(
    /add column if not exists expires_at timestamptz/.test(migrationV43Src) &&
      /interval '5 minutes'/.test(migrationV43Src) &&
      /create trigger trg_community_posts_assign_expiry/.test(migrationV43Src)
      ? ok('v43: community_posts.expires_at + 5-minute anonymous expiry trigger')
      : fail('v43 migration missing expires_at column / 5-minute trigger'),
  );
  checks.push(
    /community_post_lives_until/.test(migrationV43Src) && /expires_at is not null then p\.expires_at/.test(migrationV43Src)
      ? ok('v43: community_post_lives_until honors expires_at before the idle/6h model')
      : fail('v43 lives_until does not honor expires_at'),
  );
  checks.push(
    /create or replace function public\.community_cleanup/.test(migrationV43Src) &&
      /expires_at is not null/.test(migrationV43Src) &&
      /v_batch/.test(migrationV43Src)
      ? ok('v43: community_cleanup purges expired anonymous posts in batches')
      : fail('v43 cleanup does not batch-purge expired anonymous posts'),
  );
  checks.push(
    /cp\.expires_at is null[\s\S]{0,220}exists \(select 1 from public\.community_reports/.test(migrationV43Src)
      ? ok('v43: retain-for-moderation branch excludes anonymous posts (they must vanish)')
      : fail('v43 retain branch does not exclude anonymous posts'),
  );
  checks.push(
    /cp\.expires_at is not null[\s\S]{0,140}or not exists \(select 1 from public\.community_reports/.test(migrationV43Src)
      ? ok('v43: purge branch hard-deletes expired anonymous posts EVEN when reported')
      : fail('v43 purge branch does not force-delete reported anonymous posts'),
  );
  checks.push(
    /community_assign_post_expiry/.test(migrationV43Src) &&
      /grant execute on function public\.community_cleanup/.test(migrationV43Src)
      ? ok('v43: expiry trigger + service-role-only cleanup grant')
      : fail('v43 missing the expiry trigger grant / cleanup ACLs'),
  );
  checks.push(
    /MESSAGE_LIFETIME_SECONDS = 600/.test(apiCommunitySrc) &&
      /message_lifetime_seconds:\s*MESSAGE_LIFETIME_SECONDS/.test(apiCommunitySrc) && /expires_at/.test(apiCommunitySrc)
      ? ok('api/_community.js exposes 10-minute message_lifetime_seconds + selects expires_at')
      : fail('api/_community.js missing message_lifetime_seconds / expires_at'),
  );
  checks.push(
    /ROOM_NOTICE = \{ key: 'anonymous_room_safety', version: 4 \}/.test(apiCommunitySrc)
      ? ok('ROOM_NOTICE bumped to version 4 (10-minute lifetime copy)')
      : fail('ROOM_NOTICE not bumped for the new lifetime'),
  );
  checks.push(
    /fmtMSS/.test(anon) && /Expires in \{fmtMSS\(remaining\)\}/.test(anon) &&
      /exactly 10 minutes/.test(anon) && !/COLD_AFTER_MS/.test(anon)
      ? ok('AnonymousRoom.jsx shows "Expires in m:ss" and drops the cold clock (10-min copy)')
      : fail('AnonymousRoom.jsx missing the 10-minute countdown copy / stale cold clock'),
  );

  // v44: anonymous-room social + premium Encoded Messages + server-authoritative
  // presence + per-device Web Push / notification preferences.
  const migrationV44Src = read(resolve(ROOT, 'scripts/migration-v44-anonymous-social-premium-presence.sql'));
  const migrationV45Src = read(resolve(ROOT, 'scripts/migration-v45-anonymous-encoded-content.sql'));
  checks.push(
    /anonymous_encoded_messages/.test(migrationV44Src) && /recipient_user_id/.test(migrationV44Src) &&
      /anonymous_social_actions/.test(migrationV44Src) && /anonymous_social_prefs/.test(migrationV44Src) &&
      /anonymous_presence/.test(migrationV44Src) && /push_subscriptions/.test(migrationV44Src) &&
      /notification_preferences/.test(migrationV44Src)
      ? ok('migration-v44: encoded/social/prefs/presence/push/notification tables')
      : fail('migration-v44 missing v44 tables/columns'),
  );
  checks.push(
    /community_presence_heartbeat/.test(migrationV44Src) && /community_presence_reap/.test(migrationV44Src) &&
      /to service_role/.test(migrationV44Src) && /revoke execute on function public\.community_presence_heartbeat/.test(migrationV44Src)
      ? ok('migration-v44: server-authoritative presence RPCs (service-role only)')
      : fail('migration-v44 missing presence RPCs / service-role grants'),
  );
  checks.push(
    /anonymous_encoded_messages/.test(apiCommunitySrc) && /toString\('base64'\)/.test(apiCommunitySrc) &&
      /encoded_for_me/.test(apiCommunitySrc) && /PREMIUM_REQUIRED/.test(apiCommunitySrc) &&
      /content: isEncoded \? \(revealed \? decodeEncoded\(encBody\.cipher\) : ''\) : row\.content/.test(apiCommunitySrc)
      ? ok('api/_community.js: premium recipient-targeted Encoded Messages (body never in the feed until the recipient reveals)')
      : fail('api/_community.js missing Encoded Message handling'),
  );
  checks.push(
    /encBody\.recipient === viewerId \|\| row\.author_id === viewerId/.test(apiCommunitySrc)
      ? ok('api/_community.js: decode gate is author-or-recipient (never any premium viewer)')
      : fail('api/_community.js encode gate is not recipient-scoped'),
  );
  checks.push(
    !/ROOM_STICKER/.test(apiCommunitySrc) && !/sticker_categories:/.test(apiCommunitySrc) &&
      !/pendingSticker/.test(anon) && !/roomStickerGroups/.test(anon) && !/sticker_glyph/.test(anon)
      ? ok('stickers removed: no sticker allowlist/payload/glyph on server or client')
      : fail('sticker remnants still present in server or AnonymousRoom.jsx'),
  );
  checks.push(
    /olderError/.test(anon) && /prefersReducedMotion/.test(anon) &&
      /togglePref/.test(anon) && /savePreferences/.test(anon)
      ? ok('AnonymousRoom.jsx: load-earlier retry + reduced-motion + per-kind notification toggles')
      : fail('AnonymousRoom.jsx missing v44 client features (retry/reduced-motion/prefs)'),
  );
  checks.push(
    /drop constraint if exists community_posts_content_check/.test(migrationV45Src)
      ? ok('migration-v45: community_posts content check relaxed (blank Encoded content allowed)')
      : fail('migration-v45 missing the content-check relaxation'),
  );

  // v46: anonymous-room corrections — central server_config, 10-min lifetime with
  // vote adjustments, social ACTION set + fight detection, membership activity,
  // and atomic first-visitor room creation.
  const migrationV46Src = read(resolve(ROOT, 'scripts/migration-v46-anonymous-room-corrections.sql'));
  checks.push(
    /server_config/.test(migrationV46Src) && /community_apply_vote_expiry/.test(migrationV46Src) &&
      /community_fight_check/.test(migrationV46Src) && /community_membership_reconcile/.test(migrationV46Src) &&
      /community_ensure_anonymous_room/.test(migrationV46Src) && /anonymous_combat_events/.test(migrationV46Src) &&
      /base_expires_at/.test(migrationV46Src)
      ? ok('migration-v46: server_config + vote-expiry + fight + membership + first-visitor RPCs')
      : fail('migration-v46 missing v46 tables/functions'),
  );
  checks.push(
    /community_presence_reap/.test(migrationV46Src) && /presence_reaped/.test(migrationV46Src) &&
      !/members_released/.test(migrationV46Src)
      ? ok('migration-v46: presence reap is presence-only (seat release owned by reconcile)')
      : fail('migration-v46 presence reap not redefined as presence-only'),
  );
  checks.push(
    /ROOM_ACTIONS/.test(apiCommunitySrc) && /ATTACK_ACTION_KEYS/.test(apiCommunitySrc) &&
      /ensureAnonRoom/.test(apiCommunitySrc) && /applyVoteExpiry/.test(apiCommunitySrc) &&
      /reconcileMembership/.test(apiCommunitySrc) && /community_fight_check/.test(apiCommunitySrc)
      ? ok('api/_community.js: v46 action set + first-visitor + vote-expiry + fight + membership')
      : fail('api/_community.js missing v46 server logic'),
  );
  checks.push(
    /config\?\.actions/.test(anon)
      ? ok('AnonymousRoom.jsx consumes the server ACTION set from config')
      : fail('AnonymousRoom.jsx not wired to the v46 action set'),
  );
  checks.push(
    /fightAlert/.test(anon) && /memberWarning/.test(anon) && /markActivity/.test(anon)
      ? ok('AnonymousRoom.jsx: fight banner + membership warning + activity stamping')
      : fail('AnonymousRoom.jsx missing v46 fight/membership client wiring'),
  );
  checks.push(
    /capacity: typeof group\.member_limit/.test(apiCommunitySrc) &&
      /room\?\.config\?\.membership\?\.capacity/.test(anon)
      ? ok('membership capacity exposed from the real member_limit + consumed from config')
      : fail('membership capacity not server-derived and config-driven'),
  );
  checks.push(
    /releasedNotice/.test(anon) && /detectRelease/.test(anon) && /Return to Home/.test(anon)
      ? ok('AnonymousRoom.jsx: released-member detection + explanation + homepage redirect')
      : fail('AnonymousRoom.jsx missing released-member redirect flow'),
  );
  checks.push(
    /\.members/.test(anon) && /·/.test(anon) && / online/.test(anon) &&
      /A heartbeat or open tab does not count/.test(anon)
      ? ok('AnonymousRoom.jsx: "N/capacity members · M online" status + explicit activity rule')
      : fail('AnonymousRoom.jsx status/rule copy not updated for membership model'),
  );

  // Phase 3: "Load earlier messages" is never a dead end — the server only
  // reports has_more when an ALIVE older message exists, and the client keeps
  // the control only when there is genuinely more (with an inline retry).
  checks.push(
    /hasOlderAlive/.test(apiCommunitySrc) && /has_more: hasMore/.test(apiCommunitySrc) &&
      /next_before: nextBefore/.test(apiCommunitySrc)
      ? ok('api/_community.js: feed pagination reports has_more only when an alive older message exists')
      : fail('api/_community.js feed pagination not hardened against an empty "load earlier" page'),
  );
  checks.push(
    /feed\.has_more && older\.length > 0/.test(anon) && /olderError/.test(anon) &&
      /next_before/.test(anon) && /Retry earlier messages/.test(anon)
      ? ok('AnonymousRoom.jsx: "load earlier" hides on empty page + inline retry on failure')
      : fail('AnonymousRoom.jsx "load earlier" empty-state/retry not handled'),
  );
  checks.push(
    /upvote_adjust_applied/.test(migrationV46Src) && /downvote_adjust_applied/.test(migrationV46Src) &&
      /community_apply_vote_expiry/.test(migrationV46Src)
      ? ok('migration-v46: once-only vote adjustments (+3min ≥7 up / -3min ≥10 down)')
      : fail('migration-v46 vote adjustments are not once-only'),
  );

  // v47: stickers fully removed (drop the sticker-only column; tag/encoded kept).
  const migrationV47Src = read(resolve(ROOT, 'scripts/migration-v47-anonymous-remove-stickers.sql'));
  checks.push(
    /anonymous_message_meta/.test(migrationV47Src) && /drop column if exists sticker/.test(migrationV47Src) &&
      !/drop column if exists tag/.test(migrationV47Src) && !/drop column if exists is_encoded/.test(migrationV47Src)
      ? ok('migration-v47: sticker column dropped (tag + encoded preserved)')
      : fail('migration-v47 does not drop only the sticker column'),
  );

  // v28: the quota/difficulty RPC surface is fully locked to service_role.
  const migrationV28Src = read(resolve(ROOT, 'scripts/migration-v28-server-only-rpcs.sql'));
  checks.push(
    /consume_course_quota\(uuid, text, integer, boolean\)/.test(migrationV28Src) &&
      /consume_course_quota\(uuid, text, integer, boolean, uuid\)/.test(migrationV28Src) &&
      /get_course_quota_status\(uuid\)/.test(migrationV28Src) &&
      /record_difficulty_correct\(uuid, text\)/.test(migrationV28Src) &&
      /record_difficulty_correct\(uuid, text, text\)/.test(migrationV28Src) &&
      /get_difficulty_status\(uuid\)/.test(migrationV28Src) &&
      /get_difficulty_status\(uuid, text\)/.test(migrationV28Src) &&
      /reset_course_quota\(uuid\)/.test(migrationV28Src)
      ? ok('migration-v28: every quota/difficulty RPC overload locked to service_role')
      : fail('migration-v28 missing an RPC overload lockdown'),
  );

  // P1: one shared, deduped refresh path (apexFetch) used by the API client + app.
  const apexFetchSrc = read(resolve(ROOT, 'src/utils/apexFetch.js'));
  const communityApiSrc = read(resolve(ROOT, 'src/utils/communityApi.js'));
  const appCtxSrc = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  checks.push(
    /export async function ensureFreshSessionToken/.test(apexFetchSrc) && /export class ApiError/.test(apexFetchSrc) && /export async function apiFetch/.test(apexFetchSrc)
      ? ok('apexFetch.js: shared ensureFreshSessionToken + ApiError + apiFetch')
      : fail('apexFetch.js missing shared auth fetch primitives'),
  );
  checks.push(
    /apiFetch\(/.test(communityApiSrc) && /from '\.\/apexFetch'/.test(communityApiSrc)
      ? ok('communityApi.js wraps the shared apiFetch (auth-aware, 401 replay)')
      : fail('communityApi.js not wired to shared apiFetch'),
  );
  checks.push(
    /from '\.\.\/utils\/apexFetch'/.test(appCtxSrc) && /ensureFreshSessionToken/.test(appCtxSrc)
      ? ok('AppContext uses the shared ensureFreshSessionToken (single refresh path)')
      : fail('AppContext not using shared ensureFreshSessionToken'),
  );
  checks.push(
    /\/anonymous\/\$\{id\}/.test(grp) && grp.includes('<Navigate to={`/anonymous/${id}`} replace />')
      ? ok('GroupPage.jsx redirects anonymous groups to /anonymous/:id (no anon UI left)')
      : fail('GroupPage.jsx is missing the anonymous redirect'),
  );
  checks.push(
    !/isAnonymousGroup|handleAnonJoin|anonymous_spectate|groups\/panel/.test(grp)
      ? ok('GroupPage.jsx stripped of the old anonymous panel/join/spectator code')
      : fail('GroupPage.jsx still contains anonymous-room code'),
  );
  checks.push(
    sg.includes('/anonymous/${group.id}')
      ? ok('StudyGroups.jsx opens the Anonymous room at /anonymous/:id')
      : fail('StudyGroups.jsx does not route anonymous groups to /anonymous/:id'),
  );
  checks.push(
    apiCm.includes('parseId') && /UUID_RE/.test(apiCm) && !/Number\(req\.body\?\.(post_id|comment_id)\)/.test(apiCm)
      ? ok('api/_community.js accepts uuid post/comment ids (parseId) — Number(uuid) bug fixed')
      : fail('api/_community.js still coerces uuid ids with Number()'),
  );
  checks.push(
    /ROOM_REACTIONS\s*=\s*\[/.test(apiCm) && /ROOM_REACTIONS\.includes\(emoji\)/.test(apiCm)
      ? ok('api/_community.js reaction whitelist enforced server-side (ROOM_REACTIONS)')
      : fail('api/_community.js missing the reaction whitelist'),
  );
  checks.push(
    /INVALID_MENTION/.test(apiCm) && /anonymous_room_identities/.test(apiCm)
      ? ok('api/_community.js validates @Anonymous #NN mentions against room identities')
      : fail('api/_community.js missing mention validation'),
  );

  // Migration v39: focused anonymous-room schema (replies, reactions, aliases,
  // 10/5 thresholds, author_id mask).
  const mig39 = read(resolve(ROOT, 'scripts/migration-v39-anonymous-room.sql'));
  checks.push(
    /reply_to_post_id uuid references public\.community_posts/.test(mig39)
      ? ok('v39: community_posts.reply_to_post_id (direct message replies) present')
      : fail('v39 migration missing reply_to_post_id'),
  );
  checks.push(
    /community_post_reactions/.test(mig39) && /primary key \(post_id, user_id, emoji\)/.test(mig39)
      ? ok('v39: community_post_reactions PK (post,user,emoji) keeps counts un-inflatable')
      : fail('v39 migration missing reactions table/PK'),
  );
  checks.push(
    /anonymous_room_identities/.test(mig39) && /alias integer not null check \(alias between 1 and 9999\)/.test(mig39) && /unique \(group_id, alias\)/.test(mig39)
      ? ok('v39: anonymous_room_identities (random room-scoped Anonymous #NN, unique per room)')
      : fail('v39 migration missing room identity table/constraints'),
  );
  checks.push(
    /alter column minimum_members_to_activate set default 10/.test(mig39) && /alter column minimum_members_to_remain_active set default 5/.test(mig39) && /where type = 'anonymous'/.test(mig39)
      ? ok('v39: 10-to-activate / 5-to-survive thresholds set server-side for anonymous rooms')
      : fail('v39 migration missing the 10/5 room thresholds'),
  );
  checks.push(
    /revoke all on public\.community_post_reactions from public, anon, authenticated/.test(mig39) && /revoke all on public\.anonymous_room_identities from public, anon, authenticated/.test(mig39)
      ? ok('v39: new tables revoked from anon/authenticated (service-role only)')
      : fail('v39 migration does not lock the new tables from clients'),
  );
  checks.push(
    /delete from public\.anonymous_room_identities where group_id = p_group/.test(mig39)
      ? ok('v39: community_anonymous_wipe also shreds the round identities')
      : fail('v39 wipe function does not clean room identities'),
  );
  checks.push(
    /case when v_anon then null else p\.author_id end/.test(mig39)
      ? ok('v39: community_group_feed masks author_id to NULL for anonymous rooms')
      : fail('v39 does not fix the community_group_feed author_id leak'),
  );
  checks.push(
    /sg\.type = 'anonymous'/.test(mig39) && /create or replace function public\.community_post_viewer_allowed/.test(mig39) && /community_post_in_anonymous_room\(post_id\)/.test(mig39)
      ? ok('v39: RLS read-gate — client SELECTs/realtime on anon-room posts/comments/likes denied (service-role only)')
      : fail('v39 missing the anonymous-room RLS read-gate (author_id leak)'),
  );

  // Migration v40: the anonymous spectator pass is ₦499, normalized
  // server-side (no SC ledger, no new column, room-lifecycle expiry).
  const mig40 = read(resolve(ROOT, 'scripts/migration-v40-anonymous-spectator-price.sql'));
  checks.push(
    /spectator_price = 499/.test(mig40) && /where type = 'anonymous'/.test(mig40) && /is distinct from 499/.test(mig40)
      ? ok('v40: anonymous spectator price normalized to ₦499 (idempotent, server-authoritative)')
      : fail('v40 migration does not set the anonymous spectator price to 499'),
  );
  checks.push(
    !/_sc_apply|smart_coin|smart_coins/.test(mig40)
      ? ok('v40: no SC-ledger involvement (Paystack naira pass only)')
      : fail('v40 unexpectedly touches the Smart Coin ledger'),
  );

  // StudyGroups.jsx: anonymous join/leave + posts all routed, counts via RPC.
  checks.push(
    sg.includes("communityApi(session, '/groups/join'") && sg.includes("communityApi(session, '/groups/leave'")
      ? ok('StudyGroups.jsx anonymous join/leave uses the router')
      : fail('StudyGroups.jsx anonymous membership actions not via router'),
  );
  checks.push(
    /community_member_count/.test(sg) && /type === 'anonymous'/.test(sg)
      ? ok('StudyGroups.jsx surfaces anonymous waitlist/active counts via community_member_count')
      : fail('StudyGroups.jsx anonymous card count not RPC-backed'),
  );
  checks.push(
    sg.includes("communityApi(session, '/posts'") && sg.includes("communityApi(session, '/posts/like'") && sg.includes("communityApi(session, '/posts/reply'")
      ? ok('StudyGroups.jsx group posts/likes/replies all through the router')
      : fail('StudyGroups.jsx still writes group posts client-side'),
  );

  // CommunityHubWidget: like toggle centralized through the router.
  checks.push(
    /communityApi\(session, '\/posts\/like'/.test(hub)
      ? ok('CommunityHubWidget like toggle → /api/community/posts/like')
      : fail('CommunityHubWidget still toggles likes client-side'),
  );
}

// ---------------------------------------------------------------------------
// 9. CACHING + PERFORMANCE LAYER invariants (in-memory cache + CDN headers).
//    The cache must be in-memory-only, only public metadata may be TTL-cached,
//    and server-authoritative reads (quota/difficulty/feed) stay uncached.
// ---------------------------------------------------------------------------
{
  const vercel = JSON.parse(read(resolve(ROOT, 'vercel.json')));
  const { headers = [] } = vercel;
  const findHeader = (source) => {
    const rule = headers.find((h) => h.source === source);
    return rule ? Object.fromEntries(rule.headers.map((h) => [h.key, h.value])) : null;
  };

  const assetH = findHeader('/assets/(.*)');
  checks.push(
    assetH?.['Cache-Control']?.includes('31536000') && assetH?.['Cache-Control']?.includes('immutable')
      ? ok('vercel.json: /assets/* hashed assets -> Cache-Control public,max-age=31536000,immutable')
      : fail('vercel.json: /assets/* immutable cache header missing', JSON.stringify(assetH)),
  );
  const idxH = findHeader('/index.html');
  checks.push(
    idxH?.['Cache-Control'] && /max-age=0.*must-revalidate/.test(idxH['Cache-Control'])
      ? ok('vercel.json: /index.html shell -> Cache-Control no-cache + must-revalidate (always revalidates)')
      : fail('vercel.json: /index.html must-revalidate header missing', JSON.stringify(idxH)),
  );
  const apiH = findHeader('/api/(.*)');
  checks.push(
    apiH?.['Cache-Control']?.includes('no-store') && apiH?.['Cache-Control']?.includes('private')
      ? ok('vercel.json: /api/* always private,no-store (never cached — server-authoritative)')
      : fail('vercel.json: /api/* no-store header missing', JSON.stringify(apiH)),
  );

  // ---- src/utils/cache.js: in-memory only + right API ----
  const cacheSrc = read(resolve(ROOT, 'src/utils/cache.js'));
  checks.push(
    /localStorage|sessionStorage|indexedDB/.test(cacheSrc)
      ? fail('cache.js must be in-memory only (no localStorage/sessionStorage/indexedDB)')
      : ok('cache.js is purely in-memory (no persistent storage surface)'),
  );
  checks.push(
    ['cacheGet', 'cacheSet', 'cacheClearAll', 'dedupe', 'getCacheFirst'].every((f) => new RegExp(`export function ${f}|export const ${f}|export async function ${f}`).test(cacheSrc))
      ? ok('cache.js exports cacheGet/cacheSet/cacheClearAll/dedupe/getCacheFirst')
      : fail('cache.js missing a required export'),
  );
  const neverCachedKeys = ['quota', 'difficulty', 'payment', 'verify-payment', 'cooldown', 'session', 'membership', 'spectator'];
  const badTtl = neverCachedKeys.filter((k) => cacheSrc.includes(`'${k}:`) || cacheSrc.includes(`"${k}:`) || cacheSrc.toLowerCase().includes(`${k}:`));
  checks.push(
    badTtl.length === 0
      ? ok('cache.js opens NO TTL keys under any security-sensitive name (quota/difficulty/payment/session/…)')
      : fail('cache.js declares sensitive cache keys', badTtl.join(', ')),
  );

  // ---- AppContext.jsx: safe wiring ----
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  checks.push(
    /from '\.\.\/utils\/cache'/.test(app)
      ? ok('AppContext imports the cache utilities')
      : fail('AppContext does not import the cache utilities'),
  );
  checks.push(
    /getCacheFirst\('static:subscription-plans'/.test(app) && /cacheTtl\.STATIC/.test(app)
      ? ok('subscription_plans reads cache-first via static:subscription-plans (24h, public metadata)')
      : fail('subscription_plans not cached through the safe static key'),
  );
  checks.push(
    /dedupe\(`api:quota:course-status/.test(app)
      ? ok('quota status GET is in-flight-deduped ONLY (never TTL-cached / never cross-user)')
      : fail('quota status fetch must use dedupe, not getCacheFirst'),
  );
  checks.push(
    /dedupe\(`api:difficulty:\$\{uid\}:/.test(app)
      ? ok('difficulty GET is in-flight-deduped per user/course (never cached)')
      : fail('difficulty fetch must use dedupe, not getCacheFirst'),
  );
  checks.push(
    /authInitInFlight/.test(app) && /initAuth\(\)\.finally/.test(app)
      ? ok('initAuth has a canonical in-flight guard (no parallel getSession/refresh bursts)')
      : fail('initAuth in-flight guard missing'),
  );
  checks.push(
    /scheduleIdle\(async \(\) => \{\s*const \{ data: userCards \}/.test(app)
      ? ok('user_flashcards SRS read is deferred to idle (never blocks shell render)')
      : fail('user_flashcards read still blocks the shell load'),
  );
  checks.push(
    /const handle = scheduleIdle\(async \(\) => \{\s*let query = supabase\.from\('custom_flashcards'\)/.test(app) && /cancelIdle\(handle\)/.test(app)
      ? ok('custom_flashcards read is deferred to idle + cancelled on unmount')
      : fail('custom_flashcards read not deferred/cancellable'),
  );
  checks.push(
    app.includes('cacheClearAll()')
      ? ok('AppContext invalidates the whole cache on sign-out/SIGNED_OUT')
      : fail('AppContext missing cacheClearAll on identity change'),
  );

  // ---- Achievements.jsx: only the public definition catalog is cached ----
  const ach = read(resolve(ROOT, 'src/pages/Achievements.jsx'));
  checks.push(
    /getCacheFirst\('static:achievements'/.test(ach) && /cacheTtl\.STATIC/.test(ach)
      ? ok('Achievements catalogs definitions via static:achievements (24h, public metadata)')
      : fail('Achievements catalog not cached through the safe static key'),
  );
  checks.push(
    /unlockedByKey/.test(ach) && /userAchievements/.test(ach)
      ? ok('Achievements unlocked state still comes live from userAchievements (never cached)')
      : fail('Achievements unlocked-state sourcing regression'),
  );

  // ---- Community.jsx: ephemeral feed stays UNCACHED (dedupe only) ----
  const com = read(resolve(ROOT, 'src/pages/Community.jsx'));
  checks.push(
    /dedupe\('community:feed:p0'/.test(com)
      ? ok('community feed page-0 reads are in-flight-deduped (never TTL-cached)')
      : fail('community feed must use dedupe, not a TTL cache'),
  );
  checks.push(
    !/getCacheFirst\([^)]*community/.test(com)
      ? ok('no TTL-cached community content in Community.jsx (ephemeral posts stay live)')
      : fail('Community.jsx caches ephemeral community content'),
  );
  checks.push(
    /const stripExpired =/.test(com) && /lives_until/.test(com) && /Date\.now\(\)/.test(com)
      ? ok('Community.jsx display-filters expired posts by lives_until (defense-in-depth)')
      : fail('Community.jsx missing the client-side lives_until expiry filter'),
  );

  // ---- StudyGroups.jsx: anonymous counts deduped, not cached ----
  const sg = read(resolve(ROOT, 'src/components/StudyGroups.jsx'));
  checks.push(
    /dedupe\(`community:member-count:\$\{gid\}`/.test(sg)
      ? ok('anonymous member_count RPC bursts are in-flight-deduped per group (never cached)')
      : fail('StudyGroups member_count not in-flight-deduped'),
  );

  // ---- Flashcards stay disabled AND uncached ----
  const lib = read(resolve(ROOT, 'src/components/FlashcardLibrary.jsx'));
  checks.push(
    /HIGHLY CLASSIFIED/.test(lib) && !/cache|dedupe|getCacheFirst/.test(lib)
      ? ok('FlashcardLibrary still renders the HIGHLY CLASSIFIED gate with no cache involvement')
      : fail('FlashcardLibrary cache/feature regression'),
  );
}

// ---------------------------------------------------------------------------
// 10. GLOBAL PLAYER SCORE ranking invariants (migration v30 + server flow).
//     Score is server-authoritative: RLS blocks all client writes to
//     player_stats/quiz_batches/quiz_batch_questions/quiz_results, the award is
//     idempotent per batch, and the rank/leaderboard read via RPCs — with NO
//     new Vercel serverless functions (12-function Hobby ceiling preserved).
// ---------------------------------------------------------------------------
{
  const mig = read(resolve(ROOT, 'scripts/migration-v30-player-score.sql'));
  const svc = read(resolve(ROOT, 'api/_questionSelectionService.js'));
  const qb = read(resolve(ROOT, 'api/_quiz-batches.js'));
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));

  // No new deployable function for ranking: award flows through the existing
  // quiz.js router path and reads run client-side via RPCs.
  checks.push(
    !existsSync(resolve(ROOT, 'api/player-score.js')) && !existsSync(resolve(ROOT, 'api/leaderboard.js'))
      ? ok('no new api/*.js function added for player score/leaderboard (RPC + existing router only)')
      : fail('a ranking api/*.js file exists — would blow the 12-function ceiling'),
  );
  checks.push(
    /apply_quiz_batch_score/.test(svc) && /PGRST202|PGRST206/.test(svc)
      ? ok('completeBatch calls the atomic award RPC and FAILS SOFT if it is not deployed yet')
      : fail('_questionSelectionService.js award RPC missing or not fail-soft'),
  );
  checks.push(
    /difficulty: labelDifficulty,\s*subject: labelSubject,\s*durationSeconds: labelDuration,\s*groupId: labelGroupId/.test(qb)
      && !/req\.body\?\.score|req\.body\?\.total/.test(qb)
      ? ok('batch-complete accepts LABELS ONLY — the browser never supplies score/total')
      : fail('batch-complete still trusts a client score field'),
  );
  checks.push(
    /fetchGlobalRank[\s\S]*?supabase\.rpc\('get_my_player_rank'/.test(app)
      ? ok('AppContext.fetchGlobalRank reads the rank RPC (server-computed)')
      : fail('AppContext.fetchGlobalRank is not RPC-backed'),
  );
  checks.push(
    /authoritative = !!\s*\(serverResult && serverResult\.resultId != null\)/.test(app) && /if \(!authoritative\)\s*\{/.test(app)
      ? ok('recordQuizResult only writes quiz_results client-side when the server did NOT (pre-migration fallback)')
      : fail('recordQuizResult can still fabricate an authoritative result'),
  );

  // Migration tokens — every object required by the spec round-trip.
  checks.push(
    /create table if not exists public\.player_stats/.test(mig) && /create table if not exists public\.player_score_awards/.test(mig)
      ? ok('v30 migration creates player_stats + player_score_awards')
      : fail('v30 migration missing the score/award tables'),
  );
  checks.push(
    /idx_player_stats_score\s+on public\.player_stats \(player_score desc, correct_answers desc, score_achieved_at asc, user_id asc\)/.test(mig)
      ? ok('v30 migration creates the leaderboard-covering index (player_score DESC …)')
      : fail('v30 migration index missing/misordered'),
  );
  checks.push(
    /player_score_awards\s*\([\s\S]*?batch_id uuid primary key/.test(mig) && /on conflict \(batch_id\) do nothing/.test(mig)
      ? ok('v30 migration makes the award idempotent (batch_id PK + ON CONFLICT DO NOTHING)')
      : fail('v30 migration award idempotency missing'),
  );
  checks.push(
    /if not v_replay\s+and v_award\.batch_id is not null then[\s\S]*?v_fresh := true;[\s\S]*?insert into public\.player_stats/.test(mig) && /awarded', v_fresh/.test(mig)
      ? ok('v30 migration gates the player_stats credit on a FRESH award — a replayed completion can never double-credit')
      : fail('v30 migration can double-credit player_score on replay'),
  );
  checks.push(
    /alter table public\.quiz_results add column if not exists batch_id uuid;/ && /add constraint quiz_results_batch_id_key unique \(batch_id\)/.test(mig)
      ? ok('v30 migration locks one authoritative quiz_results row per batch (UNIQUE batch_id constraint)')
      : fail('v30 migration quiz_results.batch_id unique guard missing'),
  );
  checks.push(
    /alter table public\.player_stats enable row level security/ && /create policy "player_stats_self_read"[\s\S]*?for select[\s\S]*?using \(auth\.uid\(\) = user_id\)/.test(mig)
      ? ok('player_stats RLS is SELECT-own only — no client insert/update of score')
      : fail('v30 migration player_stats RLS not select-only'),
  );
  checks.push(
    /create policy "quiz_batches_own"[\s\S]*?for select/ && /create policy "batch_questions_own"[\s\S]*?for select/ && /drop policy if exists "quiz_results_all_own"/.test(mig)
      ? ok('batch tables downgraded to SELECT-only; quiz_results for-all insert policy dropped')
      : fail('v30 migration RLS lockdown incomplete'),
  );
  checks.push(
    /revoke all on function public\.apply_quiz_batch_score\(uuid, uuid, text, text, int, bigint\) from public, anon, authenticated;[\s\S]*?grant execute on function public\.apply_quiz_batch_score\(uuid, uuid, text, text, int, bigint\) to service_role;/.test(mig)
      && /revoke all on function public\.get_my_player_rank\(uuid\) from public, anon;[\s\S]*?grant execute on function public\.get_my_player_rank\(uuid\) to authenticated/.test(mig)
      && /revoke all on function public\.get_player_leaderboard\(int, int\) from public, anon;[\s\S]*?grant execute on function public\.get_player_leaderboard\(int, int\) to authenticated/.test(mig)
      ? ok('award RPC is service_role-only; rank/leaderboard RPCs are authenticated-readable')
      : fail('v30 migration RPC grants wrong'),
  );
}

// ---------------------------------------------------------------------------
// Google AdSense — CONTROLLED placements (Dashboard / Community / Voting only).
// ---------------------------------------------------------------------------
{
  const adsConfigPath = resolve(ROOT, 'src/config/ads.js');
  const adsLoaderPath = resolve(ROOT, 'src/utils/adsense.js');
  const adsManagerPath = resolve(ROOT, 'src/components/ads/AdSenseManager.jsx');
  const adsSlotPath = resolve(ROOT, 'src/components/ads/AdSenseSlot.jsx');

  checks.push(
    existsSync(adsConfigPath) && existsSync(adsLoaderPath) && existsSync(adsManagerPath) && existsSync(adsSlotPath)
      ? ok('controlled AdSense files exist (config/ads.js, utils/adsense.js, components/ads/*)')
      : fail('controlled AdSense files missing'),
  );

  const adsConfig = existsSync(adsConfigPath) ? read(adsConfigPath) : '';
  checks.push(
    /ca-pub-7731141426940208/.test(adsConfig)
      ? ok('AdSense publisher id ca-pub-7731141426940208 is configured')
      : fail('AdSense publisher id missing from src/config/ads.js'),
  );
  checks.push(
    /ADS_POLICY/.test(adsConfig) && /dashboard: true/.test(adsConfig) && /community: true/.test(adsConfig) && /voting: true/.test(adsConfig)
      && /quiz: false/.test(adsConfig) && /activeQuiz: false/.test(adsConfig) && /other: false/.test(adsConfig)
      ? ok('central ADS_POLICY enables only dashboard/community/voting (all else false)')
      : fail('central ADS_POLICY does not match the three-area allowlist'),
  );

  const html = read(resolve(ROOT, 'index.html'));
  const main = read(resolve(ROOT, 'src/main.jsx'));
  const appJsx = read(resolve(ROOT, 'src/App.jsx'));
  checks.push(
    !/googlesyndication|adsbygoogle/i.test(html) && !/googlesyndication|adsbygoogle/i.test(main)
      ? ok('AdSense loader is NEVER in index.html or main.jsx (no global injection)')
      : fail('AdSense loader leaked into a global template'),
  );
  checks.push(
    !/pagead2\.googlesyndication\.com/.test(appJsx) && /<AdSenseManager>/.test(appJsx)
      ? ok('App.jsx mounts the controlled AdSenseManager (never the raw script)')
      : fail('App.jsx is not using the controlled manager'),
  );

  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]);
  const urlOwners = walk(resolve(ROOT, 'src'))
    .filter((f) => /\.(js|jsx)$/.test(f))
    .filter((f) => /pagead2\.googlesyndication\.com/.test(read(f)))
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
  checks.push(
    urlOwners.length === 1 && urlOwners[0] === 'src/utils/adsense.js'
      ? ok('AdSense CDN URL exists in exactly one place — the singleton loader')
      : fail('AdSense CDN URL scattered across files', urlOwners.join(', ')),
  );

  const manager = read(adsManagerPath);
  checks.push(
    /if \(quizActive\) return false;/.test(manager) && /if \(!area\) return false;/.test(manager) && /if \(!session\) return false;/.test(manager)
      ? ok('ad manager requires a session, enforces the active-quiz override, and fails closed on unknown routes')
      : fail('ad manager missing session / active-quiz / fail-closed branch'),
  );
  checks.push(
    /loadAdSenseScript\(ADSENSE_CLIENT\)/.test(manager) && /if \(!adsEnabled\) return undefined;/.test(manager)
      ? ok('ad manager lazy-loads the script only when ads are enabled')
      : fail('ad manager is not route-gated for script loading'),
  );

  const loaderSrc = read(adsLoaderPath);
  checks.push(
    /document\.querySelector\(ADSENSE_SCRIPT_SELECTOR\)/.test(loaderSrc) && /if \(!loadPromise\)/.test(loaderSrc)
      ? ok('AdSense loader guards against duplicate <script> insertion')
      : fail('AdSense loader can insert duplicate scripts'),
  );

  const slot = read(adsSlotPath);
  checks.push(
    /if \(!adsEnabled \|\| !slotId\) return null;/.test(slot)
      ? ok('AdSenseSlot renders nothing on unauthorised routes')
      : fail('AdSenseSlot can render while ads are disabled'),
  );

  const studyGroups = read(resolve(ROOT, 'src/components/StudyGroups.jsx'));
  checks.push(
    !existsSync(resolve(ROOT, 'src/components/AdBanner.jsx')) && !/AdBanner|AdSenseSlot/.test(studyGroups)
      ? ok('legacy AdBanner removed; Study Groups (a forbidden page) shows no ad')
      : fail('legacy AdBanner or a forbidden-page placement remains'),
  );

  checks.push(
    /AdSenseSlot placement="dashboard-content"/.test(read(resolve(ROOT, 'src/pages/Dashboard.jsx')))
      && /AdSenseSlot placement="community-feed"/.test(read(resolve(ROOT, 'src/pages/Community.jsx')))
      && /AdSenseSlot placement="voting-content"/.test(read(resolve(ROOT, 'src/pages/Voting.jsx')))
      ? ok('ad placements wired: dashboard-content, community-feed, voting-content')
      : fail('allowed page placements missing'),
  );
  checks.push(
    !/AdSenseSlot/.test(read(resolve(ROOT, 'src/pages/Quiz.jsx')))
      && !/AdSenseSlot/.test(read(resolve(ROOT, 'src/pages/Flashcards.jsx')))
      ? ok('no ad slot mounted on Quiz or Flashcards')
      : fail('an ad slot is mounted on a forbidden page'),
  );
}

// ---------------------------------------------------------------------------
// PART A — Google AdSense SITE VERIFICATION SURFACE (public, crawlable root).
// These assert the files Google actually fetches: index.html (verification meta
// tag + crawlable content), /ads.txt, /robots.txt and /sitemap.xml — plus that
// no rewrite can serve the SPA shell for ads.txt (the production incident).
// ---------------------------------------------------------------------------
{
  const indexHtml = read(resolve(ROOT, 'index.html'));
  const adsJs = read(resolve(ROOT, 'src/config/ads.js'));
  const publisherId = (adsJs.match(/ca-pub-\d+/) || [])[0];
  const adsTxt = read(resolve(ROOT, 'public/ads.txt'));
  const robotsTxt = read(resolve(ROOT, 'public/robots.txt'));
  const sitemapXml = read(resolve(ROOT, 'public/sitemap.xml'));
  const vercelRaw = read(resolve(ROOT, 'vercel.json'));

  checks.push(
    publisherId === 'ca-pub-7731141426940208'
      ? ok('ads.js single source of truth publisher id is ca-pub-7731141426940208')
      : fail('unexpected publisher id in src/config/ads.js', publisherId || 'none'),
  );
  checks.push(
    publisherId && new RegExp(`<meta\\s+name="google-adsense-account"\\s+content="${publisherId}"`).test(indexHtml)
      ? ok('index.html declares <meta name="google-adsense-account"> matching ads.js')
      : fail('index.html missing/mismatched google-adsense-account meta tag'),
  );
  checks.push(
    /<link rel="canonical" href="https:\/\/www\.polynurse\.com\.ng\/"/.test(indexHtml)
      && /<meta name="description" content=".+"/.test(indexHtml)
      ? ok('index.html ships canonical URL + meta description for crawlers')
      : fail('index.html missing canonical/description'),
  );
  checks.push(
    !/pagead2\.googlesyndication\.com/.test(indexHtml) && !/adsbygoogle\.push/.test(indexHtml)
      ? ok('index.html contains no AdSense loader/snippet (controlled loader only)')
      : fail('AdSense loader snippet leaked into index.html'),
  );

  const expectedAdsLine = `google.com, ${publisherId ? publisherId.replace(/^ca-/, '') : 'pub-??.0208'}, DIRECT, f08c47fec0942fa0`;
  checks.push(
    adsTxt.trim() === expectedAdsLine
      ? ok('public/ads.txt is the exact AdSense authorization line')
      : fail('public/ads.txt content unexpected', `expected "${expectedAdsLine}"`),
  );

  checks.push(
    /User-agent:\s*Mediapartners-Google\s*\nAllow:\s*\//.test(robotsTxt)
      && /User-agent:\s*Googlebot\s*\nAllow:\s*\//.test(robotsTxt)
      && /User-agent:\s*Google-Display-Ads-Bot\s*\nAllow:\s*\//.test(robotsTxt)
      ? ok('robots.txt explicitly allows Mediapartners-Google / Googlebot / Google-Display-Ads-Bot')
      : fail('robots.txt does not allow the Google ad/verification crawlers'),
  );
  checks.push(
    /Sitemap:\s*https:\/\/www\.polynurse\.com\.ng\/sitemap\.xml/.test(robotsTxt)
      && /<loc>https:\/\/www\.polynurse\.com\.ng\/<\/loc>/.test(sitemapXml)
      ? ok('robots.txt points at the sitemap and sitemap lists the public root')
      : fail('sitemap wiring missing'),
  );
  // The production incident: ads.txt was served as the SPA HTML shell.
  checks.push(
    !/ads\.txt/.test(vercelRaw)
      ? ok('vercel.json does not rewrite ads.txt (static file wins)')
      : fail('vercel.json rewrites ads.txt'),
  );
  checks.push(
    !/robots\.txt/.test(vercelRaw)
      ? ok('vercel.json does not rewrite robots.txt (static file wins)')
      : fail('vercel.json rewrites robots.txt'),
  );

  // Public crawlable shell: real content in the INITIAL HTML, revealed without
  // JS, sitting inside #root so React replaces it on boot.
  const shellInRoot = (() => {
    const rootOpen = indexHtml.indexOf('<div id="root">');
    const shellOpen = indexHtml.indexOf('class="apex-public-shell"');
    return rootOpen !== -1 && shellOpen > rootOpen && indexHtml.indexOf('<script type="module"') > shellOpen;
  })();
  checks.push(
    shellInRoot
      ? ok('index.html ships the public crawlable shell inside #root')
      : fail('public shell missing or not inside #root'),
  );
  checks.push(
    /<noscript>[\s\S]*\.apex-public-shell \{ display: block !important; \}/.test(indexHtml)
      && /class="apex-splash"/.test(indexHtml)
      ? ok('noscript rules reveal the shell and hide the splash')
      : fail('noscript reveal rules missing from index.html'),
  );
  checks.push(
    /\.apex-public-shell/.test(indexHtml) && /Create a free account/.test(indexHtml) && /href="\/signup"/.test(indexHtml) && /href="\/login"/.test(indexHtml)
      ? ok('public shell contains real PolyNurse content + signup/login entry points')
      : fail('public shell content missing'),
  );
  checks.push(
    /Boot watchdog|apex-splash/.test(indexHtml) && /setTimeout\(function/.test(indexHtml)
      ? ok('boot watchdog drops a stuck splash and reveals the shell')
      : fail('boot watchdog script missing from index.html'),
  );
  checks.push(
    /google-adsense-account/.test(indexHtml) && !/adsbygoogle/.test(indexHtml)
      ? ok('verification meta present with no adsbygoogle snippet (R7)')
      : fail('R7 invariant broken'),
  );
}

// ---------------------------------------------------------------------------
// PART B — NURSING LICENSE RENEWAL (S8). The whole flow is dispatched from the
// existing api/quiz.js function (Vercel Hobby 12-function cap), scored
// server-side, and its SC fee runs through the canonical _sc_apply ledger.
// ---------------------------------------------------------------------------
{
  const licenseSrc = existsSync(resolve(ROOT, 'api/_license.js')) ? read(resolve(ROOT, 'api/_license.js')) : '';
  const quizSrc = read(resolve(ROOT, 'api/quiz.js'));
  const vercelRaw = read(resolve(ROOT, 'vercel.json'));
  const serveSrc = read(resolve(ROOT, 'scripts/serve-api.mjs'));
  const v48 = existsSync(resolve(ROOT, 'scripts/migration-v48-license-renewal.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v48-license-renewal.sql')) : '';
  const v49 = existsSync(resolve(ROOT, 'scripts/migration-v49-sc-ledger-ref-id-text.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v49-sc-ledger-ref-id-text.sql')) : '';

  checks.push(
    existsSync(resolve(ROOT, 'api/_license.js'))
      && /export\s+async\s+function\s+handleLicenseStatus/.test(licenseSrc)
      && /export\s+async\s+function\s+handleLicenseStart/.test(licenseSrc)
      && /export\s+async\s+function\s+handleLicenseSubmit/.test(licenseSrc)
      ? ok('api/_license.js exports the 3 license handlers (underscore = not a separate function)')
      : fail('api/_license.js missing/incorrect handler exports'),
  );
  checks.push(
    /from '\.\/_license\.js'/.test(quizSrc)
      && /license\[-\/\]\(status\|start\|submit\)\$/.test(quizSrc)
      ? ok('api/quiz.js imports + dispatches license/status|start|submit')
      : fail('api/quiz.js does not dispatch the license sub-routes'),
  );
  checks.push(
    /\{\s*"source":\s*"\/api\/license\/:path\*",\s*"destination":\s*"\/api\/quiz"\s*\}/.test(vercelRaw)
      ? ok('vercel.json rewrites /api/license/:path* -> /api/quiz')
      : fail('vercel.json missing the /api/license/:path* rewrite'),
  );
  checks.push(
    /source:\s*'\/api\/license\/:path\*',\s*destination:\s*'\/api\/quiz',\s*prefix:\s*true/.test(serveSrc)
      ? ok('serve-api.mjs mirrors the /api/license/:path* rewrite')
      : fail('serve-api.mjs missing the license rewrite (local != prod)'),
  );

  // Server authority: fee via _sc_apply + client request id; answers stripped;
  // submit re-scores from persisted rows (never a client score/pass).
  checks.push(
    /rpc\('_sc_apply'/.test(licenseSrc) && /p_client_request_id:\s*requestId/.test(licenseSrc)
      ? ok('license start charges the fee via canonical _sc_apply (idempotent on requestId)')
      : fail('license start does not use the canonical idempotent SC fee'),
  );
  checks.push(
    /SENSITIVE_Q_FIELDS/.test(licenseSrc) && /\.map\(stripSensitive\)/.test(licenseSrc)
      ? ok('license start strips sensitive answer fields from the exam payload')
      : fail('license exam payload does not strip answers/rationale'),
  );
  checks.push(
    /from\('quiz_batch_questions'\)[\s\S]{0,120}select\('answered, correct'\)/.test(licenseSrc)
      && /license_apply_result/.test(licenseSrc)
      ? ok('license submit re-scores from persisted server-graded rows (client score ignored)')
      : fail('license submit does not re-score server-side'),
  );

  // Migration v48 objects.
  checks.push(
    /create table if not exists public\.nursing_licenses/.test(v48)
      && /create table if not exists public\.license_renewal_attempts/.test(v48)
      && /create or replace function public\.license_ensure/.test(v48)
      && /create or replace function public\.license_apply_result/.test(v48)
      ? ok('migration-v48: license + attempts tables and license_ensure/apply_result RPCs')
      : fail('migration-v48 missing the license tables/RPCs'),
  );
  checks.push(
    /nursing_licenses_select_own/.test(v48) && /license_attempts_select_own/.test(v48)
      && /grant execute on function public\.license_ensure\(uuid\) to service_role/.test(v48)
      ? ok('migration-v48: read-own RLS + service_role-only RPC grants')
      : fail('migration-v48 RLS/grants incomplete'),
  );
  checks.push(
    /'license_renewal'/.test(v48) && /"fee_sc":100/.test(v48) && /"question_count":50/.test(v48) && /"pass_pct":80/.test(v48)
      ? ok('migration-v48 seeds the license_renewal config (100 SC / 50 Q / 80%)')
      : fail('migration-v48 license config seed missing'),
  );
  checks.push(
    /alter column ref_id type text using ref_id::text/.test(v49)
      ? ok('migration-v49 widens smart_coin_ledger.ref_id to text (fixes _sc_apply with a ref id)')
      : fail('migration-v49 ref_id type fix missing'),
  );

  // Client wiring.
  const licenseApiSrc = existsSync(resolve(ROOT, 'src/utils/licenseApi.js')) ? read(resolve(ROOT, 'src/utils/licenseApi.js')) : '';
  const appSrc = read(resolve(ROOT, 'src/App.jsx'));
  const sidebarSrc = read(resolve(ROOT, 'src/components/Sidebar.jsx'));
  const dashSrc = read(resolve(ROOT, 'src/pages/Dashboard.jsx'));
  checks.push(
    /fetchLicenseStatus/.test(licenseApiSrc) && /startLicenseRenewal/.test(licenseApiSrc) && /submitLicenseRenewal/.test(licenseApiSrc)
      ? ok('src/utils/licenseApi.js exposes status/start/submit helpers')
      : fail('src/utils/licenseApi.js missing helpers'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'src/pages/LicenseRenewal.jsx'))
      && /LicenseRenewal/.test(appSrc) && /path="\/license"/.test(appSrc)
      ? ok('LicenseRenewal page exists + lazy /license route registered')
      : fail('LicenseRenewal page/route missing'),
  );
  checks.push(
    /Nursing License/.test(sidebarSrc) && /path: '\/license'/.test(sidebarSrc)
      && /LicenseCard/.test(dashSrc) && /fetchLicenseStatus/.test(dashSrc)
      ? ok('Sidebar link + Dashboard license status card wired')
      : fail('Sidebar/Dashboard license entry missing'),
  );
}

// ---------------------------------------------------------------------------
// PART C — LOAN SHARK (S9). SC-only peer-to-peer lending dispatched from the
// existing api/quiz.js function; every balance change runs through the v50 RPCs
// on top of the canonical _sc_apply ledger (no shadow wallet, no fiat).
// ---------------------------------------------------------------------------
{
  const loansSrc = existsSync(resolve(ROOT, 'api/_loans.js')) ? read(resolve(ROOT, 'api/_loans.js')) : '';
  const quizSrc = read(resolve(ROOT, 'api/quiz.js'));
  const vercelRaw = read(resolve(ROOT, 'vercel.json'));
  const serveSrc = read(resolve(ROOT, 'scripts/serve-api.mjs'));
  const v50 = existsSync(resolve(ROOT, 'scripts/migration-v50-loan-shark.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v50-loan-shark.sql')) : '';

  checks.push(
    existsSync(resolve(ROOT, 'api/_loans.js'))
      && /export\s+async\s+function\s+handleLoanList/.test(loansSrc)
      && /handleLoanRequest/.test(loansSrc) && /handleLoanAccept/.test(loansSrc)
      && /handleLoanRepay/.test(loansSrc) && /handleLoanSharkBuy/.test(loansSrc)
      && /handleLoanDefault/.test(loansSrc)
      ? ok('api/_loans.js exports the loan handlers (underscore = not a separate function)')
      : fail('api/_loans.js missing/incorrect handler exports'),
  );
  checks.push(
    /from '\.\/_loans\.js'/.test(quizSrc) && /handleLoanList/.test(quizSrc)
      && /shark-buy/.test(quizSrc) && /handleLoanDefault/.test(quizSrc)
      ? ok('api/quiz.js imports + dispatches /api/loans/(list|request|offer|accept|repay|reject|cancel|shark-buy|default)')
      : fail('api/quiz.js does not dispatch the loan sub-routes'),
  );
  checks.push(
    /\{\s*"source":\s*"\/api\/loans\/:path\*",\s*"destination":\s*"\/api\/quiz"\s*\}/.test(vercelRaw)
      ? ok('vercel.json rewrites /api/loans/:path* -> /api/quiz')
      : fail('vercel.json missing the /api/loans/:path* rewrite'),
  );
  checks.push(
    /source:\s*'\/api\/loans\/:path\*',\s*destination:\s*'\/api\/quiz',\s*prefix:\s*true/.test(serveSrc)
      ? ok('serve-api.mjs mirrors the /api/loans/:path* rewrite')
      : fail('serve-api.mjs missing the loans rewrite (local != prod)'),
  );

  // Migration v50: tables, config, RPCs, RLS + service_role grants.
  checks.push(
    /create table if not exists public\.loan_profiles/.test(v50)
      && /create table if not exists public\.loans/.test(v50)
      && /create or replace function public\.loan_request/.test(v50)
      && /create or replace function public\.loan_accept/.test(v50)
      && /create or replace function public\.loan_repay/.test(v50)
      && /create or replace function public\.loan_shark_buy/.test(v50)
      && /create or replace function public\.loan_mark_default/.test(v50)
      ? ok('migration-v50: loan_profiles + loans tables and the loan lifecycle RPCs')
      : fail('migration-v50 missing the loan tables/RPCs'),
  );
  checks.push(
    /"normal_max_active_loans":3/.test(v50) && /"shark_max_active_loans":10/.test(v50)
      && /"interest_pct":10/.test(v50) && /"repayment_window_hours":48/.test(v50)
      && /"shark_license_fee_sc":500/.test(v50) && /"shark_require_balance_sc":1500/.test(v50)
      ? ok('migration-v50 seeds the loan config (cap 3/10, 10%, 48h, fee 500 / balance 1500)')
      : fail('migration-v50 loan config seed missing'),
  );
  checks.push(
    /loan_profiles_select_own/.test(v50) && /loans_select_party/.test(v50)
      && /grant execute on function public\.loan_request\(uuid, integer, uuid, text\) to service_role/.test(v50)
      && /grant execute on function public\.loan_mark_default\(uuid, uuid\) to service_role/.test(v50)
      ? ok('migration-v50: read-own RLS + service_role-only RPC grants')
      : fail('migration-v50 RLS/grants incomplete'),
  );
  checks.push(
    /public\._sc_apply\(/.test(v50) && /loan_principal_out/.test(v50) && /loan_repayment/.test(v50)
      && /loan_default_recovery/.test(v50)
      ? ok('migration-v50 moves SC through the canonical _sc_apply ledger (P2P principal/repayment/recovery)')
      : fail('migration-v50 does not use the canonical SC ledger'),
  );

  // Client wiring.
  const loanApiSrc = existsSync(resolve(ROOT, 'src/utils/loanApi.js')) ? read(resolve(ROOT, 'src/utils/loanApi.js')) : '';
  const appSrc = read(resolve(ROOT, 'src/App.jsx'));
  const sidebarSrc = read(resolve(ROOT, 'src/components/Sidebar.jsx'));
  checks.push(
    /fetchLoans/.test(loanApiSrc) && /requestLoan/.test(loanApiSrc) && /acceptLoan/.test(loanApiSrc)
      && /repayLoan/.test(loanApiSrc) && /buySharkLicense/.test(loanApiSrc)
      ? ok('src/utils/loanApi.js exposes the loan helpers')
      : fail('src/utils/loanApi.js missing helpers'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'src/pages/LoanShark.jsx'))
      && /LoanShark/.test(appSrc) && /path="\/loans"/.test(appSrc)
      ? ok('LoanShark page exists + lazy /loans route registered')
      : fail('LoanShark page/route missing'),
  );
  checks.push(
    /Loan Shark/.test(sidebarSrc) && /path: '\/loans'/.test(sidebarSrc)
      ? ok('Sidebar Loan Shark link wired')
      : fail('Sidebar Loan Shark entry missing'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'scripts/e2e-loan-shark.mjs'))
      ? ok('scripts/e2e-loan-shark.mjs present (live loan lifecycle e2e)')
      : fail('scripts/e2e-loan-shark.mjs missing'),
  );
}

// PART D — ANONYMOUS ROOM STALE-MEMBERSHIP FIX (v51). `waiting` rooms must
// also release idle seats so the member count reflects only online members;
// the cron cleanup reconciles every anonymous room; and the client must not
// heartbeat presence as a non-member nor re-fetch already-expired messages.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const v51 = existsSync(resolve(ROOT, 'scripts/migration-v51-anonymous-waiting-reconcile.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v51-anonymous-waiting-reconcile.sql')) : '';

  checks.push(
    /create or replace function public\.community_membership_reconcile/.test(v51)
      && /elsif v_gr\.group_state = 'waiting' then/.test(v51)
      ? ok('migration-v51: community_membership_reconcile releases idle seats in WAITING rooms too')
      : fail('migration-v51 waiting-room reconcile branch missing'),
  );
  checks.push(
    /v_gr\.group_state = 'active' then/.test(v51)
      && /community_anonymous_wipe\(p_group\)/.test(v51)
      && /minimum_members_to_remain_active/.test(v51)
      ? ok('migration-v51 keeps the active-state warning + wipe watchdog intact')
      : fail('migration-v51 dropped the active-state wipe watchdog'),
  );
  checks.push(
    /delete from public\.study_group_members m\s+using public\.study_groups g/.test(v51)
      && /g\.group_state = 'waiting'/.test(v51)
      ? ok('migration-v51 one-time self-heal deletes already-stale waiting seats')
      : fail('migration-v51 self-heal delete missing'),
  );
  checks.push(
    /grant execute on function public\.community_membership_reconcile\(bigint, integer, integer\)\s+to service_role/.test(v51)
      ? ok('migration-v51 re-asserts the service_role-only grant')
      : fail('migration-v51 grant missing'),
  );
  checks.push(
    /community_presence_reap/.test(communitySrc)
      && /community_membership_reconcile/.test(communitySrc)
      && /seats_reconciled/.test(communitySrc)
      ? ok('api/_community.js cleanup reconciles seats for every anonymous room (cron self-heal)')
      : fail('api/_community.js cleanup does not reconcile membership'),
  );
  checks.push(
    /const canPresence = isMember \|\| isSpectator/.test(roomSrc)
      && /if \(!canPresence \|\| !groupId\) return undefined/.test(roomSrc)
      ? ok('AnonymousRoom presence heartbeat gated to member/spectator (no 403 for join/closed)')
      : fail('AnonymousRoom presence heartbeat not gated'),
  );
  checks.push(
    !/expiringRef/.test(roomSrc)
      && /lives <= now\) removeMessage\(m\.id\)/.test(roomSrc)
      ? ok('AnonymousRoom drops already-expired messages locally (no /anonymous/message 404 spam)')
      : fail('AnonymousRoom still re-fetches expired messages'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v52-premium-grant-two-users.sql'))
      ? ok('scripts/migration-v52-premium-grant-two-users.sql present (1-month grants)')
      : fail('scripts/migration-v52-premium-grant-two-users.sql missing'),
  );
}

// PART E — WEB PUSH ENABLED + WHATSAPP-STYLE REPLY.
// Push was a double no-op (no VAPID keys + no web-push dep); the client hides
// Reply behind a hover-only menu. These gates keep push configured and the
// reply affordance discoverable on touch.
// ---------------------------------------------------------------------------
{
  const pkg = existsSync(resolve(ROOT, 'package.json'))
    ? JSON.parse(read(resolve(ROOT, 'package.json'))) : null;
  const pushSrc = existsSync(resolve(ROOT, 'api/_push.js'))
    ? read(resolve(ROOT, 'api/_push.js')) : '';
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const envSample = existsSync(resolve(ROOT, '.env.example'))
    ? read(resolve(ROOT, '.env.example')) : '';

  checks.push(
    !!pkg && !!pkg.dependencies?.['web-push']
      ? ok('package.json depends on web-push (real push delivery, not a no-op)')
      : fail('package.json does not list web-push'),
  );
  checks.push(
    /VAPID_PUBLIC_KEY/.test(pushSrc)
      && /VAPID_PRIVATE_KEY/.test(pushSrc)
      && /import\('web-push'\)/.test(pushSrc)
      && /export const isPushEnabled/.test(pushSrc)
      ? ok('api/_push.js gates on VAPID keys and lazy-loads web-push (graceful no-op kept)')
      : fail('api/_push.js VAPID / web-push wiring missing'),
  );
  checks.push(
    /process\.env\.VAPID_PUBLIC_KEY \|\| null/.test(communitySrc)
      && /enabled: !!\(process\.env\.VAPID_PUBLIC_KEY && process\.env\.VAPID_PRIVATE_KEY\)/.test(communitySrc)
      ? ok('/notifications/vapid returns the public key + enabled flag')
      : fail('/notifications/vapid handler not reporting enabled'),
  );
  checks.push(
    /SWIPE_REPLY_THRESHOLD = 64/.test(roomSrc)
      && /const beginSwipe = useCallback/.test(roomSrc)
      && /const endSwipe = useCallback/.test(roomSrc)
      && /touch-pan-y/.test(roomSrc)
      && /setPointerCapture/.test(roomSrc)
      ? ok('AnonymousRoom swipe-to-reply wired (touch, pointer-captured, vertical scroll preserved)')
      : fail('AnonymousRoom swipe-to-reply missing'),
  );
  checks.push(
    /\.select\('id, group_id, created_at, expires_at, grace_until, last_interaction_at, is_deleted, is_hidden'\)/.test(communitySrc)
      ? ok('reply-parent check selects the post-lifetime columns so isPostAlive can judge living parents')
      : fail('reply-parent check selects a bare row -> every anonymous reply would 404 REPLY_NOT_FOUND'),
  );
  checks.push(
    !/opacity-0 group-hover:opacity-100/.test(roomSrc)
      && /opacity-70 group-hover:opacity-100/.test(roomSrc)
      ? ok('message action trigger is always visible (discoverable on touch, not hover-only)')
      : fail('message action trigger still hover-only'),
  );
  checks.push(
    /VAPID_PUBLIC_KEY=/.test(envSample)
      && /VAPID_PRIVATE_KEY=/.test(envSample)
      && /VAPID_SUBJECT=mailto:/.test(envSample)
      ? ok('.env.example documents the three VAPID_* placeholders')
      : fail('.env.example VAPID placeholders missing'),
  );
}

// ---------------------------------------------------------------------------
// PART F — ANONYMOUS ROOM EVENT CARDS + CHALLENGE RESPOND + ANTI-SLAM + REVEAL (v53).
// Actions became interleaved event cards (React/Respond), a single Actions
// sheet replaced inline chips, CHALLENGE accept starts a fresh fight, an
// anti-slam rate cap + "declining interactions" opt-out, and Encoded Messages
// gained a recipient-driven public reveal / re-lock.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const routerSrc = read(resolve(ROOT, 'api/community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const soundSrc = existsSync(resolve(ROOT, 'src/utils/anonSound.js'))
    ? read(resolve(ROOT, 'src/utils/anonSound.js')) : '';
  const migrationSrc = existsSync(resolve(ROOT, 'scripts/migration-v53-anonymous-social-events.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v53-anonymous-social-events.sql')) : '';

  // --- server model ---
  checks.push(
    /anonymous_room_events/.test(communitySrc)
      && /anonymous_event_reactions/.test(communitySrc)
      && /anonymous_room_member_prefs/.test(communitySrc)
      ? ok('v53 event tables referenced (events / event reactions / member prefs)')
      : fail('v53 event tables not referenced in api/_community.js'),
  );
  checks.push(
    /SOCIAL_RATE_CAP = 10/.test(communitySrc)
      && /SOCIAL_RATE_WINDOW_MS = 60_000/.test(communitySrc)
      && /EVENT_FEED_LIMIT = 50/.test(communitySrc)
      ? ok('v53 anti-slam constants present (rate cap + window + event feed limit)')
      : fail('v53 anti-slam constants missing'),
  );
  checks.push(
    /export async function handleAnonEvent\(/.test(communitySrc)
      && /export async function handleAnonEventReact\(/.test(communitySrc)
      && /export async function handleAnonEventRespond\(/.test(communitySrc)
      && /export async function handleAnonPrefs\(/.test(communitySrc)
      ? ok('v53 handlers exported (event / event-react / event-respond / prefs)')
      : fail('v53 event handlers not exported'),
  );
  checks.push(
    /SOCIAL_DECLINED/.test(communitySrc)
      && /SOCIAL_BLOCKED/.test(communitySrc)
      && /SOCIAL_RATE_LIMITED/.test(communitySrc)
      && /resolveAliasToUser\(group\.id, aliasNum\)/.test(communitySrc)
      ? ok('handleAnonSocial enforces declining / blocked / rate cap and resolves target_alias')
      : fail('handleAnonSocial anti-slam / target_alias wiring missing'),
  );
  checks.push(
    /kind: isChallenge \? 'challenge' : 'action'/.test(communitySrc)
      && /status: isChallenge \? 'pending' : 'open'/.test(communitySrc)
      ? ok('an action/challenge insert records a masked event card row')
      : fail('event-card insert missing challenge/action kind + status'),
  );
  checks.push(
    /EVENT_RESOLVED/.test(communitySrc)
      && /from\('anonymous_fights'\)\.insert\(\{ group_id: group\.id, a_id: lo, b_id: hi \}\)/.test(communitySrc)
      && /action: 'fight'/.test(communitySrc)
      ? ok('accepting a CHALLENGE starts a fresh fight and surfaces a fight event card')
      : fail('challenge accept->fight wiring missing'),
  );
  checks.push(
    /if \(action === 'reveal'\)/.test(communitySrc)
      && /if \(action === 'unreveal'\)/.test(communitySrc)
      && /can_unreveal:/.test(communitySrc)
      && /revealed \? decodeEncoded\(encBody\.cipher\) : ''/.test(communitySrc)
      ? ok('Encoded Messages: recipient reveal + author/revealer re-lock + feed gating + can_unreveal')
      : fail('encoded reveal / unreveal / can_unreveal wiring missing'),
  );
  checks.push(
    /events = await hydrateRoomEvents\(group, eventRows\.reverse\(\), user\.id\)/.test(communitySrc)
      && /return res\.status\(200\)\.json\(\{ ok: true, messages, events, has_more: hasMore, next_before: nextBefore/.test(communitySrc)
      ? ok('feed returns interleaved events oldest-first alongside messages')
      : fail('feed does not return interleaved events'),
  );

  // --- routing (the client contract) ---
  checks.push(
    /fn: handleAnonEventReact/.test(routerSrc)
      && /fn: handleAnonEventRespond/.test(routerSrc)
      && /fn: handleAnonPrefs/.test(routerSrc)
      && /fn: handleAnonEvent\b/.test(routerSrc)
      ? ok('api/community.js dispatches event / event-react / event-respond / prefs')
      : fail('v53 dispatch routes missing from api/community.js'),
  );

  // --- client surface ---
  checks.push(
    /const RoomEventCard = \(/.test(roomSrc)
      && /const upsertEvent = useCallback/.test(roomSrc)
      && /const respondEvent = async/.test(roomSrc)
      && /const toggleEventReaction = async/.test(roomSrc)
      ? ok('AnonymousRoom renders RoomEventCard with react/respond helpers')
      : fail('AnonymousRoom event-card render/helpers missing'),
  );
  checks.push(
    /const openActionSheet = \(/.test(roomSrc)
      && /const sendSheetAction = async/.test(roomSrc)
      && /actionSheetOpen/.test(roomSrc)
      ? ok('AnonymousRoom uses a single Actions bottom sheet (inline tag chips removed)')
      : fail('AnonymousRoom action sheet missing'),
  );
  checks.push(
    /const toggleDeclining = async/.test(roomSrc)
      && /declining_interactions/.test(roomSrc)
      ? ok('AnonymousRoom exposes the "declining interactions" anti-slam opt-out')
      : fail('AnonymousRoom declining-interactions toggle missing'),
  );
  checks.push(
    /const revealEncoded = \(msg\) => setEncodedAction\(msg, 'decode'\)/.test(roomSrc)
      && /const revealToRoom = \(msg\) => setEncodedAction\(msg, 'reveal'\)/.test(roomSrc)
      && /const privateAgain = \(msg\) => setEncodedAction\(msg, 'unreveal'\)/.test(roomSrc)
      && /msg\.can_unreveal/.test(roomSrc)
      ? ok('AnonymousRoom wires decode + reveal-to-room + private-again (can_unreveal gated)')
      : fail('AnonymousRoom encoded reveal/re-lock UI missing'),
  );
  checks.push(
    /const mergedTimeline = useMemo/.test(roomSrc)
      && /String\(a\.item\.id\)\.localeCompare\(String\(b\.item\.id\)\)/.test(roomSrc)
      ? ok('AnonymousRoom merges events + messages into one timeline (numeric-id safe comparison)')
      : fail('AnonymousRoom timeline merge missing'),
  );
  checks.push(
    /playChallengeTone/.test(soundSrc)
      && /playLockTone/.test(soundSrc)
      && /playRevealTone/.test(soundSrc)
      ? ok('anonSound adds challenge / lock / reveal tones')
      : fail('anonSound new tones missing'),
  );
  checks.push(
    /anonymous_room_events/.test(migrationSrc)
      && /anonymous_event_reactions/.test(migrationSrc)
      && /anonymous_room_member_prefs/.test(migrationSrc)
      && /revealed_at/.test(migrationSrc)
      ? ok('migration v53 defines the event tables + reveal columns')
      : fail('migration v53 missing event tables / reveal columns'),
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