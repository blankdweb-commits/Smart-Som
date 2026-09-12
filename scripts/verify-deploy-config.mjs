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
  for (const route of ['/posts/edit-comment$', '/posts/delete-comment$', '/posts/reply$', '/groups/feed$', '/groups/panel$']) {
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
    /post\.post_state === 'cold'/.test(com) && /Expiring soon/.test(com) && /lives_until/.test(com)
      ? ok('Community.jsx renders the ephemeral cold/expiring badge from server post_state')
      : fail('Community.jsx ephemeral badges missing'),
  );
  checks.push(
    !com.includes("from('community_posts').insert") && !com.includes("from('community_post_likes').insert") && !com.includes("from('community_comments').insert")
      ? ok('Community.jsx has no direct community table writes')
      : fail('Community.jsx still writes community tables directly'),
  );

  // GroupPage.jsx: anonymous mode via /groups/* API + hosted spectator checkout.
  checks.push(
    grp.includes("communityApi(session, '/groups/panel'") && grp.includes("communityApi(session, '/groups/feed'") && grp.includes("communityApi(session, '/groups/join'") && grp.includes("communityApi(session, '/groups/leave'")
      ? ok('GroupPage.jsx anonymous panel/feed/join/leave all use the router')
      : fail('GroupPage.jsx anonymous group actions not via /api/community'),
  );
  checks.push(
    /product: 'anonymous_spectate'/.test(grp) && /authorization_url/.test(grp)
      ? ok('GroupPage.jsx spectator pass uses hosted checkout (product anonymous_spectate)')
      : fail('GroupPage.jsx spectator purchase not wired to the hosted checkout'),
  );
  checks.push(
    /group_state === 'wiped'/.test(grp) && /isAnonymousGroup && !anonViewer/.test(grp)
      ? ok('GroupPage.jsx renders wiped/closed states and hides the board for non-viewers')
      : fail('GroupPage.jsx anonymous states/board masking missing'),
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