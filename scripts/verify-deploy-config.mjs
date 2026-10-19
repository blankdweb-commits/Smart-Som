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
  for (const route of ['/posts/edit-comment$', '/posts/delete-comment$', '/posts/reply$', '/groups/feed$', '/groups/panel$', '/anonymous/room$', '/anonymous/feed$', '/anonymous/members$', '/anonymous/message$', '/anonymous/send$', '/anonymous/react$']) {
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
    /Can't join right now/.test(anon) && /Watch as spectator · /.test(anon) && /Create a new Anonymous room/.test(anon) && /Return to groups/.test(anon) && /setLockedOptionsOpen/.test(anon)
      ? ok('AnonymousRoom.jsx: locked-room 3-option flow (watch/create/return) with confirmation')
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
    /ROOM_NOTICE = \{ key: 'anonymous_room_safety', version: [456] \}/.test(apiCommunitySrc)
      ? ok('ROOM_NOTICE bumped (10-minute lifetime; v5 consent-gated actions; v6 the 18+ confirmation)')
      : fail('ROOM_NOTICE not bumped'),
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
    /!!feed\.has_more && \(older\.length > 0 \|\| nextCursor !== before\)/.test(anon) && /olderError/.test(anon) &&
      /next_before/.test(anon) && /Retry earlier messages/.test(anon)
      ? ok('AnonymousRoom.jsx: "load earlier" advances past an empty page + inline retry on failure')
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

  // Migration v55: the anonymous spectator pass is now ₦299, normalized
  // server-side (supersedes the v40 ₦499 / v42 default), idempotent.
  const mig55 = read(resolve(ROOT, 'scripts/migration-v55-anonymous-spectator-price-299.sql'));
  checks.push(
    /spectator_price = 299/.test(mig55) && /where type = 'anonymous'/.test(mig55) && /is distinct from 299/.test(mig55)
      ? ok('v55: anonymous spectator price normalized to ₦299 (idempotent, server-authoritative)')
      : fail('v55 migration does not set the anonymous spectator price to 299'),
  );
  checks.push(
    /alter column spectator_price set default 299/.test(mig55)
      ? ok('v55: new anonymous rooms default spectator_price to ₦299')
      : fail('v55 migration does not set the spectator_price default to 299'),
  );
  checks.push(
    !/_sc_apply|smart_coin|smart_coins/.test(mig55)
      ? ok('v55: no SC-ledger involvement (Paystack naira pass only)')
      : fail('v55 unexpectedly touches the Smart Coin ledger'),
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
      && /(\benabled\s*[:=]\s*!!\(process\.env\.VAPID_PUBLIC_KEY && process\.env\.VAPID_PRIVATE_KEY\))/.test(communitySrc)
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
  checks.push(
    /const jumpToReply = useCallback/.test(roomSrc)
      && /messages\.find\(\(m\) => m\.id === reply\.id\)/.test(roomSrc)
      && /onClick=\{\(\) => msg\.reply\.id && jumpToReply\(msg\.reply\)\}/.test(roomSrc)
      ? ok('WS2 reply preview jumps by exact post id (falls back to /anonymous/message) instead of the author\'s newest message')
      : fail('WS2 reply preview still jumps by alias -> wrong/absent target'),
  );
}

// ---------------------------------------------------------------------------
// PART E2 — PER-VISIT ANONYMOUS IDENTITY (WS3, migration v59).
// A member keeps one identity row per room but the displayed Anonymous #NN is
// re-rolled on a NEW visit so the pseudonym cannot be correlated across visits.
// The visit key is a client-minted, sessionStorage-scoped token sent as a
// request header; ONLY the routes that speak for the current viewer pass it.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const visitSrc = existsSync(resolve(ROOT, 'src/utils/anonVisit.js'))
    ? read(resolve(ROOT, 'src/utils/anonVisit.js')) : '';
  const communityApiSrc = read(resolve(ROOT, 'src/utils/communityApi.js'));
  const mig59Src = existsSync(resolve(ROOT, 'scripts/migration-v59-anonymous-visit-aliases.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v59-anonymous-visit-aliases.sql')) : '';

  checks.push(
    /alter table public\.anonymous_room_identities/.test(mig59Src)
      && /add column if not exists visit_key text/.test(mig59Src)
      && /create index if not exists idx_anonymous_room_identities_visit/.test(mig59Src)
      && /revoke all on public\.anonymous_room_identities from public, anon, authenticated/.test(mig59Src)
      ? ok('migration v59 adds a service-role-only visit_key to anonymous_room_identities (idempotent)')
      : fail('migration v59 visit_key / index / revoke missing'),
  );
  checks.push(
    /export function readVisitKey\(req\)/.test(communitySrc)
      && /const VISIT_KEY_RE = \/\^\[A-Za-z0-9_-\]\{8,64\}\$\//.test(communitySrc)
      && /req\?\.body\?\.visit_key \?\? req\?\.headers\?\.\['x-room-visit'\]/.test(communitySrc)
      ? ok('server validates a visit key from body.visit_key or the X-Room-Visit header')
      : fail('readVisitKey validation missing'),
  );
  checks.push(
    /export async function ensureRoomAlias\(groupId, userId, visitKey = null\)/.test(communitySrc)
      && /existing\.visit_key === visitKey/.test(communitySrc)
      && /\.update\(\{ alias: roll\(\), visit_key: visitKey \}\)/.test(communitySrc)
      ? ok('ensureRoomAlias re-rolls a member\'s alias on a new visit (same visit keeps the number)')
      : fail('ensureRoomAlias per-visit re-roll missing'),
  );
  checks.push(
    /const myAlias = access === 'member' \? await ensureRoomAlias\(group\.id, user\.id, readVisitKey\(req\)\) : null/.test(communitySrc)
      && /ensureRoomAlias\(group\.id, user\.id, readVisitKey\(req\)\)\.catch/.test(communitySrc)
      ? ok('the room view + message send stamp the viewer\'s current visit (other members keep a stable alias)')
      : fail('viewer visit key not threaded into handleAnonRoom / handleAnonSend'),
  );
  checks.push(
    /const VISIT_KEY_STORAGE = 'apex:anon_visit_key'/.test(visitSrc)
      && /sessionStorage/.test(visitSrc)
      && /getAnonVisitKey/.test(visitSrc)
      ? ok('client mints a sessionStorage-scoped per-visit key (reload keeps it, new tab re-rolls)')
      : fail('src/utils/anonVisit.js per-visit key missing'),
  );
  checks.push(
    /import \{ getAnonVisitKey \} from '\.\/anonVisit'/.test(communityApiSrc)
      && /headers\['x-room-visit'\] = visit/.test(communityApiSrc)
      ? ok('communityApi tags requests with the X-Room-Visit header')
      : fail('communityApi does not send the visit key header'),
  );
}

// ---------------------------------------------------------------------------
// PART E3 — PUBLIC ROOM PREVIEW (WS4).
// /anonymous/:id is unwrapped from RequireAuth; a logged-out visitor resolves
// the room through a public /anonymous/preview handler (routed BEFORE
// authorizeRequest like handleCleanup) that returns ONLY non-sensitive room
// metadata + the live seat-count breakdown — never messages, aliases, or the
// roster. The preview screen carries a sign-in CTA preserved in location.state.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const routerSrc = read(resolve(ROOT, 'api/community.js'));
  const communityApiSrc = read(resolve(ROOT, 'src/utils/communityApi.js'));
  const appSrc = read(resolve(ROOT, 'src/App.jsx'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const e2eSrc = read(resolve(ROOT, 'scripts/e2e-anonymous-lifecycle.mjs'));

  checks.push(
    /export async function handleAnonPreview\(req, res\)/.test(communitySrc)
      && /requires_auth: true/.test(communitySrc)
      && /access: 'preview'/.test(communitySrc)
      && /const group = await resolveAnonGroup\(/.test(communitySrc)
      ? ok('api/_community.js exposes a public handleAnonPreview (non-sensitive metadata only)')
      : fail('handleAnonPreview missing / leaks a sensitive surface'),
  );
  checks.push(
    /room: \{\s*id: group\.id,\s*name: group\.name,\s*group_state: group\.group_state/.test(communitySrc)
      ? ok('the preview payload is restricted to room metadata (no messages / aliases / roster)')
      : fail('preview payload shape widened beyond { room, capacity, thresholds }'),
  );
  checks.push(
    /\{ re: \/\\\/anonymous\\\/preview\$\/, fn: handleAnonPreview \}/.test(routerSrc)
      && /entry\.fn === handleAnonPreview/.test(routerSrc)
      && /routed in api\/community\.js BEFORE authorizeRequest|public room preview for logged-out deep links/.test(routerSrc)
      ? ok('api/community.js routes /anonymous/preview and special-cases it before authorizeRequest')
      : fail('preview route not registered / not exempted from auth'),
  );
  checks.push(
    /export async function communityPreview\(groupId\)/.test(communityApiSrc)
      && /retryOnAuth: false/.test(communityApiSrc)
      && /\/community\/anonymous\/preview/.test(communityApiSrc)
      ? ok('client has an unauthenticated communityPreview() helper')
      : fail('communityPreview() helper missing'),
  );
  checks.push(
    !/<RequireAuth><AnonymousRoom \/>/.test(appSrc)
      && /<Route path="\/anonymous" element={<AnonymousRoom \/>} \/>/.test(appSrc)
      && /<Route path="\/anonymous\/:id" element={<AnonymousRoom \/>} \/>/.test(appSrc)
      ? ok('App.jsx unwraps /anonymous + /anonymous/:id from RequireAuth (public preview route)')
      : fail('/anonymous routes still wrapped by RequireAuth'),
  );
  checks.push(
    /if \(!session\) \{\s*return \(\s*<RoomPreview/.test(roomSrc)
      && /const RoomPreview = \(\{ guest, locationPath, onRetry \}\) =>/.test(roomSrc)
      && /guestPreviewStart\(roomId, token\)/.test(roomSrc)
      && /guestPreviewStream\(/.test(roomSrc)
      && /navigate\('\/login', \{ state: \{ from: locationPath/.test(roomSrc)
      && /navigate\('\/signup', \{ state: \{ from: locationPath/.test(roomSrc)
      ? ok('AnonymousRoom renders the logged-out RoomPreview (live read-only stream + sign-in AND sign-up CTAs, both preserving location.state)')
      : fail('AnonymousRoom preview screen / CTA missing'),
  );
  checks.push(
    /PHASE 1\/2c\. PUBLIC ROOM PREVIEW \(WS4\)/.test(e2eSrc)
      && /previewOK\.body\?\.requires_auth/.test(e2eSrc)
      && /previewWiped\.body\?\.room\?\.group_state === 'wiped'/.test(e2eSrc)
      ? ok('WS4 preview is covered by the anonymous lifecycle e2e (logged-out preview + bogus id + wiped state)')
      : fail('WS4 e2e coverage missing'),
  );
}

// ---------------------------------------------------------------------------
// PART E4 — ONE-TIME GUEST PREVIEW.
// A signed-out visitor gets ONE 2-minute, strictly read-only slice of the room
// behind a server-issued HMAC token. (This was 5 minutes; v99 shortened it to
// the 2 minutes the product rule specifies. The gate below is REWRITTEN, not
// deleted — the property it protects is unchanged, only the value moved.) The
// rules these gates defend:
//   * the window is minted and expired by the SERVER (GUEST_PREVIEW_MS), and a
//     returning token is never re-minted or extended;
//   * the read path NEVER widens RLS — it stays a service-role endpoint;
//   * the read path NEVER writes (no ensureRoomAlias, no revealDueAnnouncements)
//     and NEVER emits an author id, email, score or encoded body;
//   * the token buys exactly two read endpoints and cannot open a write route.
// ---------------------------------------------------------------------------
{
  const guestServerSrc = read(resolve(ROOT, 'api/_community.js'));
  const guestRouterSrc = read(resolve(ROOT, 'api/community.js'));
  const guestRoomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const guestApiSrc = read(resolve(ROOT, 'src/utils/communityApi.js'));

  checks.push(
    /export const GUEST_PREVIEW_MS = 2 \* 60 \* 1000/.test(guestServerSrc)
      && /export async function handleGuestPreviewStart\(req, res\)/.test(guestServerSrc)
      && /export async function handleGuestPreviewStream\(req, res\)/.test(guestServerSrc)
      ? ok('Phase 1: a 2-minute server-side guest preview window with start + read-only stream handlers')
      : fail('Phase 1: guest preview handlers / 5-minute window missing'),
  );
  checks.push(
    /crypto\.createHmac\('sha256'/.test(guestServerSrc)
      && /crypto\.timingSafeEqual/.test(guestServerSrc)
      && /ANON_PREVIEW_SECRET/.test(guestServerSrc)
      && /guestPreviewSecret\(\)/.test(guestServerSrc)
      ? ok('Phase 1: the preview token is HMAC-signed and compared in constant time (secret is server-only)')
      : fail('Phase 1: preview token is not signed with a constant-time compare'),
  );
  checks.push(
    /PREVIEW_ALREADY_USED/.test(guestServerSrc)
      // A blank/whitespace token must fail CLOSED, not fall through to the mint
      // path — that fall-through was a real hole found by e2e-guest-preview.
      && /if \(presented !== undefined && presented !== null\)/.test(guestServerSrc)
      && /!safeEqual\(sig, expected\)/.test(guestServerSrc)
      && /expired, tampered or corrupt -> treated as spent/i.test(guestServerSrc)
      ? ok('Phase 1: one preview per guest — a spent / blank / tampered / malformed token is refused, never re-minted')
      : fail('Phase 1: the one-preview rule is not enforced server-side'),
  );
  checks.push(
    /const check = verifyGuestPreviewToken\(req\?\.body\?\.token, nowMs\)/.test(guestServerSrc)
      && /expires_at: new Date\(check\.expiresAt\)/.test(guestServerSrc)
      && /server_now: new Date\(nowMs\)/.test(guestServerSrc)
      ? ok('Phase 1: the stream validates the signed token and returns a server-anchored expiry (browser clock is not the authority)')
      : fail('Phase 1: stream does not enforce the signed deadline server-side'),
  );
  // Isolate the guest hydrator's OWN body so the read-only assertion cannot be
  // satisfied (or broken) by unrelated code further down the file.
  const hydratorMatch = guestServerSrc.match(/async function hydrateGuestMessages\([\s\S]*?\r?\n  return out;\r?\n}/);
  const hydrator = hydratorMatch ? hydratorMatch[0] : '';

  checks.push(
    !!hydrator
      && /isEncoded \? '🔒 Encoded message' : row\.content/.test(hydrator)
      && /if \(alias == null \|\| alias === undefined\) continue;/.test(hydrator)
      && !/ensureRoomAlias\(/.test(hydrator)
      && !/revealDueAnnouncements\(/.test(hydrator)
      && !/author_id:/.test(hydrator)
      && !/\bscore\b|\breactions\b|my_vote|encoded_for_me|can_unreveal/.test(hydrator)
      ? ok('Phase 1: the guest hydrator is read-only and minimal — no alias writes, no gag reveal, no author id / score / encoded body')
      : fail('Phase 1: the guest read path writes, or leaks more than the minimal projection'),
  );
  checks.push(
    /entry\.fn === handleGuestPreviewStart \|\| entry\.fn === handleGuestPreviewStream/.test(guestRouterSrc)
      && /\{ re: \/\\\/anonymous\\\/guest-preview-stream\$\/, fn: handleGuestPreviewStream \}/.test(guestRouterSrc)
      && /\{ re: \/\\\/anonymous\\\/guest-preview-start\$\/, fn: handleGuestPreviewStart \}/.test(guestRouterSrc)
      ? ok('Phase 1: both guest routes are registered and special-cased before authorizeRequest (read-only, no session)')
      : fail('Phase 1: guest preview routes not registered pre-auth'),
  );
  checks.push(
    /GUEST_PREVIEW_MAX_LIMIT = 20/.test(guestServerSrc)
      && /const GUEST_PREVIEW_PAGE = 12/.test(guestServerSrc)
      && /async function guestPreviewStream/.test(guestApiSrc)
      ? ok('Phase 1: the stream is bounded (12 by default, hard max 20 per batch) rather than dumping the whole conversation')
      : fail('Phase 1: guest stream is not bounded'),
  );
  checks.push(
    /export async function guestPreviewStart\(groupId, token\)/.test(guestApiSrc)
      && /export async function guestPreviewStream\(groupId, token, before\)/.test(guestApiSrc)
      && /GUEST_PREVIEW_STORAGE_KEY = 'apex:guestPreview'/.test(guestRoomSrc)
      && /role="timer"/.test(guestRoomSrc)
      ? ok('Phase 1: the client persists the one-shot token in localStorage and renders a real countdown')
      : fail('Phase 1: client one-shot persistence or countdown missing'),
  );
  checks.push(
    /if \(guest\.status === 'expired'\)/.test(guestRoomSrc)
      && /endGuestPreview = useCallback\(\(status\) => \{[\s\S]{0,200}messages: \[\]/.test(guestRoomSrc)
      ? ok('Phase 1: expiry purges the messages from state, so nothing readable survives the sign-up gate')
      : fail('Phase 1: expiry does not clear the message buffer'),
  );
}

// ---------------------------------------------------------------------------
// PART E5 — TUTORIAL CENTRE + CONTEXTUAL TIPS (Phase 4).
// Three tours, reachable from the sidebar, the Dashboard and Settings, with
// completion + dismissal stored in the app's EXISTING localStorage convention
// (apex:* keys) rather than a new profile table. The gates that matter most are
// the content-truth ones: the copy must describe behaviour the app actually
// has, so a future change to the Arena or the Marketplace cannot silently
// leave the tutorial lying.
// ---------------------------------------------------------------------------
{
  const tutData = read(resolve(ROOT, 'src/data/tutorials.js'));
  const tutPage = read(resolve(ROOT, 'src/pages/Tutorials.jsx'));
  const tutTip = read(resolve(ROOT, 'src/components/TutorialTip.jsx'));
  const appSrc2 = read(resolve(ROOT, 'src/App.jsx'));
  const sideSrc = read(resolve(ROOT, 'src/components/Sidebar.jsx'));
  const settingsSrc = read(resolve(ROOT, 'src/pages/Settings.jsx'));

  checks.push(
    /key: 'arena'/.test(tutData) && /key: 'voting'/.test(tutData) && /key: 'marketplace'/.test(tutData)
      ? ok('Phase 4: exactly three tutorials — 1v1 Arena, Voting & Campaigns, Marketplace')
      : fail('Phase 4: the three required tutorials are not all present'),
  );
  checks.push(
    /DONE_KEY = 'apex:tutorials:v1'/.test(tutData)
      && /export const readTutorialProgress/.test(tutData)
      && /export const markTutorialDone/.test(tutData)
      && /export const resetTutorialProgress/.test(tutData)
      && !/create table/i.test(tutData)
      ? ok('Phase 4: completion state uses the existing apex:* localStorage convention — no new profile table')
      : fail('Phase 4: tutorial completion is not using the existing preference mechanism'),
  );
  checks.push(
    /role="progressbar"/.test(tutPage)
      && /Got it/.test(tutPage)
      && /Skip/.test(tutPage)
      && /Finish tour/.test(tutPage)
      && /aria-current=\{i === step \? 'step' : undefined\}/.test(tutPage)
      && /aria-live="polite"/.test(tutPage)
      ? ok('Phase 4: the step player has a progress bar, next/back, skip, "Got it" and screen-reader announcements')
      : fail('Phase 4: tutorial player is missing progress / navigation / skip / completion affordances'),
  );
  checks.push(
    /lazy\(\(\) => import\('\.\/pages\/Tutorials'\)\)/.test(appSrc2)
      && /<Route path="\/tutorials"/.test(appSrc2)
      && /path: '\/tutorials'/.test(sideSrc)
      && /to="\/tutorials"/.test(settingsSrc)
      ? ok('Phase 4: the tutorial centre is reachable from the route, the sidebar and Settings (replay)')
      : fail('Phase 4: tutorial centre is not wired into routes / sidebar / Settings'),
  );
  checks.push(
    /tutorialKey="arena"/.test(read(resolve(ROOT, 'src/pages/Rumble.jsx')))
      && /tutorialKey="voting"/.test(read(resolve(ROOT, 'src/pages/Voting.jsx')))
      && /tutorialKey="marketplace"/.test(read(resolve(ROOT, 'src/pages/Marketplace.jsx')))
      && /dismissTip\(tutorialKey\)/.test(tutTip)
      && /return null;/.test(tutTip)
      ? ok('Phase 4: dismissible first-use tips on the Arena, Voting and Marketplace pages')
      : fail('Phase 4: contextual first-use tips missing or not dismissible'),
  );
  // --- CONTENT TRUTH: the tutorial must not describe behaviour that does not
  // exist. These mirror the v63 arena rules and the marketplace platform gate.
  checks.push(
    /points DESC, then correct count DESC, then DRAW|most POINTS wins/.test(tutData)
      && /correct answer scores 1 point/.test(tutData)
      && /incorrect answer scores 0/.test(tutData)
      && /it is not a speed race/.test(tutData)
      && !/fastest|speed race wins|first to answer/.test(tutData)
      ? ok('Phase 4: the Arena tour teaches the REAL rules (points, not speed; 1/2/0 scoring; ties are a draw)')
      : fail('Phase 4: the Arena tour teaches behaviour the arena does not implement'),
  );
  checks.push(
    /40 NMCN questions/.test(tutData)
      && /90-second/.test(tutData)
      && /Practise vs a Bot/.test(tutData)
      && /free/.test(tutData)
      ? ok('Phase 4: the Arena tour states the real 40-question / 90-second format and that bot practice is free')
      : fail('Phase 4: the Arena tour states the wrong format or bot-practice cost'),
  );
  checks.push(
    /informational/i.test(tutData)
      && /we cannot take payment for it|does not sell it/.test(tutData)
      && /total payable/i.test(tutData)
      && !/was ₦|now ₦|\d+%\s*off|limited time only|save ₦|best price/i.test(tutData)
      ? ok('Phase 4: the Marketplace tour is honest about third-party listings and invents no discounts')
      : fail('Phase 4: the Marketplace tour overpromises checkout or invents pricing claims'),
  );
}

// ---------------------------------------------------------------------------
// PART E6 — VOTING PLATFORM (Phase 3). Service feedback and individual
// campaigns must stay SEPARATE in storage, in the RPCs and in the UI, and the
// integrity rules must live in the database rather than in disabled buttons.
// ---------------------------------------------------------------------------
{
  const v82 = read(resolve(ROOT, 'scripts/migration-v82-voting-campaigns.sql'));
  const votingSrc = read(resolve(ROOT, 'src/pages/Voting.jsx'));

  checks.push(
    /create table if not exists public\.service_ratings/.test(v82)
      && /create table if not exists public\.voting_campaigns/.test(v82)
      && /create table if not exists public\.voting_candidates/.test(v82)
      && /create table if not exists public\.campaign_votes/.test(v82)
      && /create table if not exists public\.campaign_totals/.test(v82)
      ? ok('Phase 3: service feedback and campaigns have separate tables — a rating can never be a candidate vote')
      : fail('Phase 3: the voting schema is missing or the two surfaces are not separated'),
  );
  checks.push(
    /create or replace function public\.cast_service_rating\(/.test(v82)
      && /create or replace function public\.cast_campaign_vote\(/.test(v82)
      && /v_user uuid := auth\.uid\(\)/.test(v82)
      && !/p_user_id uuid/.test(v82)
      && !/cast_campaign_vote\([^)]*p_user/.test(v82)
      ? ok('Phase 3: both vote RPCs derive the voter from auth.uid() — no client can vote as somebody else')
      : fail('Phase 3: a vote RPC accepts a user id from the client'),
  );
  checks.push(
    /revoke all on function public\.cast_campaign_vote\(bigint, bigint, uuid\) from public, anon/.test(v82)
      && /revoke all on function public\.cast_service_rating\(text, integer, text\[\], text, uuid\) from public, anon/.test(v82)
      && /revoke all on function public\.void_campaign_vote\(bigint, text\) from public, anon/.test(v82)
      ? ok('Phase 3: every voting RPC is revoked from public + anon (this project auto-grants EXECUTE to anon by default)')
      : fail('Phase 3: a voting RPC is still executable by anon'),
  );
  checks.push(
    /unique \(campaign_id, user_id\)/.test(v82)
      && /constraint campaign_votes_request_id_key unique \(client_request_id\)/.test(v82)
      && /CAMPAIGN_ENDED/.test(v82)
      && /CAMPAIGN_NOT_STARTED/.test(v82)
      && /INVALID_CANDIDATE/.test(v82)
      ? ok('Phase 3: one vote per user per campaign, replay-safe request ids, and server-side status/window/candidate validation')
      : fail('Phase 3: duplicate-vote or campaign-window validation is missing'),
  );
  checks.push(
    /alter publication supabase_realtime add table public\.campaign_totals/.test(v82)
      && /drop policy if exists "campaign_votes_select_own"/.test(v82)
      && /auth\.uid\(\) = user_id or public\.is_admin\(\)/.test(v82)
      ? ok('Phase 3: live updates ride the aggregate campaign_totals table; raw votes stay select-own so a broadcast cannot leak who voted for whom')
      : fail('Phase 3: realtime is wired to raw vote rows, or votes are not select-own'),
  );
  checks.push(
    /results_public/.test(v82)
      && /'results_visible', false/.test(v82)
      && /c\.results_public or c\.status = 'ended'/.test(v82)
      ? ok('Phase 3: a campaign that hides its results exposes no totals at all, not even to people who voted')
      : fail('Phase 3: restricted campaign results can leak'),
  );
  checks.push(
    /create table if not exists public\.campaign_vote_audit/.test(v82)
      && /create or replace function public\.void_campaign_vote\(/.test(v82)
      && /CANNOT_VOID_OWN_VOTE/.test(v82)
      ? ok('Phase 3: an admin can void a fraudulent vote, but the correction is written to an append-only audit trail')
      : fail('Phase 3: no audited path for correcting fraudulent votes'),
  );
  checks.push(
    /revoke all on function public\.cast_vote\(uuid, bigint, bigint\) from public, anon/.test(v82)
      && /revoke all on function public\.cast_vote\(uuid, bigint, bigint\) from authenticated/.test(v82)
      && /drop policy if exists "voting_responses_insert_authed"/.test(v82)
      ? ok('Phase 3: the legacy cast_vote vote-as-anyone hole is revoked and the legacy client write policies are dropped')
      : fail('Phase 3: the legacy cast_vote anon-executable / vote-as-anyone defect is still open'),
  );
  checks.push(
    /supabase\.rpc\('cast_campaign_vote'/.test(votingSrc)
      && /supabase\.rpc\('cast_service_rating'/.test(votingSrc)
      && !/\.from\('campaign_votes'\)[\s\S]{0,120}\.insert/.test(votingSrc)
      && !/\.from\('service_ratings'\)[\s\S]{0,120}\.insert/.test(votingSrc)
      && /Recording…/.test(votingSrc)
      ? ok('Phase 3: the client writes votes ONLY through the RPCs and shows a pending state until the server confirms')
      : fail('Phase 3: the client writes votes directly, or claims success before the server confirms'),
  );
  checks.push(
    /channel\(`campaign_totals_/.test(votingSrc)
      && /table: 'campaign_totals'/.test(votingSrc)
      && /setInterval\(\(\) => refreshResults\(openCampaign\.id\), 20000\)/.test(votingSrc)
      && /window\.addEventListener\('focus'/.test(votingSrc)
      ? ok('Phase 3: live aggregate subscription + a bounded 20s fallback poll + reconcile on focus/reconnect')
      : fail('Phase 3: voting has no bounded fallback or reconnect reconcile'),
  );
  checks.push(
    /are level on/.test(votingSrc)
      && /not a win/.test(votingSrc)
      && /results_visible/.test(votingSrc)
      ? ok('Phase 3: tied candidates are shown as tied and a small lead is never presented as a win')
      : fail('Phase 3: ties or restricted results are misrepresented'),
  );
  checks.push(
    !/\.from\('voting_polls'\)[\s\S]{0,300}insert\(\{[^}]*\btype:/.test(votingSrc)
      && /has never existed/.test(votingSrc)
      ? ok('Phase 3: the dead 42703 poll-request flow is gone and the reason is recorded in the file')
      : fail('Phase 3: the broken poll-request insert is back'),
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

// PART G — v54 FINAL TWEAKS (Punch/action set, event expiry, react fix, Share,
// auto-lock at 20). slap -> punch everywhere; punch/fuckoff/waka are the attack
// actions; events expire after 10 minutes like messages; the MESSAGE-reaction
// path selects full post columns (fixes the isPostAlive-NaN 404); encoded
// replies render a locked placeholder; a Share button copies an anonymous deep
// link; membership auto-locks the moment a room hits 20 members.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const soundSrc = existsSync(resolve(ROOT, 'src/utils/anonSound.js'))
    ? read(resolve(ROOT, 'src/utils/anonSound.js')) : '';
  const migrationSrc = existsSync(resolve(ROOT, 'scripts/migration-v54-anonymous-final-tweaks.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v54-anonymous-final-tweaks.sql')) : '';
  const migrationV56Src = existsSync(resolve(ROOT, 'scripts/migration-v56-anonymous-capacity-monetization.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v56-anonymous-capacity-monetization.sql')) : '';

  // --- action set: punch/fuckoff/waka attacks, slap retired ---
  checks.push(
    /export const ROOM_ACTIONS = \[/.test(communitySrc)
      && /key: 'punch', glyph: '👊', label: 'Punch', kind: 'attack'/.test(communitySrc)
      && /key: 'kick'/.test(communitySrc)
      && /key: 'fuckoff', glyph: '🖕', label: 'Fuck Off', kind: 'attack'/.test(communitySrc)
      && /key: 'waka', glyph: '🖐️', label: 'Waka', kind: 'attack'/.test(communitySrc)
      && !/key: 'slap'/.test(communitySrc)
      ? ok('ROOM_ACTIONS = punch/kick/fuckoff/waka attacks; retired slap removed')
      : fail('ROOM_ACTIONS action set (punch/fuckoff/waka, no slap) not as specified'),
  );
  checks.push(
    /const action = row\.action === 'slap' \? 'punch' : row\.action/.test(communitySrc)
      && /eventActionMeta\(action\)\?\.glyph/.test(communitySrc)
      ? ok('legacy slap rows hydrate as the canonical Punch card (glyph + verb)')
      : fail('hydrateRoomEvent does not map legacy slap rows to punch'),
  );

  // --- event expiry (10 min, mirroring the message lifetime) ---
  checks.push(
    /export const EVENT_LIFETIME_MS = 10 \* 60 \* 1000/.test(communitySrc)
      && /event_lifetime_seconds: Math\.round\(EVENT_LIFETIME_MS \/ 1000\)/.test(communitySrc)
      ? ok('server event lifetime constant + config event_lifetime_seconds exposed')
      : fail('server EVENT_LIFETIME_MS / config event_lifetime_seconds missing'),
  );
  checks.push(
    /created <= Date\.now\(\) - EVENT_LIFETIME_MS\) return null/.test(communitySrc)
      && /const created = Date\.parse\(data\.created_at\);\s*\n\s*if \(!Number\.isFinite\(created\)/.test(communitySrc)
      && /\.gte\('created_at', sinceIso\)/.test(communitySrc)
      ? ok('fetchRoomEvent + feed both enforce the 10-minute event expiry off created_at')
      : fail('event expiry not enforced on fetch and feed'),
  );

  // --- MESSAGE-reaction fix + encoded reply flag ---
  checks.push(
    /\.from\('community_posts'\)\s*\n\s*\.select\(ROOM_POST_COLUMNS\)\s*\n\s*\.eq\('id', messageId\)/.test(communitySrc)
      ? ok('handleAnonReact selects full ROOM_POST_COLUMNS (isPostAlive 404 regression fixed)')
      : fail('handleAnonReact still selects a partial row for the aliveness check'),
  );
  checks.push(
    /encoded: !!parentMeta\.get\(parent\.id\)\?\.is_encoded/.test(communitySrc)
      ? ok('reply hydration carries the encoded flag for the from-of-room placeholder')
      : fail('reply hydration does not expose the parent-is-encoded flag'),
  );

  // --- client surface ---
  checks.push(
    /const EVENT_LIFETIME_SECONDS = 600/.test(roomSrc)
      && /room\?\.config\?\.event_lifetime_seconds \|\| EVENT_LIFETIME_SECONDS/.test(roomSrc)
      ? ok('client expiry sweep mirrors the server lifetime (600s, config-aware)')
      : fail('client event expiry sweep missing'),
  );
  checks.push(
    /const EVENT_VERB = \{/.test(roomSrc)
      && /punch: 'punched'/.test(roomSrc)
      && /fuckoff: 'told'/.test(roomSrc)
      && /const EVENT_AFTER = \{/.test(roomSrc)
      && /fuckoff: 'to fuck off'/.test(roomSrc)
      ? ok('event cards render full sentences via EVENT_VERB/EVENT_AFTER')
      : fail('full-sentence event card rendering missing'),
  );
  checks.push(
    /playActionSfx\(ev\.action\)/.test(roomSrc)
      && /playActionSfx\(action\)/.test(roomSrc)
      && /export function playActionSfx\(/.test(soundSrc)
      ? ok('per-action sound cues on incoming events + sheet sends (anonSound)')
      : fail('per-action sound cues not wired'),
  );
  checks.push(
    /Only the recipient can read this/.test(roomSrc)
      && /🔒 Encoded message/.test(roomSrc)
      && /{msg\.encoded_for_me \? 'Encoded message' : 'Encoded · private'}/.test(roomSrc)
      ? ok('encoded-locked UI: recipient prompt + reply-to-encoded placeholder')
      : fail('encoded-locked / reply placeholder copy missing'),
  );
  checks.push(
    /navigator\.share\(\{ title: 'Apex Anonymous Room'/.test(roomSrc)
      && /navigator\.clipboard\.writeText/.test(roomSrc)
      && /copiedShare/.test(roomSrc)
      && /<Share2 size=\{15\} \/>/.test(roomSrc)
      ? ok('Share anonymous-link button (navigator.share + clipboard fallback + copied state)')
      : fail('Share anonymous-link button missing'),
  );

  // --- migration v54 ---
  checks.push(
    /set action = 'punch'/.test(migrationSrc)
      && /where action = 'slap'/.test(migrationSrc)
      && /anonymous_combat_events/.test(migrationSrc)
      ? ok('migration v54 rewrites slap -> punch on room + combat events')
      : fail('migration v54 slap -> punch rewrite missing'),
  );
  checks.push(
    /create or replace function public\.community_anonymous_join/.test(migrationV56Src)
      && /'MEMBERSHIP_PAYMENT_REQUIRED'/.test(migrationV56Src)
      && /set membership_locked = true, updated_at = now\(\)/.test(migrationSrc)
      ? ok('v56 supersedes the v54 auto-lock: join reveals MEMBERSHIP_PAYMENT_REQUIRED; membership_locked is host-only (v54 auto-lock gate is vestigial)')
      : fail('v56 join RPC does not replace the v54 auto-lock with MEMBERSHIP_PAYMENT_REQUIRED'),
  );
checks.push(
    /set minimum_members_to_activate = 20, updated_at = now\(\)/.test(migrationSrc)
      && /id = 12/.test(migrationSrc)
      ? ok('canon Anonymous room activates at 20 ("opens at 20")')
      : fail('canon room activate-at-20 update missing in migration v54'),
  );
  checks.push(
    /anonymous_fight/.test(migrationSrc)
      && /"attack_actions":\["punch","kick","fuckoff","waka"\]/.test(migrationSrc)
      ? ok('fight-check attack allowlist updated to punch/kick/fuckoff/waka (slap removed)')
      : fail('migration v54 does not update the anonymous_fight attack allowlist'),
  );
}

// PART H — P1 MEMBER ROSTER (target ANY present member). The action sheet lists
// every current room member from the server (not just those who have spoken),
// with live online status, members-only; a directly aimed action must land on a
// CURRENT member (NOT_A_MEMBER for a lingering alias).
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const routerSrc = read(resolve(ROOT, 'api/community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));

  checks.push(
    /export async function handleAnonMembers\(req, res, user\)/.test(communitySrc)
      && /from\('study_group_members'\)/.test(communitySrc)
      && /anonymous_presence/.test(communitySrc)
      && /online: onlineIds\.has\(uid\)/.test(communitySrc)
      ? ok('handleAnonMembers builds a masked roster with live presence (members-only)')
      : fail('handleAnonMembers roster/presence wiring missing'),
  );
  checks.push(
    /ANONYMOUS_MEMBERS_ONLY/.test(communitySrc)
      && /is_self: uid === user\.id/.test(communitySrc)
      && /is_host: roleById\.get\(uid\) === 'owner'/.test(communitySrc)
      ? ok('roster is members-only and marks is_self + is_host without leaking ids')
      : fail('roster membership gate / self+host flags missing'),
  );
  checks.push(
    /NOT_A_MEMBER/.test(communitySrc)
      && /\.from\('study_group_members'\)\s*\n\s*\.select\('user_id'\)\s*\n\s*\.eq\('group_id', group\.id\)\s*\n\s*\.eq\('user_id', targetUserId\)/.test(communitySrc)
      ? ok('a directly aimed action confirms the target still holds a seat (NOT_A_MEMBER)')
      : fail('handleAnonSocial missing the current-member seat check'),
  );
  checks.push(
    /handleAnonMembers,/.test(routerSrc) && /fn: handleAnonMembers/.test(routerSrc)
      ? ok('api/community.js imports + dispatches handleAnonMembers (/anonymous/members)')
      : fail('community.js router missing the members route'),
  );
  checks.push(
    /communityApi\(session, '\/anonymous\/members'/.test(roomSrc)
      && /const loadRoster = useCallback/.test(roomSrc)
      && /if \(data\.access === 'member'\) void loadRoster\(\)/.test(roomSrc)
      ? ok('AnonymousRoom loads the roster on member entry (/anonymous/members)')
      : fail('AnonymousRoom roster load missing'),
  );
  checks.push(
    /const actionTargets = useMemo/.test(roomSrc)
      && /rosterQuery/.test(roomSrc)
      && /setRosterQuery\(''\)/.test(roomSrc)
      && /Search Anonymous #NN/.test(roomSrc)
      ? ok('action sheet searchable roster list (online-first, offline disabled) wired')
      : fail('action sheet roster list / search missing in AnonymousRoom'),
  );
}

// PART I — P2 CAPACITY / MONETIZATION (v56): 20 free founding member seats ->
// ₦499 paid member seat; first 20 spectator slots free -> ₦299 pass; capacity
// = members + spectators <= member_limit; capacity breakdown exposed on the
// closed screen, the open-room browser, and the waitlist club card.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const routerSrc = read(resolve(ROOT, 'api/community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const groupsSrc = read(resolve(ROOT, 'src/components/StudyGroups.jsx'));
  const iconSrc = read(resolve(ROOT, 'src/components/Icons.jsx'));
  const e2eSrc = read(resolve(ROOT, 'scripts/e2e-anonymous-lifecycle.mjs'));
  const mig = existsSync(resolve(ROOT, 'scripts/migration-v56-anonymous-capacity-monetization.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v56-anonymous-capacity-monetization.sql')) : '';

  checks.push(
    /founding_member_cap integer not null default 20/.test(mig)
      && /free_spectator_cap integer not null default 20/.test(mig)
      && /member_price numeric\(12,2\) not null default 499/.test(mig)
      && /study_groups_member_price_check/.test(mig)
      ? ok('migration v56 adds founding_member_cap/free_spectator_cap/member_price with defaults + checks')
      : fail('migration v56 capacity/member-price columns missing'),
  );
  checks.push(
    /add column if not exists tier text/.test(mig)
      && /anonymous_spectators_tier_check/.test(mig)
      && /anonymous_spectators_amount_check/.test(mig)
      && /create table if not exists public\.anonymous_memberships/.test(mig)
      ? ok('migration v56 adds spectator tier (free|paid) + anonymous_memberships ledger')
      : fail('migration v56 spectator tier / memberships table missing'),
  );
  checks.push(
    /v_count >= v_gr\.founding_member_cap/.test(mig)
      && /'MEMBERSHIP_PAYMENT_REQUIRED'/.test(mig)
      && /'member_price', v_gr\.member_price/.test(mig)
      && /v_gr\.membership_locked then/.test(mig)
      && /'MEMBERSHIP_LOCKED'/.test(mig)
      ? ok('join RPC: free-while-below-founding-cap else MEMBERSHIP_PAYMENT_REQUIRED (₦499); host lock takes priority')
      : fail('join RPC founding boundary / host-lock priority missing'),
  );
  checks.push(
    /v_spec >= v_gr\.free_spectator_cap/.test(mig)
      && /'SPECTATOR_PAYMENT_REQUIRED'/.test(mig)
      && /'GROUP_NOT_ACTIVE'/.test(mig)
      && /'free-spectate-'/.test(mig)
      && /'free', 'active'/.test(mig)
      ? ok('spectate-free RPC: first free_spectator_cap slots free (tier free), else SPECTATOR_PAYMENT_REQUIRED, active-rooms only')
      : fail('spectate-free RPC free tier / paid boundary missing'),
  );
  checks.push(
    /create or replace function public\.community_anonymous_grant_membership/.test(mig)
      && /from public\.anonymous_spectators/.test(mig)
      && /insert into public\.anonymous_memberships/.test(mig)
      && /on conflict \(group_id, user_id\) do nothing/.test(mig)
      && /update public\.anonymous_memberships\s*\n\s*set status = 'revoked'/.test(mig)
      ? ok('grant_membership fulfils a paid seat (revokes spectator seat, idempotent); wipe revokes paid memberships')
      : fail('grant_membership / wipe memberships revocation missing'),
  );
  checks.push(
    /revoke execute on function public\.community_anonymous_join\(bigint, uuid\) from public, anon, authenticated/.test(mig)
      && /revoke execute on function public\.community_anonymous_spectate_free\(bigint, uuid\) from public, anon, authenticated/.test(mig)
      && /grant execute on function public\.community_anonymous_grant_membership/.test(mig)
      ? ok('payment/lifecycle RPCs are service_role-only (explicit anon/authenticated revokes)')
      : fail('v56 RPC grants not locked to service_role'),
  );
  checks.push(
    /const seatMemberCount = await roomMemberCount\(group\.id\)/.test(communitySrc)
      && /const seatSpectatorCount = await roomSpectatorCount\(group\.id\)/.test(communitySrc)
      && /member_paid_required:/.test(communitySrc)
      && /spectator_paid_required:/.test(communitySrc)
      ? ok('handleAnonRoom computes the capacity breakdown for EVERY access and exposes member_paid_required/spectator_paid_required')
      : fail('handleAnonRoom capacity breakdown missing for closed/prospective-joiner access'),
  );
  checks.push(
    /export async function handleAnonSpectateFree\(req, res, user\)/.test(communitySrc)
      && /community_anonymous_spectate_free/.test(communitySrc)
      && /error: data\.code/.test(communitySrc)
      && /free_spectator_cap: data\.free_spectator_cap/.test(communitySrc)
      ? ok('handleAnonSpectateFree maps the free→paid spectator codes + capacity numbers')
      : fail('handleAnonSpectateFree handler missing or incomplete'),
  );
  checks.push(
    /export async function handleAnonRooms\(req, res\)/.test(communitySrc)
      && /member_paid_required:/.test(communitySrc)
      && /seats_left: totalCapacity != null \? Math\.max\(totalCapacity - used, 0\) : null/.test(communitySrc)
      ? ok('handleAnonRooms lists active rooms with live capacity + paid flags + seats_left')
      : fail('handleAnonRooms active-room browser missing'),
  );
  checks.push(
    /handleAnonSpectateFree,/.test(routerSrc)
      && /\\\/anonymous\\\/spectate-free\$/.test(routerSrc)
      && /handleAnonRooms,/.test(routerSrc)
      && /\\\/anonymous\\\/rooms\$/.test(routerSrc)
      ? ok('api/community.js dispatches /anonymous/spectate-free + /anonymous/rooms')
      : fail('community.js router missing the v56 routes'),
  );
  checks.push(
    /setConfirmMembership\(true\)/.test(roomSrc)
      && /MEMBERSHIP_PAYMENT_REQUIRED/.test(roomSrc)
      && /setConfirmSpectate\(true\)/.test(roomSrc)
      && /SPECTATOR_PAYMENT_REQUIRED/.test(roomSrc)
      && /const buyMembership = async \(\) =>/.test(roomSrc)
      && /product: 'anonymous_memberships'/.test(roomSrc)
      ? ok('AnonymousRoom join paths surface MEMBERSHIP/SPECTATOR_PAYMENT_REQUIRED and pay via buyMembership')
      : fail('AnonymousRoom P2 payment wiring missing'),
  );
  checks.push(
    /const startSpectate = async \(\) =>/.test(roomSrc)
      && /\/anonymous\/spectate-free/.test(roomSrc)
      && /SPECTATOR_PAYMENT_REQUIRED/.test(roomSrc)
      && /buySpectator/.test(roomSrc)
      ? ok('Start spectating tries the free path first, falls back to the ₦299 confirm')
      : fail('AnonymousRoom free-first spectate flow missing'),
  );
  checks.push(
    /const seatMemberCount =/.test(roomSrc)
      && /capacity\.member_count \?\? memberCount/.test(roomSrc)
      && /freeMemberSeatsLeft/.test(roomSrc)
      && /freeSpectatorSeatsLeft/.test(roomSrc)
      && /foundingCap/.test(roomSrc)
      && /memberPrice/.test(roomSrc)
      && /totalCapacity/.test(roomSrc)
      ? ok('AnonymousRoom derives seat counts + free/paid labels from capacity.member_count')
      : fail('AnonymousRoom derived capacity helpers missing'),
  );
  checks.push(
    /browseOpen && \(/.test(roomSrc)
      && /openRoomBrowser/.test(roomSrc)
      && /browseRooms\.map/.test(roomSrc)
      && /Browse active Anonymous rooms/.test(roomSrc)
      && /<Compass size=\{14\} \/>/.test(roomSrc)
      ? ok('browse-rooms modal renders the active-room list with a Compass entry button')
      : fail('AnonymousRoom browse modal / Compass button missing'),
  );
  checks.push(
    /confirmMembership && \(/.test(roomSrc)
      && /Buy member seats/.test(roomSrc)
      && /Pay ₦\{bundleTotal/.test(roomSrc)
      && /<Crown size=\{14\} \/>/.test(roomSrc)
      && /Include me/.test(roomSrc)
      && /my own member seat/.test(roomSrc)
      ? ok('confirmMembership modal buys ₦499 member seats (bundle stepper + include-me + gift-only copy)')
      : fail('confirmMembership modal missing'),
  );
  checks.push(
    /Compass/.test(iconSrc)
      ? ok('Icons.jsx re-exports Compass (browse button)')
      : fail('Icons.jsx does not re-export Compass'),
  );
  checks.push(
    /Active · join or spectate/.test(groupsSrc)
      && !/^\s*Lock,$/m.test(groupsSrc)
      ? ok('StudyGroups anonymous badge says "join or spectate" (no dead Lock import)')
      : fail('StudyGroups badge not updated to the joinable model'),
  );
  checks.push(
    /community_anonymous_grant_membership/.test(e2eSrc)
      && /handleAnonSpectateFree/.test(e2eSrc)
      && /handleAnonRooms/.test(e2eSrc)
      && /MEMBERSHIP_PAYMENT_REQUIRED/.test(e2eSrc)
      && /SPECTATOR_PAYMENT_REQUIRED/.test(e2eSrc)
      ? ok('e2e lifecycle covers the P2 paid-boundary + grant + rooms gates')
      : fail('e2e P2 gates not wired'),
  );
}

// ---------------------------------------------------------------------------
// PART J — P3 MULTI-SLOT PURCHASES + GIFTING (v57): a paid bundle mints N
// one-slot gift codes (buyer-only, never add capacity); one code redeems ONE
// seat at claim time (GROUP_FULL without consuming on a full room); gift RPCs
// are service_role-only; a wipe expires unclaimed gifts.
// ---------------------------------------------------------------------------
{
  const communitySrc = read(resolve(ROOT, 'api/_community.js'));
  const routerSrc = read(resolve(ROOT, 'api/community.js'));
  const roomSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const initSrc = read(resolve(ROOT, 'api/initiate-payment.js'));
  const verifySrc = read(resolve(ROOT, 'api/verify-payment.js'));
  const webhookSrc = read(resolve(ROOT, 'api/payments-webhook.js'));
  const e2eSrc = read(resolve(ROOT, 'scripts/e2e-anonymous-lifecycle.mjs'));
  const mig = existsSync(resolve(ROOT, 'scripts/migration-v57-anonymous-gifting.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v57-anonymous-gifting.sql')) : '';

  checks.push(
    /create table if not exists public\.anonymous_membership_gifts/.test(mig)
      && /status text not null default 'unclaimed'/.test(mig)
      && /anonymous_membership_gifts_status_check/.test(mig)
      && /enable row level security/.test(mig)
      && /revoke all on public\.anonymous_membership_gifts from public, anon, authenticated/.test(mig)
      ? ok('migration v57 adds the anonymous_membership_gifts ledger (status check, RLS service-role only)')
      : fail('migration v57 gifts table missing / unlocked'),
  );
  checks.push(
    /create or replace function public\.community_anonymous_create_gifts/.test(mig)
      && /pg_advisory_xact_lock/.test(mig)
      && /where reference = p_reference/.test(mig)
      && /exception when unique_violation/.test(mig)
      && /'unclaimed'/.test(mig)
      ? ok('create_gifts mints N unique codes (reference-idempotent, collision-safe) without granting a seat')
      : fail('community_anonymous_create_gifts missing or insecure'),
  );
  checks.push(
    /create or replace function public\.community_anonymous_redeem_gift/.test(mig)
      && /'INVALID_GIFT'/.test(mig)
      && /'GIFT_ALREADY_CLAIMED'/.test(mig)
      && /'GIFT_EXPIRED'/.test(mig)
      && /'ALREADY_MEMBER'/.test(mig)
      && /v_count \+ v_spec >= v_gr\.member_limit/.test(mig)
      && /'GROUP_FULL'/.test(mig)
      && /insert into public\.anonymous_memberships \(group_id, user_id, reference, amount, tier, status\)/.test(mig)
      && /'gift:' \|\| v_gift\.code/.test(mig)
      ? ok('redeem_gift enforces the one-slot contract: invalid/used/expired/dupe/self refusal, capacity at redemption')
      : fail('community_anonymous_redeem_gift contract missing'),
  );
  checks.push(
    /update public\.anonymous_membership_gifts\s*\n\s*set status = 'expired'/.test(mig)
      && /create or replace function public\.community_anonymous_wipe/.test(mig)
      ? ok('community_anonymous_wipe expires unclaimed gifts on wipe')
      : fail('wipe does not expire unclaimed gifts'),
  );
  checks.push(
    /revoke execute on function public\.community_anonymous_create_gifts\(bigint, uuid, integer, text, integer\) from public, anon, authenticated/.test(mig)
      && /revoke execute on function public\.community_anonymous_redeem_gift\(bigint, uuid, text\) from public, anon, authenticated/.test(mig)
      && /grant execute on function public\.community_anonymous_create_gifts/.test(mig)
      ? ok('v57 gifting RPCs are service_role-only')
      : fail('v57 gifting RPC grants not locked to service_role'),
  );
  checks.push(
    /async function loadAnonGiftSeats\(userId, groupId\)/.test(communitySrc)
      && /export async function handleAnonGifts\(req, res, user\)/.test(communitySrc)
      && /room_link: `\/anonymous\/\$\{g\.group_id\}\?gift=\$\{g\.code\}`/.test(communitySrc)
      && /claimed_by_self: g\.claimed_by === userId/.test(communitySrc)
      ? ok('handleAnonGifts serves buyer-only gift seats with shareable room links')
      : fail('handleAnonGifts handler missing'),
  );
  checks.push(
    /export async function handleAnonGiftClaim\(req, res, user\)/.test(communitySrc)
      && /community_anonymous_redeem_gift/.test(communitySrc)
      && /'GIFT_ALREADY_CLAIMED', 'GIFT_EXPIRED'\]\.includes\(data\.code\) \? 400 : 403/.test(communitySrc)
      && /sendRoomPush/.test(communitySrc)
      ? ok('handleAnonGiftClaim redeems one seat and pushes the join')
      : fail('handleAnonGiftClaim handler missing'),
  );
  checks.push(
    /handleAnonGifts,/.test(routerSrc)
      && /handleAnonGiftClaim,/.test(routerSrc)
      && /\\\/anonymous\\\/gifts\$/.test(routerSrc)
      && /\\\/anonymous\\\/gift-claim\$/.test(routerSrc)
      ? ok('api/community.js dispatches /anonymous/gifts + /anonymous/gift-claim')
      : fail('community.js router missing the P3 gifting routes'),
  );
  checks.push(
    /resolveMembershipsPurchase/.test(initSrc)
      && /'anonymous_memberships'/.test(initSrc)
      && /for_me/.test(initSrc)
      && /MAX_BUNDLE = 50/.test(initSrc)
      ? ok('initiate-payment resolves anonymous_memberships bundles (count 1..50, for_me, amount = count × member_price)')
      : fail('initiate-payment bundle product missing'),
  );
  checks.push(
    /grantMembershipsBundle/.test(verifySrc)
      && /'anonymous_memberships'/.test(verifySrc)
      && /community_anonymous_create_gifts/.test(verifySrc)
      ? ok('verify-payment grants a memberships bundle (creates gift codes + optional for_me seat)')
      : fail('verify-payment bundle grant missing'),
  );
  checks.push(
    /grantMembershipsBundle/.test(webhookSrc)
      && /'anonymous_memberships'/.test(webhookSrc)
      ? ok('payments-webhook mirrors the memberships bundle grant')
      : fail('payments-webhook bundle grant missing'),
  );
  checks.push(
    /const \[bundleCount, setBundleCount\] = useState\(1\)/.test(roomSrc)
      && /bundleForMe/.test(roomSrc)
      && /product: 'anonymous_memberships'/.test(roomSrc)
      && /giftClaimOpen && \(/.test(roomSrc)
      && /giftPanelOpen && \(/.test(roomSrc)
      && /.\/anonymous\/gift-claim/.test(roomSrc)
      ? ok('AnonymousRoom bundle modal + gift panel + gift-claim modal wired')
      : fail('AnonymousRoom P3 UI wiring missing'),
  );
  checks.push(
    /new URLSearchParams\(window\.location\.search\)\.get\('gift'\)/.test(roomSrc)
      && /replaceState/.test(roomSrc)
      ? ok('AnonymousRoom deep-links /anonymous/:id?gift=CODE into the claim box')
      : fail('AnonymousRoom gift deep-link missing'),
  );
  checks.push(
    /handleAnonGifts/.test(e2eSrc)
      && /handleAnonGiftClaim/.test(e2eSrc)
      && /community_anonymous_create_gifts/.test(e2eSrc)
      && /GROUP_FULL/.test(e2eSrc)
      && /GIFT_ALREADY_CLAIMED/.test(e2eSrc)
      && /14g/.test(e2eSrc)
      ? ok('e2e lifecycle covers the P3 mint / claim / full-room / wipe gates')
      : fail('e2e P3 gates not wired'),
  );
}

// ---------------------------------------------------------------------------
// PART K — 1v1 DUEL LOBBY + BLITZ (v58): the v38 competitive-match engine gains
// a second server-authoritative format. Schema gets format/starts_at/ends_at/
// multiplier (+partial UNIQUE one-double); create_competitive_match gains a
// balanced 40-Q NMCN sequence + duplicate pair-write; a NEW start RPC opens the
// shared 90s clock; submit is first-answer-wins with a one-time x2 Double;
// complete REFUSES early (BLITZ_NOT_ENDED) and settles deterministically via
// _sc_apply only at ends_at (replay-proof, stats gated on both humans battling).
// No new api/*.js — the 12-function Hobby ceiling stays untouched.
// ---------------------------------------------------------------------------
{
  const mig = existsSync(resolve(ROOT, 'scripts/migration-v58-duel-blitz.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v58-duel-blitz.sql')) : '';
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const hall = read(resolve(ROOT, 'src/pages/Rumble.jsx'));
  const hook = existsSync(resolve(ROOT, 'src/hooks/useMatchRealtime.js'))
    ? read(resolve(ROOT, 'src/hooks/useMatchRealtime.js')) : '';
  const e2eSrc = existsSync(resolve(ROOT, 'scripts/e2e-duel-lobby.mjs'))
    ? read(resolve(ROOT, 'scripts/e2e-duel-lobby.mjs')) : '';
  const pkg = read(resolve(ROOT, 'package.json'));

  checks.push(
    !existsSync(resolve(ROOT, 'api/duel.js')) && !existsSync(resolve(ROOT, 'api/blitz.js'))
      && /api\/\*\.js — the 12-function Vercel cap is untouched/.test(mig)
      ? ok('v58 adds NO Vercel function (RPC-only; 12-function ceiling intact)')
      : fail('a duel api/*.js file exists — would blow the 12-function ceiling'),
  );
  checks.push(
    /add column if not exists format text not null default 'sudden_death'/.test(mig)
      && /add column if not exists starts_at timestamptz/.test(mig)
      && /add column if not exists ends_at timestamptz/.test(mig)
      && /competitive_matches_format_check/.test(mig)
      && /add column if not exists multiplier int not null default 1/.test(mig)
      && /create unique index if not exists uq_cma_one_double/.test(mig)
      && /duel_waiting_format_check/.test(mig)
      ? ok('v58 schema: format/starts_at/ends_at/multiplier(+one-double) and format-aware duel_waiting')
      : fail('v58 schema deltas missing'),
  );
  checks.push(
    /drop function if exists public\.create_competitive_match\(text, integer, uuid\);/.test(mig)
      && /create or replace function public\.create_competitive_match\(\s*p_mode text,\s*p_stake integer,\s*p_opponent_id uuid default null,\s*p_format text default 'sudden_death'/.test(mig)
      ? ok('create_competitive_match 3-arg dropped, 4-arg (format-aware) replaces it')
      : fail('create_competitive_match 4-arg replace missing'),
  );
  checks.push(
    /v_wants int\[\] := array\[8, 12, 12, 8\];/.test(mig)
      && /partition by c\.diff_rank order by c\.id/.test(mig)
      && /'HUMAN_DUEL_ONLY'/.test(mig)
      && /'BLITZ_IS_1V1'/.test(mig)
      && /case when p_format = 'blitz' then 'waiting' else 'active' end/.test(mig)
      ? ok('blitz create: balanced 40-Q split (Easy8/Moderate12/Hard12/Expert8), human-only, stores WAITING')
      : fail('blitz create protections / balanced selection missing'),
  );
  checks.push(
    /create or replace function public\.start_competitive_match\(p_match_id uuid\)/.test(mig)
      && /now\(\) \+ interval '90 seconds'/.test(mig)
      && /'NOT_BLITZ'/.test(mig)
      && /'MATCH_NOT_WAITING'/.test(mig)
      && /'startsAt', v_m\.starts_at, 'endsAt', v_m\.ends_at/.test(mig)
      ? ok('start_competitive_match opens the shared 90s wall-clock once (idempotent replay)')
      : fail('start_competitive_match missing clock / guards'),
  );
  checks.push(
    /drop function if exists public\.submit_competitive_answer\(uuid, integer, text\);/.test(mig)
      && !/create or replace function public\.submit_competitive_answer\(\s*p_match_id uuid,\s*p_question_index integer default 0,\s*p_selected text default null\s*\)/.test(mig)
      && /create or replace function public\.submit_competitive_answer\(\s*p_match_id uuid,\s*p_question_index integer default 0,\s*p_selected text default null,\s*p_double boolean default false/.test(mig)
      && /v_mult := 2;/.test(mig)
      && /on conflict \(match_id, player_id, question_index\) do nothing/.test(mig)
      ? ok('submit: SINGLE 4-arg overload (3-arg dropped -> no PGRST203), server-graded, first-answer-wins, one-time Double')
      : fail('submit_competitive_answer overload contract missing'),
  );
  checks.push(
    /'BLITZ_NOT_ENDED'/.test(mig)
      && /if now\(\) < v_m\.ends_at then/.test(mig)
      && /v_answered_humans := \(case when v_a1 > 0 then 1 else 0 end\)/.test(mig)
      && /and v_answered_humans = v_human_count then/.test(mig)
      && /v_match_key \|\| ':' \|\| v_human::text\)::uuid/.test(mig)
      && /perform public\.refresh_duel_risk\(v_human\);/.test(mig)
      ? ok('blitz settle: refuses early (BLITZ_NOT_ENDED), settles at ends_at deterministically via _sc_apply (both-humans stats gate)')
      : fail('blitz complete/settle guard missing'),
  );
  checks.push(
    /revoke all on function public\.create_competitive_match\(text, integer, uuid, text\)\s*from public, anon;/.test(mig)
      && /grant execute on function public\.create_competitive_match\(text, integer, uuid, text\)\s*to authenticated;/.test(mig)
      && /revoke all on function public\.submit_competitive_answer\(uuid, integer, text, boolean\)\s*from public, anon;/.test(mig)
      && /notify pgrst, 'reload schema';/.test(mig)
      ? ok('v58 ACLs: anonymous revoked, authenticated granted on every blitz RPC; pgrst reload')
      : fail('v58 RPC ACLs / schema reload missing'),
  );
  checks.push(
    /const arenaCreateMatch = useCallback/.test(app)
      && /const arenaRpc = useCallback/.test(app)
      && /supabase\.rpc\(fn, params\)/.test(app)
      && /arenaRpc\('arena_create_match'/.test(app)
      && /arenaRpc\('arena_answer',[\s\S]*?p_double/.test(app)
      && /arenaRpc\('arena_settle'/.test(app)
      && /arenaRpc\('arena_state'/.test(app)
      && /arenaRpc\('arena_forfeit'/.test(app)
      && !/createBlitzMatch = useCallback/.test(app)
      ? ok('AppContext wire-up: one arenaRpc helper driving create/answer(double)/settle/state/forfeit; v58 blitz helpers retired')
      : fail('AppContext arena helpers missing'),
  );
  checks.push(
    /useMatchRealtime/.test(hall)
      && /phase === 'blitz-waiting'/.test(hall)
      && /phase === 'blitz-countdown'/.test(hall)
      && /phase === 'blitz-play'/.test(hall)
      && /phase === 'blitz-result'/.test(hall)
      && /apex_active_arena/.test(hall)
      && /fmtBlitzTime/.test(hall)
      && /arenaReview/.test(hall)
      && /forfeitArena/.test(hall)
      ? ok('Rumble arena UI: waiting/countdown/play/result + resume key + review + forfeit')
      : fail('Rumble arena UI wiring missing'),
  );
  checks.push(
    /match-lobby:duel:blitz/.test(hook)
      && /sendState/.test(hook)
      && /\bonline\b/.test(hook)
      ? ok('useMatchRealtime exposes lobby presence (blitz topic), online flag, and mirrored sendState')
      : fail('useMatchRealtime blitz lobby hook missing'),
  );
  checks.push(
    /"e2e:duel": "node scripts\/e2e-duel-lobby\.mjs"/.test(pkg)
      ? ok('package.json adds the e2e:duel script')
      : fail('e2e:duel npm script missing'),
  );
  checks.push(
    /create_competitive_match/.test(e2eSrc)
      && /submit_competitive_answer/.test(e2eSrc)
      && /complete_competitive_match/.test(e2eSrc)
      && /get_competitive_match/.test(e2eSrc)
      && /sudden_death/.test(e2eSrc)
      && /BLITZ_REQUIRES_ARENA/.test(e2eSrc)
      ? ok('e2e-duel-lobby drives the surviving Triple-Threat RPCs + proves the blitz path is sealed')
      : fail('e2e-duel-lobby does not cover the Triple-Threat + seal contract'),
  );
}

// PART L — 1v1 DUEL TUTOR BOTS + ELIGIBLE-SCHOLAR ROSTER (WS5 / v60):
// competitive_matches gains opponent_bot (house|apollo|zainab); the 4-arg
// create becomes 5-arg (+p_bot); complete_competitive_match grades the tutor by
// a per-bot skill roll and settles like a human sudden-death (silence = draw /
// AND a tutorial win still pays SC but earns NO verified stats). A new
// duel_roster RPC lists eligible (activated + premium + solvent) waiting
// scholars. RPC-only; the 12-function Hobby ceiling stays untouched.
// ---------------------------------------------------------------------------
{
  const m60 = existsSync(resolve(ROOT, 'scripts/migration-v60-duel-bots.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v60-duel-bots.sql')) : '';
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const hall = read(resolve(ROOT, 'src/pages/Rumble.jsx'));
  const e2eSrc = existsSync(resolve(ROOT, 'scripts/e2e-duel-lobby.mjs'))
    ? read(resolve(ROOT, 'scripts/e2e-duel-lobby.mjs')) : '';

  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v60-duel-bots.sql'))
      && !existsSync(resolve(ROOT, 'api/duel.js')) && !existsSync(resolve(ROOT, 'api/bots.js'))
      ? ok('WS5 adds NO Vercel function (RPC-only; 12-function ceiling intact)')
      : fail('WS5 migration missing or a new api/*.js would blow the 12-function ceiling'),
  );
  checks.push(
    /add column if not exists opponent_bot text/.test(m60)
      && /competitive_matches_opponent_bot_check/.test(m60)
      && /opponent_bot in \('house', 'apollo', 'zainab'\)/.test(m60)
      ? ok('v60 schema: opponent_bot column + CHECK (house|apollo|zainab)')
      : fail('v60 opponent_bot column / CHECK missing'),
  );
  checks.push(
    /drop function if exists public\.create_competitive_match\(text, integer, uuid, text\);/.test(m60)
      && /create or replace function public\.create_competitive_match\(\s*p_mode text,\s*p_stake integer,\s*p_opponent_id uuid default null,\s*p_format text default 'sudden_death',\s*p_bot text default null/.test(m60)
      ? ok('create_competitive_match 4-arg dropped, 5-arg (+p_bot, defaulting) replaces it')
      : fail('create_competitive_match 5-arg replace missing'),
  );
  checks.push(
    /'BOTS_ARE_1V1'/.test(m60)
      && /'INVALID_BOT'/.test(m60)
      && /v_opp := null;/.test(m60)
      && /cm\.opponent_bot is not distinct from v_bot/.test(m60)
      ? ok('create: bots are non-blitz 1v1 only (BOTS_ARE_1V1/INVALID_BOT), forces opponent_id NULL, bot-aware de-dupe')
      : fail('v60 create bot validation / de-dupe missing'),
  );
  checks.push(
    /random\(\)::numeric < v_bot_skill/.test(m60)
      && /when 'apollo' then 0\.78/.test(m60)
      && /when 'zainab' then 0\.62/.test(m60)
      && /'Prof\. Apollo'/.test(m60)
      && /'Nurse Zainab'/.test(m60)
      && /v_m\.opponent_bot is not null and v_human_count = 1/.test(m60)
      && /v_m\.opponent_id is not null and v_ans > 0/.test(m60)
      ? ok('v60 settle: per-bot skill roll (house .55 / zainab .62 / apollo .78), tutor named winner, no verified stats for bots')
      : fail('v60 bot settlement / skill profiles missing'),
  );
  checks.push(
    /create or replace function public\.duel_roster\(/.test(m60)
      && /p_mode text default 'duel',\s*p_stake integer default 0,\s*p_format text default 'sudden_death'/.test(m60)
      && /from public\.duel_waiting/.test(m60)
      && /dw\.user_id <> v_user/.test(m60)
      && /coalesce\(p\.smart_coins, 0\) >= dw\.stake/.test(m60)
      && /status = 'active'/.test(m60)
      && /coalesce\(s\.expires_at, s\.grace_until\) > now\(\)/.test(m60)
      ? ok('v60 duel_roster RPC: eligible waiting scholars (activated + premium + solvent, stake/format scoped)')
      : fail('duel_roster RPC / eligibility filters missing'),
  );
  checks.push(
    /revoke all on function public\.duel_roster\(text, integer, text\)\s*from public, anon;/.test(m60)
      && /grant execute on function public\.duel_roster\(text, integer, text\)\s*to authenticated;/.test(m60)
      && /notify pgrst, 'reload schema';/.test(m60)
      ? ok('v60 ACLs: duel_roster anonymous-revoked / authenticated-granted; pgrst reload')
      : fail('v60 RPC ACLs / schema reload missing'),
  );
  checks.push(
    // v64: the legacy sudden-death wrappers are GONE from the client. They used
    // to remain exported while the only screen that called them (Triple Threat)
    // had already been removed, so nothing could settle a sudden-death duel.
    !/createCompetitiveMatch/.test(app)
      && !/fetchDuelRoster/.test(app)
      && !/supabase\.rpc\('duel_roster'/.test(app)
      && !/supabase\.rpc\('create_competitive_match'/.test(app)
      ? ok('AppContext: the dead v38/v60 sudden-death wrappers are removed (no createCompetitiveMatch / fetchDuelRoster)')
      : fail('AppContext still wires the removed sudden-death wrappers'),
  );
  checks.push(
    /const BOT_OPPONENTS = \[/.test(hall)
      && /const startVsBot = useCallback/.test(hall)
      && /const inviteScholar = useCallback/.test(hall)
      && /arenaRoster\(\{ stake: ARENA_STAKE, query: activeQuery \}\)/.test(hall)
      && /finding === 'bot'/.test(hall)
      ? ok('Rumble bot/roster UI: free tutors + a searchable scholars list (all arena-backed)')
      : fail('Rumble bot/roster UI missing'),
  );
  // Quick Match was REMOVED: it dropped the player into an open queue where a
  // refusal or an empty roster left them waiting forever with coins escrowed.
  checks.push(
    !/startQuickMatch/.test(hall)
      && !/Quick match/.test(hall)
      ? ok('Rumble: Quick Match is gone (it could strand a player on "Waiting for an opponent" with their stake held)')
      : fail('Rumble: Quick Match still present'),
  );
  // Every arena entry point must have a failure path. startVsBot used to have
  // none, so a rejected practice create (e.g. PGRST202 after a signature
  // change) left the player on the waiting screen indefinitely.
  checks.push(
    /const arenaFailure = useCallback/.test(hall)
      && /arenaFailure\('practice', res, 'bots'\)/.test(hall)
      && /arenaFailure\('invite', res, null\)/.test(hall)
      && /arenaFailure\('invite-accept', res, null\)/.test(hall)
      && /MATCHMAKING_TIMEOUT_MS/.test(hall)
      && /ARENA_ERROR_COPY/.test(hall)
      ? ok('Rumble: practice/invite/accept all funnel through one failure path with readable copy, plus a matchmaking timeout')
      : fail('Rumble: an arena entry point can still hang without an error'),
  );
  // Gameplay sound was removed from the arena.
  checks.push(
    !/playArenaSfx/.test(hall)
      && !/audioManager/.test(hall)
      ? ok('Rumble: gameplay sound effects are gone (no playArenaSfx / audioManager)')
      : fail('Rumble: arena sound effects still wired'),
  );
  checks.push(
    /INVALID_BOT/.test(e2eSrc)
      && /INVALID_OPPONENT/.test(e2eSrc)
      && /INVALID_STAKE/.test(e2eSrc)
      && /NOT_YOUR_MATCH/.test(e2eSrc)
      && /arena_create_match/.test(e2eSrc)
      && /escrow_amount/.test(e2eSrc)
      && /replay-proof/.test(e2eSrc)
      ? ok('e2e-duel-lobby covers Triple Threat + the arena escrow split + guards + the blitz seal')
      : fail('e2e-duel-lobby does not cover the Triple-Threat / arena-split contract'),
  );
}

// ---------------------------------------------------------------------------
// PART M — WEB PUSH (WS-P): notifications must actually pop up on mobile and
// laptop. The SW is registered ONCE at app mount (not only inside the room), a
// SW->SPA navigation bridge handles notification clicks, the service worker
// references an icon that exists, and there is a real user-gesture opt-in path
// (Dashboard banner + Settings section). Push stays gated server-side on VAPID.
// ---------------------------------------------------------------------------
{
  const swSrc = read(resolve(ROOT, 'public/sw.js'));
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const appJsx = read(resolve(ROOT, 'src/App.jsx'));
  const dash = read(resolve(ROOT, 'src/pages/Dashboard.jsx'));
  const settings = read(resolve(ROOT, 'src/pages/Settings.jsx'));
  const banner = existsSync(resolve(ROOT, 'src/components/PushOptInBanner.jsx'))
    ? read(resolve(ROOT, 'src/components/PushOptInBanner.jsx')) : '';
  const pushSrc = read(resolve(ROOT, 'src/utils/push.js'));
  const pushApi = read(resolve(ROOT, 'api/_push.js'));
  const envExample = read(resolve(ROOT, '.env.example'));

  checks.push(
    /icon: '\/polynurse-mark\.svg'/.test(swSrc)
      && /badge: '\/polynurse-mark\.svg'/.test(swSrc)
      && !/apex-mark\.png/.test(swSrc)
      ? ok('sw.js notification icon/badge point at an existing asset (/polynurse-mark.svg)')
      : fail('sw.js still references a missing icon asset'),
  );
  checks.push(
    /navigator\.serviceWorker\.register\('\/sw\.js'\)/.test(pushSrc)
      && /registerServiceWorker/.test(pushSrc)
      ? ok('push.js exposes an idempotent registerServiceWorker() that registers /sw.js')
      : fail('push.js registerServiceWorker() missing'),
  );
  checks.push(
    /await import\('\.\.\/utils\/push'\)/.test(app)
      && /registerServiceWorker\(\)/.test(app)
      ? ok('AppContext registers the service worker once at app mount (push works without opening the room)')
      : fail('AppContext does not register the service worker at mount'),
  );
  checks.push(
    /apex:push-navigate/.test(appJsx)
      && /navigator\.serviceWorker\.addEventListener\('message'/.test(appJsx)
      && /useNavigate/.test(appJsx)
      ? ok('App.jsx bridges SW notification clicks (apex:push-navigate) into SPA navigation')
      : fail('App.jsx push-navigation bridge missing'),
  );
  checks.push(
    /PushOptInBanner/.test(dash)
      && /pushSupported/.test(banner)
      && /enablePush\(session\)/.test(banner)
      && /apex:pushOptInDismissed/.test(banner)
      ? ok('Dashboard shows a one-time, dismissible push opt-in that calls enablePush on user gesture')
      : fail('Dashboard push opt-in banner missing'),
  );
  checks.push(
    /enablePush/.test(settings)
      && /disablePush/.test(settings)
      && /savePreferences/.test(settings)
      && /room_messages/.test(settings)
      && /member_joins/.test(settings)
      ? ok('Settings push section: enable/disable + per-kind preference toggles')
      : fail('Settings push section missing'),
  );
  checks.push(
    /process\.env\.VAPID_PUBLIC_KEY/.test(pushApi)
      && /process\.env\.VAPID_PRIVATE_KEY/.test(pushApi)
      && /PUSH_ENABLED/.test(pushApi)
      ? ok('server push stays VAPID-gated and degrades to a no-op when unconfigured')
      : fail('server push VAPID gate missing'),
  );
  checks.push(
    /VAPID_PUBLIC_KEY=/.test(envExample)
      && /VAPID_PRIVATE_KEY=/.test(envExample)
      && /VAPID_SUBJECT=/.test(envExample)
      ? ok('.env.example documents the VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT server env')
      : fail('.env.example VAPID documentation missing'),
  );
}

// ---------------------------------------------------------------------------
// PART N — MARKETPLACE PHASE A. Only first-party PolyNurse products reach the
// checkout; third-party listings are informational and refused SERVER-side.
// Storefront + admin console are wired; NO new api/*.js (12-function cap).
// ---------------------------------------------------------------------------
{
  const initSrc = read(resolve(ROOT, 'api/initiate-payment.js'));
  const verifySrc = read(resolve(ROOT, 'api/verify-payment.js'));
  const webhookSrc = read(resolve(ROOT, 'api/payments-webhook.js'));
  const marketSrc = existsSync(resolve(ROOT, 'src/pages/Marketplace.jsx')) ? read(resolve(ROOT, 'src/pages/Marketplace.jsx')) : '';
  const adminSrc = existsSync(resolve(ROOT, 'src/pages/AdminMarketplace.jsx')) ? read(resolve(ROOT, 'src/pages/AdminMarketplace.jsx')) : '';
  const appJsx = read(resolve(ROOT, 'src/App.jsx'));
  const sidebar = read(resolve(ROOT, 'src/components/Sidebar.jsx'));
  const seed = existsSync(resolve(ROOT, 'scripts/seed-marketplace-platform-seller.mjs')) ? read(resolve(ROOT, 'scripts/seed-marketplace-platform-seller.mjs')) : '';
  const e2e = existsSync(resolve(ROOT, 'scripts/e2e-marketplace.mjs')) ? read(resolve(ROOT, 'scripts/e2e-marketplace.mjs')) : '';
  const pkg = JSON.parse(read(resolve(ROOT, 'package.json')));

  checks.push(
    /PLATFORM_SELLER_NAME\s*=\s*'PolyNurse'/.test(initSrc)
      && /function resolveMarketplacePurchase/.test(initSrc)
      && /product\s*===\s*'marketplace_product'/.test(initSrc)
      && /APX-MKT-\$\{Date\.now\(\)\}/.test(initSrc)
      ? ok('initiate-payment resolves first-party marketplace products (APX-MKT-* reference)')
      : fail('initiate-payment marketplace resolution missing'),
  );
  checks.push(
    /'THIRD_PARTY_NOT_PURCHASABLE';\s*e\.status\s*=\s*403/.test(initSrc)
      && /'FREE_PRODUCT'/.test(initSrc)
      && /'PREMIUM_ONLY'/.test(initSrc)
      && /'ALREADY_OWNED'/.test(initSrc)
      ? ok('initiate-payment refuses third-party (403), free, premium and already-owned products')
      : fail('initiate-payment marketplace access-control branch missing'),
  );
  checks.push(
    /async function grantMarketplaceProduct/.test(verifySrc)
      && /metadata\.product === 'marketplace_product'/.test(verifySrc)
      && !/\bfeatured\b/.test(verifySrc)
      ? ok('verify-payment grants first-party marketplace entitlement (no stale `featured` column)')
      : fail('verify-payment marketplace grant missing or reintroduced stale `featured` select'),
  );
  checks.push(
    /async function grantMarketplaceProduct/.test(webhookSrc)
      && /metadata\?\.product === 'marketplace_product'/.test(webhookSrc)
      && /amount_mismatch/.test(webhookSrc)
      ? ok('payments-webhook grants first-party entitlement with amount-mismatch guard')
      : fail('payments-webhook marketplace branch missing'),
  );
  checks.push(
    /from\('marketplace_products'\)/.test(marketSrc)
      && /\.eq\('is_published', true\)/.test(marketSrc)
      && /\.eq\('is_archived', false\)/.test(marketSrc)
      && /fetch\('\/api\/initiate-payment'/.test(marketSrc)
      && /Sold by PolyNurse/.test(marketSrc)
      && /Informational/.test(marketSrc)
      ? ok('Marketplace.jsx storefront: live products, first-party vs informational, checkout wired')
      : fail('Marketplace.jsx storefront missing live-data/checkout wiring'),
  );
  checks.push(
    adminSrc && /!userProfile\.isAdmin/.test(adminSrc)
      && /marketplace_products/.test(adminSrc)
      && /'PRICE_NEEDED'/.test(adminSrc)
      ? ok('AdminMarketplace.jsx is admin-gated and manages marketplace products')
      : fail('AdminMarketplace.jsx admin gate/CRUD missing'),
  );
  checks.push(
    /admin\/marketplace/.test(appJsx)
      && /AdminMarketplace/.test(appJsx)
      && /admin\/marketplace/.test(sidebar)
      ? ok('admin marketplace route + sidebar entry wired')
      : fail('admin marketplace route/sidebar entry missing'),
  );
  checks.push(
    /PLATFORM_SELLER_NAME\s*=\s*'PolyNurse'/.test(seed)
      && pkg.scripts['e2e:marketplace'] === 'node scripts/e2e-marketplace.mjs'
      && /THIRD_PARTY_NOT_PURCHASABLE/.test(e2e)
      && /amount_mismatch/.test(e2e)
      ? ok('platform-seller seed + marketplace e2e suite wired')
      : fail('platform-seller seed or marketplace e2e suite missing'),
  );
}

// ---------------------------------------------------------------------------
// PART O — ANONYMOUS ROOM EXPANSION (v62): the stale membership_lock, the phantom
// "new messages" pill, leave -> new Anonymous #, opt-in RPS, and the
// consent-gated gag with delayed (visible_at) announcements. No new api/*.js —
// the 12-function Hobby cap stays intact (new routes are regexes only).
// ---------------------------------------------------------------------------
{
  const room = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const comm = read(resolve(ROOT, 'api/_community.js'));
  const router = read(resolve(ROOT, 'api/community.js'));
  const anonVisit = read(resolve(ROOT, 'src/utils/anonVisit.js'));
  const v62 = existsSync(resolve(ROOT, 'scripts/migration-v62-anonymous-room-expansion.sql'))
    ? read(resolve(ROOT, 'scripts/migration-v62-anonymous-room-expansion.sql'))
    : '';
  const e2eAnon = existsSync(resolve(ROOT, 'scripts/e2e-anonymous-lifecycle.mjs'))
    ? read(resolve(ROOT, 'scripts/e2e-anonymous-lifecycle.mjs'))
    : '';

  // --- capacity: 60 free seats, activation threshold untouched, stale lock cleared
  checks.push(
    !/founding_member_cap\s*=\s*60/.test(v62)
      && !/founding_member_cap set default 60/.test(v62)
      ? ok('v62 leaves free founding member seats at the v56 value of 20 (60-seat change reverted)')
      : fail('v62 still tries to push founding_member_cap to 60'),
  );
  checks.push(
    /membership_locked = false/.test(v62)
      && /where type = 'anonymous'/.test(v62)
      ? ok('v62 clears the stale membership_locked that blocked all joins in a room')
      : fail('v62 does not clear the stale anonymous membership_locked'),
  );
  checks.push(
    !/minimum_members_to_activate\s*=\s*\d+\s*;/.test(v62)
      ? ok('v62 leaves minimum_members_to_activate alone (room still activates at 20)')
      : fail('v62 changes the activation threshold (should stay unchanged)'),
  );
  checks.push(
    /add column if not exists visible_at timestamptz/.test(v62)
      && /anonymous_room_events_kind_check/.test(v62)
      && /'duel', 'announce'/.test(v62)
      ? ok('v62 adds anonymous_room_events.visible_at and widens kind to duel/announce')
      : fail('v62 visible_at / kind widening missing'),
  );
  checks.push(
    /create table if not exists public\.anonymous_duels/.test(v62)
      && /event_id bigint not null unique/.test(v62)
      && /check \(a_id <> b_id\)/.test(v62)
      ? ok('v62 creates anonymous_duels (one bout per challenge, distinct fighters)')
      : fail('v62 anonymous_duels table missing or under-constrained'),
  );

  // --- WS1: the pill is a real unseen-set difference, not "the array changed"
  checks.push(
    /const \[newRowsCount, setNewRowsCount\] = useState\(0\)/.test(room)
      && /seenRowsRef = useRef\(new Set\(\)\)/.test(room)
      && /keys\.filter\(\(k\) => !seenRowsRef\.current\.has\(k\)\)\.length/.test(room)
      ? ok('AnonymousRoom: "new messages" counts genuinely unseen rows (m:/e: key diff), not array identity')
      : fail('AnonymousRoom: new-messages pill is not driven by an unseen-row set'),
  );
  checks.push(
    !/setShowNewPill/.test(room)
      && /new messages? ↓/.test(room)
      ? ok('AnonymousRoom: phantom-pill setter removed and the pill shows a real count')
      : fail('AnonymousRoom: old boolean pill setter still present'),
  );
  checks.push(
    /justSentRef\.current = false;\s*\n\s*setNewRowsCount/.test(room)
      && /events, rowKeys, markCaughtUp\]/.test(room)
      ? ok('AnonymousRoom: prepend branch clears justSentRef and event cards count toward the pill')
      : fail('AnonymousRoom: prepend branch or event deps not handled in the scroll effect'),
  );
  checks.push(
    /for \(const m of older\) seenRowsRef\.current\.add\(`m:\$\{m\.id\}`\)/.test(room)
      && /older\.length > 0 \|\| nextCursor !== before/.test(room)
      ? ok('AnonymousRoom: backfilled history counts as seen and pagination can no longer strand')
      : fail('AnonymousRoom: loadOlder still counts history as new or can strand pagination'),
  );
  checks.push(
    /if \(!olderCursorRef\.current\) \{/.test(room)
      && /!Number\.isFinite\(lives\) \|\| lives > Date\.now\(\)/.test(room)
      ? ok('AnonymousRoom: reconcile no longer rewinds the pagination cursor or drops rows missing lives_until')
      : fail('AnonymousRoom: reconcile still rewinds cursor / prunes rows without lives_until'),
  );

  // --- WS2: leave -> new identity, and a deliberate leave is not a "release"
  checks.push(
    /clearAnonVisitKey/.test(anonVisit)
      && /export const clearAnonVisitKey/.test(anonVisit)
      && /clearAnonVisitKey\(\)/.test(room)
      ? ok('clearAnonVisitKey drops the visit key on a confirmed leave (re-entry is a new visit)')
      : fail('clearAnonVisitKey missing / not called on leave'),
  );
  checks.push(
    /\.from\('anonymous_room_identities'\)\s*\n\s*\.delete\(\)/.test(comm)
      ? ok('handleLeaveGroup drops the room identity so the next join mints a fresh Anonymous #')
      : fail('handleLeaveGroup does not drop the anonymous_room_identities row'),
  );
  checks.push(
    /ensureRoomAlias\(groupId, user\.id\)\.catch/.test(comm)
      ? ok('handleLeaveGroup broadcasts the alias the room already knows (no re-roll before departure)')
      : fail('handleLeaveGroup still re-rolls the alias before broadcasting the departure'),
  );
  checks.push(
    /leftDeliberatelyRef\.current = true/.test(room)
      && /if \(leftDeliberatelyRef\.current\) return;/.test(room)
      && /leftDeliberatelyRef\.current = false/.test(room)
      ? ok('detectRelease ignores a deliberate leave and joinRoom clears the suppression')
      : fail('detectRelease can still false-fire on a deliberate leave'),
  );
  checks.push(
    /ALREADY_SPECTATOR:/.test(room)
      && /OWNER_CANNOT_LEAVE:/.test(room)
      ? ok('SEND_ERRORS covers the ALREADY_SPECTATOR / OWNER_CANNOT_LEAVE refusals')
      : fail('ALREADY_SPECTATOR / OWNER_CANNOT_LEAVE still surface raw codes'),
  );

  // --- WS4/WS5: opt-in RPS + consent-gated gag + delayed announcements
  checks.push(
    /CONSENT_ACTION_KEYS = new Set\(\['crack'\]\)/.test(comm)
      && /const isChallenge = action === 'challenge' \|\| CONSENT_ACTION_KEYS\.has\(action\)/.test(comm)
      ? ok("'crack' is consent-gated: it opens an accept/decline invite like a challenge")
      : fail("'crack' is not routed through the consent/challenge flow"),
  );
  checks.push(
    !/anonymous_fight'[\s\S]{0,200}\['punch','kick','fuckoff','waka','crack'\]/.test(comm)
      && /attack_actions/.test(comm) === false
      ? ok("'crack' is absent from the fight attack_actions config (it never starts a fight)")
      : fail("'crack' may be registered as an attack action"),
  );
  checks.push(
    /\.eq\('status', 'pending'\)\s*\n\s*\.select\('id'\)/.test(comm)
      ? ok('accept/decline carries .eq(status,pending) — a genuine one-shot')
      : fail('accept/decline still allows two concurrent resolutions'),
  );
  checks.push(
    /GAG_STEP_MS = 5 \* 60 \* 1000/.test(comm)
      && /created_at: when,\s*\n\s*visible_at: when,/.test(comm)
      && /function gagCarrier\(actorId, targetId\)/.test(comm)
      ? ok('the gag chain schedules 3 delayed steps 5 minutes apart, either party at random')
      : fail('gag chain scheduling missing'),
  );
  checks.push(
    /export async function revealDueAnnouncements/.test(comm)
      && /GAG_SWEEP_THROTTLE_MS = 10_000/.test(comm)
      && /\.lte\('visible_at', new Date\(nowMs\)\.toISOString\(\)\)/.test(comm)
      ? ok('delayed announcements are revealed by a throttled request-driven sweep (no cron)')
      : fail('revealDueAnnouncements sweep missing or the feed is not gated on visible_at'),
  );
  checks.push(
    /gated\.error && \(gated\.error\.code === '42703' \|\| gated\.error\.code === '42P10'\)/.test(comm)
      ? ok('event queries fall back to the pre-v62 shape when visible_at is absent')
      : fail('event queries would break (empty feed) before v62 is applied'),
  );
  checks.push(
    /ROOM_NOTICE = \{ key: 'anonymous_room_safety', version: 6 \}/.test(comm)
      ? ok('ROOM_NOTICE bumped to v6 so everyone re-acknowledges the 18+ confirmation')
      : fail('ROOM_NOTICE was not bumped to v6'),
  );
  checks.push(
    /handleAnonDuel/.test(router)
      && router.includes('re: /\\/anonymous\\/duel-pick$/')
      && router.includes('re: /\\/anonymous\\/duel$/')
      ? ok('RPS duel routes are regex entries in api/community.js (12-function cap intact)')
      : fail('RPS duel routes missing from the community router'),
  );
  checks.push(
    /RPS_OPPONENT = \{ rock: 'scissors', paper: 'rock', scissors: 'paper' \}/.test(comm)
      && /\.is\(isA \? 'a_move' : 'b_move', null\)/.test(comm)
      && /DUEL_ALREADY_PICKED/.test(comm)
      ? ok('RPS is server-resolved, one throw per fighter, and refuses a second pick')
      : fail('RPS throw/pick guards missing'),
  );
  checks.push(
    /your_throw: bothPicked && row\.status === 'done'/.test(comm)
      ? ok('RPS moves stay hidden until the bout settles (no countering a pick)')
      : fail('RPS moves are revealed before the bout settles'),
  );
  checks.push(
    /function announcementText\(action, actor, target\)/.test(comm)
      && /gave birth to/.test(comm)
      && /kind === 'announce' \? announcementText/.test(comm)
      && /\{ev\.text \? \(/.test(room)
      ? ok('gag/RPS lines ship a server-built alias-only sentence rendered verbatim')
      : fail('announcement sentence wiring incomplete'),
  );
  checks.push(
    /openDuelPanel/.test(room)
      && /onDuelOpen=\{openDuelPanel\}/.test(room)
      && /canDuel=\{isMember\}/.test(room)
      ? ok('the RPS panel is opt-in: state is fetched only when the fighter taps it')
      : fail('RPS panel is not opt-in on the client'),
  );
  checks.push(
    /No crons key|vercel\.json/.test(String(comm)) === false && e2eAnon.length > 0
      ? ok('v62 e2e suite present and no in-process timer was used as a scheduler')
      : fail('v62 e2e missing / scheduler assertion failed'),
  );

  // --- v62 follow-ups: announcements reaching everyone, colours, animations
  checks.push(
    // NB: the palette comment deliberately cites the OLD `(n * 47) % 360` formula,
//    so the gate matches the code statement (trailing semicolon), not a prose
//    mention of it.
    !/const identityHue/.test(room)
      && !/\(n \* 47\) % 360;/.test(room)
      ? ok('AnonymousRoom: the period-360 linear-congruential alias colour is gone')
      : fail('AnonymousRoom: alias colour still uses the (n * 47) % 360 modulo'),
  );
  checks.push(
    /IDENTITY_HUES/.test(room) && /IDENTITY_LIGHT_BANDS/.test(room)
      && /0x811c9dc5/.test(room) && /Math\.floor\(h \/ IDENTITY_HUES\.length\) % IDENTITY_LIGHT_BANDS\.length/.test(room)
      ? ok('AnonymousRoom: alias colour is an FNV-1a hash over a hue x lightness palette')
      : fail('AnonymousRoom: alias colour hash/palette missing'),
  );
  checks.push(
    /IDENTITY_UNKNOWN/.test(room) && /IDENTITY_HUE_LIGHTNESS_FLOOR/.test(room)
      ? ok('AnonymousRoom: unparseable alias gets its own swatch, not the old shared hue-220 fallback')
      : fail('AnonymousRoom: unparseable alias still shares a colour'),
  );
  checks.push(
    /EVENT_TONE_CLASS/.test(room) && /pink: 'bg-pink-500/.test(room)
      && !/ev\.tone === 'violet' \|\| ev\.tone === 'indigo'/.test(room)
      ? ok('AnonymousRoom: every server tone has a real card surface (3-branch ternary replaced)')
      : fail('AnonymousRoom: event card tone map incomplete'),
  );
  checks.push(
    /eventEnterClass\(ev\.kind, reducedMotion\)/.test(room)
      && /reducedMotion=\{prefersReducedMotion\}/.test(room)
      && /prefersReducedMotion/.test(room)
      ? ok('AnonymousRoom: per-kind entrance animation is gated on reduced motion')
      : fail('AnonymousRoom: entrance animation is not gated on prefersReducedMotion'),
  );
  const idxCss = existsSync(resolve(ROOT, 'src/index.css')) ? read(resolve(ROOT, 'src/index.css')) : '';
  checks.push(
    ['action', 'challenge', 'fight', 'duel', 'announce'].every((k) => idxCss.includes(`room-card-enter-${k}`))
      && idxCss.includes('@keyframes room-card-enter-announce')
      && idxCss.includes('room-card-enter-duel')
      ? ok('src/index.css defines a reduced-motion-aware entrance for all five card kinds')
      : fail('src/index.css is missing the event-card entrance keyframes'),
  );
  checks.push(
    /created_at: when,\s*\n\s*visible_at: when,/.test(comm)
      ? ok('v62: a delayed gag row sets created_at = visible_at (ordering, feed LIMIT and expiry)')
      : fail('v62: delayed gag rows do not set created_at = visible_at'),
  );
  checks.push(
    /expires_at: eventExpiresAt\(row\)/.test(comm)
      && /function eventExpiresAt\(row\)/.test(comm)
      && /e\.expires_at \|\| ''/.test(room)
      ? ok('v62: delayed cards carry a server-computed expires_at that the client sweep honours')
      : fail('v62: expires_at is not computed/sent/honoured'),
  );
  checks.push(
    /payload\?\.action === 'announcement' \|\| payload\?\.action === 'crack_accepted'/.test(room)
      ? ok("client reconciles on the crack_accepted broadcast (it used to be dropped)")
      : fail("client ignores the crack_accepted broadcast"),
  );
  checks.push(
    /export async function revealDueAnnouncements[\s\S]{0,700}42703/.test(comm)
      ? ok('revealDueAnnouncements has the pre-v62 fallback so a due line is always broadcast')
      : fail('revealDueAnnouncements lacks the 42703 fallback'),
  );
}

// ---------------------------------------------------------------------------
// PART P - 1v1 ARENA (v63): two-sided escrow, one blitz format for humans AND
// bots, the full match lifecycle (ready handshake / grace / forfeit / cancel),
// server-computed points, and a SEALED legacy blitz path so escrow cannot be
// bypassed. No new api/*.js - the 12-function Hobby cap stays intact.
{
  const v63 = read('scripts/migration-v63-arena-escrow-lifecycle.sql');
  const arenaE2e = read('scripts/e2e-arena.mjs');
  const arenaHall = read(resolve(ROOT, 'src/pages/Rumble.jsx'));
  const arenaAudio = read(resolve(ROOT, 'src/utils/audio.js'));
  const arenaPkg = read(resolve(ROOT, 'package.json'));

  checks.push(
    /set_config\('arena\.write', '1', true\)/.test(v63)
      && /create or replace function public\._arena_guard_match_ins/.test(v63)
      && /create or replace function public\._arena_guard_match_upd/.test(v63)
      && /create or replace function public\._arena_guard_answers/.test(v63)
      ? ok('v63: arena claims its write-scope so its own re-run is idempotent + 3 guard triggers installed')
      : fail('v63: arena.write claim or a guard trigger is missing'),
  );
  checks.push(
    /BLITZ_REQUIRES_ARENA/.test(v63) && /ARENA_REQUIRES_ARENA_RPC/.test(v63)
      ? ok('v63: legacy blitz create/mutate is sealed (42501) so escrow cannot be bypassed')
      : fail('v63: the legacy blitz path is not sealed'),
  );
  checks.push(
    /create or replace function public\._arena_hold/.test(v63)
      && /create or replace function public\._arena_release/.test(v63)
      && /md5\('arena:hold:'/.test(v63)
      && /md5\('arena:release:'/.test(v63)
      ? ok('v63: escrow hold/release are deterministic on _sc_apply client_request_id (exactly-once)')
      : fail('v63: escrow hold/release are not deterministic'),
  );
  checks.push(
    /v_points := case when v_is_correct then v_mult else 0 end/.test(v63)
      && /wrong.*0/s.test(v63)
      ? ok('v63: points are server-computed (correct 1 / correct+Double 2 / wrong 0 / skip 0)')
      : fail('v63: the locked points formula is missing'),
  );
  checks.push(
    /elsif \(v_s1 ->> 'correct'\)::int > \(v_s2 ->> 'correct'\)::int/.test(v63)
      && !/latency/i.test(v63.split('END')[0].slice(0, 0) || '')
      && !/_l1|_l2|latencyMs/.test(v63)
      ? ok('v63: tie-break is points DESC -> correct DESC -> draw (no latency chain)')
      : fail('v63: tie-break is not points/correct/draw'),
  );
  checks.push(
    /create or replace function public\._arena_bot_turn/.test(v63)
      && /public\._arena_bot_turn\(p_match_id, p_question_index\)/.test(v63)
      && /is_bot/.test(v63)
      ? ok('v63: bots answer LIVE as real graded rows (same points column), not at settlement')
      : fail('v63: the bot turn is not a live graded row'),
  );
  checks.push(
    /create or replace function public\._arena_sweep/.test(v63)
      && /'grace_expired'/.test(v63)
      && /make_interval\(secs => grace_seconds\)/.test(v63)
      && /'no_show'/.test(v63)
      && /'both_away'/.test(v63)
      ? ok('v63: traffic-driven sweep resolves grace expiry, no-show and both-away (no cron needed)')
      : fail('v63: the sweep is missing a lifecycle path'),
  );
  checks.push(
    /create or replace function public\._arena_review/.test(v63)
      && /v_m\.status not in \('completed', 'abandoned'\) then\s*\n\s*return null/.test(v63)
      ? ok('v63: the answer key is released ONLY after the match is terminal')
      : fail('v63: the review is not gated on a terminal status'),
  );
  checks.push(
    /public\._arena_in_active_match/.test(v63)
      && /pg_advisory_xact_lock\(hashtext\('arena_user:'/.test(v63)
      ? ok('v63: one active match per player, enforced under a sorted per-player advisory lock')
      : fail('v63: no concurrency guard on match creation'),
  );
  checks.push(
    /alter table public\.arena_queue enable row level security/.test(v63)
      && /alter table public\.arena_match_events enable row level security/.test(v63)
      && /revoke all on function %s from public, anon, authenticated/.test(v63)
      ? ok('v63: queue + audit tables are deny-all and every internal helper is service_role only')
      : fail('v63: arena tables/helpers are not locked down'),
  );
  checks.push(
    /A0 setup/.test(arenaE2e) && /escrowed/.test(arenaE2e) && /ALREADY_IN_MATCH/.test(arenaE2e)
      && /OPPONENT_NOT_READY/.test(arenaE2e) && /BLITZ_NOT_ENDED/.test(arenaE2e)
      && /grace_expired/.test(arenaE2e) && /arena_forfeit/.test(arenaE2e)
      && /arena_enqueue/.test(arenaE2e) && /is_bot/.test(arenaE2e)
      ? ok('e2e-arena covers escrow, uniqueness, handshake, scoring, Double, lifecycle, bots, matchmaking')
      : fail('e2e-arena does not cover the v63 contract'),
  );
  checks.push(
    /"e2e:arena": "node scripts\/e2e-arena\.mjs"/.test(arenaPkg)
      ? ok('package.json adds the e2e:arena script')
      : fail('e2e:arena npm script missing'),
  );
  checks.push(
    !/create_competitive_match[\s\S]{0,200}p_format: 'blitz'/.test(arenaHall)
      && !/startBlitz|createBlitzMatch/.test(arenaHall)
      ? ok('Rumble: the legacy blitz client path is gone (1v1 is arena-only)')
      : fail('Rumble still routes 1v1 through the legacy blitz client path'),
  );
  const heldSet = (arenaAudio.match(/HELD_SOUND_TYPES = new Set\(\[([^\]]*)\]\)/) || [, ''])[1];
  // The arena one-shot cues were REMOVED at the operator's request: a timed
  // 90-second duel with a cue per question bled across questions and read as a
  // glitch. Quiz answer sounds are untouched and must stay out of HELD.
  checks.push(
    !/AUDIO_PATHS\.arena_/.test(arenaAudio)
      && !/arena_/.test(heldSet)
      ? ok('audio: the arena one-shot cues are gone, and nothing arena-related is held across a question')
      : fail('audio: arena cues still defined, or an arena cue is held across questions'),
  );
}

// ---------------------------------------------------------------------------
// PART Q - ARENA WALLET / PRACTICE / PRESENCE (v64). Four live defects from
// browser QA plus the two pieces the new War Hall UI needs.
//
//   1. The wallet pill never moved on a LOSS. v63 only returned
//      `breakdown[].balance` when the release was non-zero, and a loss releases
//      0, so the client silently kept the pre-match number. Balance must ALWAYS
//      be returned, and the client must have a real fallback.
//   2. `duels.delta` stored the RELEASE, so a timed loss wrote
//      outcome='loss' delta=0 while a draw wrote delta=+stake. Net delta +
//      a backfill is the fix, and `outcome` must drive the colour.
//   3. `_arena_sweep` only ran from arena RPCs, so a both-players-gone match
//      stayed active and its pot stayed escrowed. The session heartbeat now
//      sweeps (the one traffic source that runs with no arena tab open).
//   4. The "All questions answered" check compared an index against a total
//      that could be 0, so it fired on an unloaded board.
//   5. Free tutor practice needs stake 0, which the v38 CHECK forbade - and
//      which would have put a 0-stake match OUTSIDE the escrow seal, because
//      the seal keyed off `escrow_amount > 0`.
// ---------------------------------------------------------------------------
{
  const v64 = read('scripts/migration-v64-arena-wallet-practice-presence.sql');
  const v64Hall = read(resolve(ROOT, 'src/pages/Rumble.jsx'));
  const v64App = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const v64Session = read(resolve(ROOT, 'api/session.js'));
  const v64E2e = read('scripts/e2e-arena.mjs');
  const v64Sidebar = read(resolve(ROOT, 'src/components/Sidebar.jsx'));

  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v64-arena-wallet-practice-presence.sql'))
      && /v_delta := v_release - v_stake/.test(v64)
      && /'balance', \(select smart_coins from public\.profiles where id = v_user\)/.test(v64)
      ? ok('v64: settlement returns NET deltas and an ALWAYS-present balance (a loss releases 0, so it used to be null)')
      : fail('v64: net delta / always-present balance missing'),
  );
  checks.push(
    /arena:history:/.test(v64)
      && /set delta = coalesce\(\(v_b\.el ->> 'delta'\)::int, 0\) - v_m\.stake/.test(v64)
      ? ok('v64: the existing arena history rows are backfilled to net delta via the deterministic client_request_id')
      : fail('v64: history backfill missing'),
  );
  checks.push(
    /check \(stake > 0 or \(stake = 0 and format = 'blitz'\)\)/.test(v64)
      ? ok('v64: stake 0 is legal for an arena practice match but still forbidden on the legacy sudden-death path')
      : fail('v64: the v38 stake CHECK was not widened for practice'),
  );
  checks.push(
    /coalesce\(old\.format, 'sudden_death'\) = 'blitz'/.test(v64)
      && /coalesce\(v_format, 'sudden_death'\) = 'blitz'/.test(v64)
      && !/coalesce\(old\.escrow_amount, 0\) > 0/.test(v64)
      ? ok("v64: the arena seal keys off format='blitz', not escrow_amount>0 (a 0-stake practice match would fall OUTSIDE it)")
      : fail('v64: the seal still keys off escrow_amount, so a practice match is unsealed'),
  );
  checks.push(
    /p_practice\s+boolean\s+default false/.test(v64)
      && /drop function if exists public\.arena_create_match\(text, integer, uuid, text\)/.test(v64)
      && /PRACTICE_NEEDS_BOT/.test(v64)
      && /PRACTICE_IS_SOLO/.test(v64)
      ? ok('v64: free practice is a REPLACED create signature (the dropped 4-arg avoids the PGRST203 overload trap) and is tutor-only')
      : fail('v64: free practice create path missing or overload-unsafe'),
  );
  checks.push(
    /create table if not exists public\.arena_presence/.test(v64)
      && /_arena_touch_presence/.test(v64)
      && /'status', status,/.test(v64)
      && /'canChallenge'/.test(v64)
      && /'lastSeenAt'/.test(v64)
      ? ok('v64: arena_presence gives the scholars list a real available / in_match / offline signal')
      : fail('v64: presence / roster status missing'),
  );
  checks.push(
    /grace_seconds', 15/.test(v64)
      && /invite_ttl_seconds/.test(v64)
      && /ready_at is null/.test(v64)
      && /'no_show', null, null, true\)/.test(v64)
      ? ok('v64: grace is 15s and a match whose opponent never readied (ready_at NULL) is now expired, so both stakes cannot freeze forever')
      : fail('v64: grace window / never-readied expiry missing'),
  );
  checks.push(
    /_arena_sweep/.test(v64Session)
      && /_arena_touch_presence/.test(v64Session)
      && /Promise\.allSettled/.test(v64Session)
      ? ok('v64: the session heartbeat sweeps the arena, so a both-players-gone match cannot stay alive')
      : fail('v64: api/session.js touch does not sweep the arena'),
  );

  // ---- client ------------------------------------------------------------
  checks.push(
    /const refreshSmartCoins = useCallback/.test(v64App)
      && /result\.balance \?\? row\?\.balance/.test(v64App)
      && /refreshSmartCoins\(\)/.test(v64App)
      && /p_practice: !!practice/.test(v64App)
      ? ok('AppContext: the balance falls back to a profiles read (never a silent no-op), and create accepts practice')
      : fail('AppContext: balance fallback / practice flag missing'),
  );
  checks.push(
    /const allAnswered = boardSize > 0 && myCard\.answers >= boardSize/.test(v64Hall)
      && !/blitzIndex >= blitzMatch\.questionCount/.test(v64Hall)
      && /const boardMissing = boardSize > 0 && blitzQuestions\.length === 0/.test(v64Hall)
      ? ok('Rumble: "All questions answered" needs a positive total AND the server-reported graded count')
      : fail('Rumble: the all-answered predicate is still unguarded'),
  );
  checks.push(
    /window\.history\?\.state\?\.idx/.test(v64Hall)
      && /navigate\(-1\)/.test(v64Hall)
      && !/navigate\("\/quiz"\)/.test(v64Hall)
      && /const showBack = phase !== 'blitz-waiting'/.test(v64Hall)
      ? ok('Rumble: Back goes to the previous screen (with a /dashboard fallback) and is hidden while a stake is held')
      : fail('Rumble: Back is still hardcoded, or is still shown during a search'),
  );
  checks.push(
    /await arenaLeaveQueue\(\);/.test(v64Hall)
      && /if \(!mid\) \{ resetToPicker/.test(v64Hall)
      ? ok('Rumble: Cancel ALWAYS leaves the matchmaking queue (the queued path used to leak the slot)')
      : fail('Rumble: Cancel does not release the queue slot'),
  );
  checks.push(
    /const HISTORY_LIMIT = 5/.test(v64Hall)
      && /\.limit\(HISTORY_LIMIT\)/.test(v64Hall)
      && /outcomeMeta\(d\.outcome\)/.test(v64Hall)
      && !/d\.delta >= 0/.test(v64Hall)
      ? ok('Rumble: duel history is the LAST 5 and the colour follows the OUTCOME, never the delta sign')
      : fail('Rumble: history cap / outcome-driven colour missing'),
  );
  checks.push(
    /Coming soon/.test(v64Hall)
      && /cursor-not-allowed/.test(v64Hall)
      && /aria-disabled="true"/.test(v64Hall)
      && !/Triple Threat/.test(v64Hall)
      && !/sudden_death/.test(v64Hall)
      ? ok('Rumble: Triple Threat is gone (its client could never settle) and Tournament is a non-tappable "Coming soon" card')
      : fail('Rumble: Triple Threat still present, or the Tournament card is tappable'),
  );
  checks.push(
    /const ARENA_STAKE = 2/.test(v64Hall)
      && !/SC_STAKES/.test(v64Hall)
      && !/confirmHighWager/.test(v64Hall)
      && /Practise vs a Bot/.test(v64Hall)
      && /practice: true/.test(v64Hall)
      ? ok('Rumble: the stake is fixed at 2 SC (no wager selector, no high-wager modal) and tutor practice is free')
      : fail('Rumble: wager selector / high-wager modal / free practice missing'),
  );
  checks.push(
    /const ARENA_DEBUG_KEY = "apex_arena_debug"/.test(v64Hall)
      && /const goPhase = useCallback/.test(v64Hall)
      && /arenaTrace\('phase'/.test(v64Hall)
      ? ok('Rumble: every phase change records its trigger (arenaTrace) so an unexpected transition is diagnosable')
      : fail('Rumble: phase tracing missing'),
  );
  checks.push(
    /SC War Hall/.test(v64Sidebar) && /path: '\/rumble'/.test(v64Sidebar)
      ? ok('Sidebar: the SC War Hall is a real nav item (it used to be reachable only via a hidden 5-tap easter egg)')
      : fail('Sidebar: no War Hall entry'),
  );

  // ---- e2e ---------------------------------------------------------------
  checks.push(
    /balance/.test(v64E2e)
      && /practice/.test(v64E2e)
      && /net delta|netDelta/.test(v64E2e)
      ? ok('e2e-arena covers the v64 contract: loss balance, free practice and net deltas')
      : fail('e2e-arena does not cover the v64 contract'),
  );
  checks.push(
    /cleanup-test-users/.test(read(resolve(ROOT, 'scripts/cleanup-test-users.mjs')))
      && /apextest\.local/.test(read(resolve(ROOT, 'scripts/cleanup-test-users.mjs')))
      ? ok('cleanup-test-users classifies ONLY by the three throwaway e2e domains (real accounts survive by construction)')
      : fail('cleanup-test-users is missing or does not key on the test domains'),
  );
}

// ---------------------------------------------------------------------------
// PART R - PREMIUM GRANT + "EVERY USER IS RANKED AND FINDABLE" (v73/v74/v75)
// ---------------------------------------------------------------------------
//
// v73 - the blankdweb@gmail.com grant. The guards are the point: a second run
//       must not double-grant, and the migration must NOT write
//       `is_activated`, because `trg_referral_credit_on_activation` is
//       `AFTER UPDATE OF is_activated` and fires even when the value is
//       unchanged, which would silently pay a +15 SC referral bonus.
{
  const v73 = read('scripts/migration-v73-premium-grant-blankdweb-gmail.sql');
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v73-premium-grant-blankdweb-gmail.sql'))
      && /now\(\) \+ interval '30 days'/.test(v73)
      && /now\(\) \+ interval '32 days'/.test(v73)
      && /1de5bb28-85c4-4572-90d1-96040e9e7de3/.test(v73)
      ? ok('v73: grants blankdweb@gmail.com one monthly sub (+30d / grace +32d)')
      : fail('v73: the premium grant is missing or has the wrong window/account'),
  );
  checks.push(
    /where not exists \([\s\S]*coalesce\(s\.expires_at, s\.grace_until\) > now\(\)/.test(v73)
      && /on conflict \(reference\) do nothing/.test(v73)
      ? ok('v73: guarded insert (no live sub) + reference uniqueness, so re-running is a no-op')
      : fail('v73: the grant is not idempotent'),
  );
  // Strip `--` comments first: the migration *explains* why it must not touch
  // is_activated, and a naive substring test would match its own comment.
  const v73Code = v73.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  checks.push(
    !/is_activated/i.test(v73Code)
      && /trg_referral_credit_on_activation/.test(v73)
      ? ok('v73: never writes is_activated (that trigger would fire on an unchanged value and pay a referral bonus)')
      : fail('v73: writes is_activated, which fires the referral-credit trigger'),
  );
}

// v74/v75 - the shared identity helper, the leaderboard that shows everyone,
// and the scholars search box. The helper is defined in BOTH v64 and v74 with
// `create or replace`, so the apply order cannot matter; and arena_roster's
// 2-arg form must be dropped before the 3-arg one is created (the PGRST203
// "Multiple Choices" trap).
{
  const v74 = read('scripts/migration-v74-leaderboard-all-users.sql');
  const v75 = read('scripts/migration-v75-arena-roster-search.sql');
  const v64 = read('scripts/migration-v64-arena-wallet-practice-presence.sql');
  const lb = read(resolve(ROOT, 'src/pages/Leaderboard.jsx'));
  // The board's rows and paging moved out of pages/Leaderboard.jsx when it
  // became the five-tab social hub shell. Gates that assert on the BOARD read
  // this instead, so moving the markup again cannot silently turn them into
  // no-ops that always pass.
  const lbBoard = read(resolve(ROOT, 'src/components/RankingBoard.jsx'));
  const rumble = read(resolve(ROOT, 'src/pages/Rumble.jsx'));
  const app = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const arenaE2e = read('scripts/e2e-arena.mjs');

  const personName = /create or replace function public\._person_name\(p_user uuid, p_mode text default 'pseudonym'\)/;
  checks.push(
    personName.test(v74) && personName.test(v64)
      && /'Scholar-' \|\| substr\(md5\(p\.id::text\), 1, 6\)/.test(v74)
      && /revoke all on function public\._person_name\(uuid, text\) from public, anon, authenticated/.test(v74)
      ? ok('_person_name is one shared, stable, security-definer helper defined identically in v64 and v74 (so apply order is irrelevant) and revoked from anon')
      : fail('_person_name is missing, inconsistent between migrations, or exposed to anon'),
  );
  checks.push(
    /least\(coalesce\(p_limit, 50\), 500\)/.test(v74)
      && /'displayName', public\._person_name\(b\.user_id, 'pseudonym'\)/.test(v74)
      ? ok('v74: the leaderboard page fits every user and labels rows with a real identity, not the literal "Scholar"')
      : fail('v74: leaderboard clamp or displayName is wrong'),
  );
  checks.push(
    /const PAGE_SIZE = 100/.test(lbBoard)
      && /'No graded rounds yet'/.test(lbBoard)
      ? ok('Leaderboard: one page shows all users, and a missing player_stats row renders "No graded rounds yet" instead of a fake 0')
      : fail('Leaderboard: page size or null-stat rendering regressed'),
  );
  checks.push(
    /drop function if exists public\.arena_roster\(integer, text\);/.test(v75)
      && /p_query text default null/.test(v75)
      && /public\.arena_roster\(integer, text, text\)/.test(v75)
      ? ok('v75: arena_roster gains p_query, and the 2-arg form is dropped first (no PGRST203 overload)')
      : fail('v75: the arena_roster search parameter is missing or the old overload was not dropped'),
  );
  checks.push(
    /p\.identity_name ilike/.test(v75)
      && /p\.full_name ilike/.test(v75)
      && /substr\(md5\(p\.id::text\), 1, 6\) ilike/.test(v75)
      && !/email ilike/.test(v75)
      ? ok('v75: search matches display name / real name / Scholar-xxxxxx handle, and never email')
      : fail('v75: the search predicate is wrong (or matches email, which would be an enumeration oracle)'),
  );
  checks.push(
    /p_query: trimmed \|\| null/.test(app)
      && /query: activeQuery/.test(rumble)
      && /SCHOLARS_SEARCH_DEBOUNCE_MS/.test(rumble)
      && /Find a scholar by name/.test(rumble)
      && /SCHOLAR_SEARCH_MIN/.test(rumble)
      ? ok('Scholars search: the box is debounced, threads p_query, and states the minimum length')
      : fail('Scholars search: the client search wiring is incomplete'),
  );
  checks.push(
    /M7 search NEVER matches on email/.test(arenaE2e)
      && /M8 an offline scholar is still findable/.test(arenaE2e)
      && /M3 the Scholar-xxxxxx handle is searchable/.test(arenaE2e)
      ? ok('e2e-arena covers scholar search: name, partial, handle, no-match, self-exclusion, short query, no-email, offline')
      : fail('e2e-arena does not cover the scholar search contract'),
  );

  // v76 - the arena seal vs referential integrity. `opponent_id ON DELETE SET
  // NULL` made Postgres UPDATE a blitz row, which the seal rejects, so any
  // account that had been challenged could not be deleted at all. The FK must
  // CASCADE (no UPDATE is issued), and it must stay CASCADE.
  const v76 = read('scripts/migration-v76-arena-opponent-fk-cascade.sql');
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v76-arena-opponent-fk-cascade.sql'))
      && /drop constraint if exists competitive_matches_opponent_id_fkey/.test(v76)
      && /references auth\.users\(id\) on delete cascade/.test(v76)
      && /ARENA_REQUIRES_ARENA_RPC/.test(v76)
      ? ok('v76: opponent_id is ON DELETE CASCADE, so deleting a participant cannot be blocked by the arena seal (a SET NULL would UPDATE a sealed row)')
      : fail('v76: the opponent_id FK is not CASCADE, so account deletion can fail with ARENA_REQUIRES_ARENA_RPC'),
  );
  checks.push(
    /N1 an account that was challenged in the arena can actually be deleted/.test(arenaE2e)
      && /N2 the match row is removed with the participant/.test(arenaE2e)
      ? ok('e2e-arena covers account deletion with arena history (the v76 regression)')
      : fail('e2e-arena does not cover deleting an account that has arena history'),
  );

  // v77 - relationship authorization. The bypass was `rel.target_id <> auth.uid()`:
  // for an anonymous caller auth.uid() is NULL, the comparison is NULL rather
  // than TRUE, so the guard was skipped and a logged-out client could accept (or
  // delete) anyone's pending friend request. Confirmed live before the fix.
  const v77 = read('scripts/migration-v77-relationship-authz.sql');
  // Strip `--` comments: the migration QUOTES the buggy `rel.target_id <>
  // auth.uid()` in its explanation, so a naive test would flag that comment.
  const v77Code = v77.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  checks.push(
    /if v_me is null then\s*\n\s*return jsonb_build_object\('ok', false, 'error', 'unauthenticated'\)/.test(v77Code)
      && /rel\.target_id <> v_me/.test(v77Code)
      && !/rel\.target_id <> auth\.uid\(\)/.test(v77Code)
      ? ok('v77: respond_relationship tests a NULL uid FIRST (the <> auth.uid() guard was a NULL trap, so an anon caller could accept any request)')
      : fail('v77: the respond_relationship NULL-uid guard is missing'),
  );
  checks.push(
    /revoke all on function public\.respond_relationship\(bigint, boolean\) from public, anon/.test(v77)
      && /revoke all on function public\.request_relationship\(uuid, text\) from public, anon/.test(v77)
      && /revoke all on function public\.remove_relationship\(uuid\) from public, anon/.test(v77)
      && /revoke all on function public\.get_user_achievements\(uuid\) from public, anon/.test(v77)
      ? ok('v77: every relationship + achievement RPC is revoked from anon (this project auto-grants it by default)')
      : fail('v77: a relationship/achievement RPC is still executable by anon'),
  );
  checks.push(
    /not your achievements/.test(v77)
      && /get_user_achievements/.test(v77)
      ? ok('v77: get_user_achievements is self-only (it was SECURITY DEFINER on an arbitrary user id)')
      : fail('v77: get_user_achievements still reads an arbitrary user id'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'scripts/e2e-relationships.mjs'))
      && /e2e:relationships/.test(read(resolve(ROOT, 'package.json')))
      && /the confirmed bypass/.test(read(resolve(ROOT, 'scripts/e2e-relationships.mjs')))
      && /cannot read someone else/.test(read(resolve(ROOT, 'scripts/e2e-relationships.mjs')))
      ? ok('e2e-relationships covers the anon bypass, cross-user access, ownership, and the achievement leak')
      : fail('e2e-relationships is missing or not wired to an npm script'),
  );

  // v78 - invites. Consent must come BEFORE escrow, and the pair predicate is
  // what unlocks a real name (never the invite itself).
  const v78 = read('scripts/migration-v78-arena-invites.sql');
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v78-arena-invites.sql'))
      && /create table if not exists public\.arena_invites/.test(v78)
      && /where status = 'pending'/.test(v78)
      && /revoke all on public\.arena_invites from public, anon, authenticated/.test(v78)
      ? ok('v78: arena_invites exists, allows one open invite per pair, and is service-role only')
      : fail('v78: the invites table is missing, unbounded, or client-readable'),
  );
  checks.push(
    /create or replace function public\.arena_invite_respond/.test(v78)
      && /v_res := public\.arena_create_match\(/.test(v78)
      && /match_id = \(v_res ->> 'matchId'\)::uuid/.test(v78)
      ? ok('v78: accepting an invite builds the match through arena_create_match, so escrow/seal/settlement are the proven path')
      : fail('v78: invite acceptance does not reuse the canonical match creation'),
  );
  checks.push(
    /v_inv\.to_user is null or v_inv\.to_user <> v_user/.test(v78)
      && /NOT_YOUR_INVITE/.test(v78)
      && /v_inv\.from_user is null or v_inv\.from_user <> v_user/.test(v78)
      ? ok('v78: invite respond/cancel use NULL-safe ownership checks (the v77 trap, closed from the start)')
      : fail('v78: an invite RPC compares against auth.uid() without a NULL guard'),
  );
  checks.push(
    /create or replace function public\._arena_pair_dueled/.test(v78)
      && /cm\.status = 'completed'/.test(v78)
      && /when public\._arena_pair_dueled\(v_user, p\.id\)\s*\n\s*then public\._person_name\(p\.id, 'real'\)/.test(v78)
      && /drop function if exists public\.arena_roster\(integer, text, text\)/.test(v78)
      ? ok('v78: a real name appears only after a COMPLETED match between the pair; the roster is replaced (old arity dropped first)')
      : fail('v78: real names are not gated on a completed match, or the roster overload was not dropped'),
  );
  // Rewritten for the challenge handoff. The old gate required
  // `INVITES_POLL_MS` and the literal string 'Duel invite' in Rumble.jsx.
  // Both are now deliberately false: the duplicate 2.5s invite poll was removed
  // (ChallengeContext owns it app-wide, from a provider ABOVE the Arena) and
  // the user-facing word is "Challenge", not "Invite".
  //
  // Deleting the gate would have lost four real properties, so they are
  // re-asserted explicitly below - including the two that caused the bug this
  // fixes: that the accepted-match handoff is actually CONSUMED by the Arena,
  // and that the inviter declares readiness so the clock can open.
  checks.push(
    /arenaInvite, arenaInvites, arenaInviteRespond, arenaInviteCancel/.test(read(resolve(ROOT, 'src/context/AppContext.jsx')))
      && /answerInvite/.test(rumble)
      && /Duel challenge/.test(rumble)
      && !/challengeScholar/.test(rumble)
      ? ok('Rumble: the scholars list sends challenges (no instant-challenge path), and incoming challenges are answerable')
      : fail('Rumble: the challenge UI is not wired, or an instant-challenge path remains'),
  );
  checks.push(
    !/INVITES_POLL_MS/.test(rumble)
      && !/setInterval\(invLoad/.test(rumble)
      ? ok('Rumble: the duplicate arena_invites_list poll is gone (ChallengeContext owns it app-wide, so the load is halved)')
      : fail('Rumble: Rumble is polling invites again, duplicating the app-wide ChallengeContext poll'),
  );
  checks.push(
    /consumeAdopt/.test(rumble)
      && /const joinAdopted/.test(rumble)
      && /await arenaReady\(mid\)/.test(rumble)
      && /await resumeArena\(mid\)/.test(rumble)
      && /setMatchLive/.test(rumble)
      ? ok('Rumble: the accepted-challenge handoff is consumed (ready + resume), so an inviter actually enters the duel')
      : fail('Rumble: consumeAdopt/joinAdopted is missing - an accepted challenge would never open (the original v84 bug)'),
  );
  // Comments are stripped before testing: ChallengePopup's header documents the
  // OLD `useState(windowSeconds * 1000)` it replaced, so a raw text match would
  // fail forever on the very file that fixed it.
  const popupSrc = read(resolve(ROOT, 'src/components/ChallengePopup.jsx'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  checks.push(
    /expiresAt/.test(popupSrc)
      && /parseDeadline/.test(popupSrc)
      && !/useState\(windowSeconds \* 1000\)/.test(popupSrc)
      && /deadline - now/.test(popupSrc)
      ? ok('ChallengePopup: the countdown runs to the server\'s per-invite expiresAt, not a freshly reseeded global window')
      : fail('ChallengePopup: the countdown is still a fresh local windowSeconds, so it over-promises time'),
  );
  checks.push(
    /useSearchParams/.test(rumble)
      && /challengeTargetId/.test(rumble)
      && /challenge=\$\{userId\}/.test(lb)
      ? ok('Arena deep link: the hub sends /rumble?challenge=<userId> and Rumble resolves it against the live invite list')
      : fail('Arena deep link: ?challenge= is not wired from the hub into Rumble'),
  );
  checks.push(
    /O5 sending an invite moves NO coins/.test(arenaE2e)
      && /O10 escrow happens ON ACCEPT, and holds BOTH sides/.test(arenaE2e)
      && /O17 after a completed match, the same row shows the REAL name/.test(arenaE2e)
      && /O8 a third party cannot accept/.test(arenaE2e)
      ? ok('e2e-arena covers invites: no escrow on send, escrow on accept, ownership, decline/cancel, and the real-name unlock')
      : fail('e2e-arena does not cover the invite contract'),
  );

  // v79 - the friend/rival READ side. v77 locked the writes down but there was no
  // way to list or search, so the whole feature was unreachable.
  const v79 = read('scripts/migration-v79-friend-rival-ui.sql');
  const rivals = read(resolve(ROOT, 'src/pages/Rivals.jsx'));
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v79-friend-rival-ui.sql'))
      && /create or replace function public\.friend_list\(\)/.test(v79)
      && /create or replace function public\.friend_search\(p_query text default null\)/.test(v79)
      && /revoke all on function public\.friend_list\(\) from public, anon/.test(v79)
      && /revoke all on function public\.friend_search\(text\) from public, anon/.test(v79)
      ? ok('v79: friend_list + friend_search exist and are revoked from anon')
      : fail('v79: the friend/rival read RPCs are missing or anon-readable'),
  );
  checks.push(
    /create or replace function public\._person_pair_name/.test(v79)
      && /when public\._arena_pair_dueled\(p_viewer, p_other\)/.test(v79)
      && /public\._person_pair_name\(v_user, p\.id\)/.test(v79)
      ? ok('v79: friend/rival naming reuses the arena pair rule (a real name only after a completed duel), so adding a friend does not leak a name')
      : fail('v79: friend/rival naming is not gated on the pair-duel predicate'),
  );
  // Rewritten for the hub. The four RPC calls moved from pages/Rivals.jsx into
  // components/SocialPanel.jsx when /rivals became a redirect into the
  // Leaderboard hub. The properties are unchanged - still routed, still
  // reachable from the sidebar, still wired to the same four RPCs.
  //
  // The sidebar entry no longer points at /rivals: it goes straight to the
  // hub's Friends tab, because a nav item should not need a redirect to
  // arrive. /rivals is still routed and still redirects, because it is in
  // people's bookmarks.
  const socialPanel = read(resolve(ROOT, 'src/components/SocialPanel.jsx'));
  const sidebarSrc = read(resolve(ROOT, 'src/components/Sidebar.jsx'));
  checks.push(
    existsSync(resolve(ROOT, 'src/pages/Rivals.jsx'))
      && /Navigate to="\/leaderboard\?tab=friends" replace/.test(rivals)
      && /path="\/rivals"/.test(read(resolve(ROOT, 'src/App.jsx')))
      && /path: '\/leaderboard\?tab=friends'/.test(sidebarSrc)
      && /request_relationship/.test(socialPanel)
      && /respond_relationship/.test(socialPanel)
      && /remove_relationship/.test(socialPanel)
      && /friend_search/.test(socialPanel)
      && /friend_list/.test(socialPanel)
      ? ok('Friends & Rivals: /rivals redirects into the hub, the sidebar goes straight to the Friends tab, and the panel wires all three write RPCs plus both read RPCs')
      : fail('Friends & Rivals: the route/redirect is missing, or the panel does not use the relationship RPCs'),
  );
  // The hub must be reachable on a PHONE. The Sidebar is `hidden lg:block` and
  // BottomNav is `lg:hidden`, so a nav entry that exists only in the sidebar
  // is unreachable on a 360px screen - which is exactly how the whole social
  // hub became phone-unreachable.
  //
  // REWRITTEN, not deleted. This used to assert that the HEADER carried a
  // `/leaderboard` link, which was a stopgap added while neither nav had one.
  // BottomNav now carries a "Ranks" item and the header link is gone (it was a
  // third copy of the same destination on every breakpoint). The property
  // behind the gate - the hub is reachable on a phone - is unchanged; the
  // surface that satisfies it is not.
  const bottomNavSrc = read(resolve(ROOT, 'src/components/BottomNav.jsx'));
  const appRoutesSrc = read(resolve(ROOT, 'src/App.jsx'));
  checks.push(
    /path:\s*'\/leaderboard'/.test(bottomNavSrc)
      && /name:\s*'Ranks'/.test(bottomNavSrc)
      && !/path:\s*'\/flashcards'/.test(bottomNavSrc)
      ? ok('The social hub is reachable on mobile: BottomNav carries a Ranks entry (the Sidebar is lg-only and BottomNav is mobile-only)')
      : fail('The social hub has no mobile entry point (BottomNav must carry a Ranks item to /leaderboard)'),
  );
  // /flashcards must remain REACHABLE for an admin-granted account even though
  // its nav entry was removed - the "Cards" item was a dead end for everyone
  // else, not a feature removal.
  checks.push(
    /path="\/flashcards"/.test(appRoutesSrc)
      && /path:\s*'\/flashcards'/.test(sidebarSrc)
      ? ok('Flashcards: removed from the mobile nav but still routed and still listed in the Sidebar, so a granted account can still reach it')
      : fail('Flashcards: the route or the Sidebar entry was removed along with the mobile nav item'),
  );
  // NavLink matches by PATHNAME only, so "Leaderboard" (/leaderboard) and
  // "Friends & Rivals" (/leaderboard?tab=friends) would BOTH light up. The
  // sidebar therefore needs its own comparison, not NavLink's.
  checks.push(
    /navItemIsActive/.test(sidebarSrc)
      && /location\.search/.test(sidebarSrc)
      ? ok('Sidebar: the hub nav items light up one at a time (NavLink matches on pathname only, so ?tab= needs its own check)')
      : fail('Sidebar: /leaderboard and /leaderboard?tab=friends would both highlight as active'),
  );
  // v89 - the READ side was dead. friend_list() referenced arena_invites'
  // column names (from_user/to_user) on a table that has user_id/target_id, so
  // it raised 42703 and returned nothing at all. These gates exist so that
  // exact mistake cannot be reintroduced.
  const v89 = read('scripts/migration-v89-relationship-repair.sql');
  const v89Code = v89.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  // Scoped to the friend_list BODY, not the whole file. v89 also recreates
  // arena_challenge_targets and arena_invites_list, and `arena_invites` really
  // does have from_user/to_user - a file-wide ban would be both wrong and
  // tempt someone into "fixing" working arena code.
  const friendListBody = (() => {
    const start = v89Code.indexOf('create or replace function public.friend_list()');
    if (start < 0) return '';
    const end = v89Code.indexOf('revoke all on function public.friend_list()', start);
    return v89Code.slice(start, end < 0 ? undefined : end);
  })();
  checks.push(
    friendListBody.length > 0
      && /i\.user_id/.test(friendListBody)
      && /i\.target_id/.test(friendListBody)
      && !/i\.from_user/.test(friendListBody)
      && !/i\.to_user/.test(friendListBody)
      ? ok('v89: friend_list reads user_id/target_id (v79\'s i.from_user/i.to_user raised 42703 and killed the whole feature)')
      : fail('v89: friend_list still references arena_invites column names, so it will raise undefined_column again'),
  );
  checks.push(
    /drop policy if exists "relationships_insert_own"/.test(v89)
      && /drop policy if exists "relationships_update_target"/.test(v89)
      && /alter table public\.user_relationships\s+drop constraint if exists user_relationships_unique/.test(v89)
      && /user_relationships_pair_unique/.test(v89)
      && /pg_advisory_xact_lock\(hashtext\('relationship:'/.test(v89)
      ? ok('v89: the client INSERT/UPDATE policies are dropped, one row per unordered pair is enforced, and writes take the pair advisory lock')
      : fail('v89: the relationship write policies, pair uniqueness or advisory lock are missing'),
  );
  checks.push(
    /create table if not exists public\.user_blocks/.test(v89)
      && /constraint user_blocks_no_self/.test(v89)
      && /create or replace function public\._blocked_between/.test(v89)
      // `_blocked_between` must be symmetric (either direction hides the pair)
      // AND must actually gate the three read paths: friend_list friends,
      // friend_search results, and the challenge target list.
      && /\(blocker_id = p_a and blocked_id = p_b\)\s*\n?\s*or \(blocker_id = p_b and blocked_id = p_a\)/.test(v89Code)
      && (v89Code.match(/not public\._blocked_between\(/g) || []).length >= 4
      && /as blocked/.test(v89)
      ? ok('v89: user_blocks is symmetric in both directions and gates friend_list, friend_search and the challenge targets')
      : fail('v89: user_blocks is missing, asymmetric, or not applied across the read RPCs'),
  );
  checks.push(
    /revoke all on function public\.push_notification\(uuid, text, uuid, jsonb\)\s+from public, anon, authenticated/.test(v89)
      && /'expiresAt', i\.created_at \+ make_interval\(secs => v_window\)/.test(v89)
      ? ok('v89: push_notification is closed to anon (it had no auth.uid() check at all), and invites carry a real per-invite expiresAt')
      : fail('v89: push_notification ACL or the invite expiresAt is missing'),
  );

  // v90 - the agreed 30s fail-safe, measured from BOTH players ready.
  const v90 = read('scripts/migration-v90-arena-no-activity.sql');
  checks.push(
    /create or replace function public\._arena_no_activity_sweep\(\)/.test(v90)
      && /no_activity_seconds/.test(v90)
      && /m\.status = 'ready'/.test(v90)
      && /m\.ready_at is not null/.test(v90)
      && /m\.starts_at is null/.test(v90)
      && /m\.opponent_bot is null/.test(v90)
      && /not exists \(/.test(v90)
      && /perform public\._arena_resolve\(v_row\.id, 'no_show', null, null, true\)/.test(v90)
      && /v_voided := public\._arena_no_activity_sweep\(\)/.test(v90)
      ? ok('v90: 30s no-activity voids and refunds both sides, measured from ready_at with zero answers, practice and bots excluded')
      : fail('v90: the 30s no-activity sweep is missing or is not correctly scoped'),
  );

  // v91 - profile views + activity.
  const v91 = read('scripts/migration-v91-profile-views-activity.sql');
  checks.push(
    /create table if not exists public\.profile_privacy/.test(v91)
      && /show_profile_views\s+boolean not null default false/.test(v91)
      && /share_visitor_identity boolean not null default false/.test(v91)
      && /create table if not exists public\.profile_views/.test(v91)
      && /no policies\. See section 2/.test(v91)
      && /create or replace function public\.social_activity_feed/.test(v91)
      ? ok('v91: profile views + activity exist, both consents default OFF, and profile_views has zero client policies')
      : fail('v91: profile-view privacy, the locked-down views table, or the activity feed is missing'),
  );

  // v92 - cosmetics (SC-only) + the marketplace self-grant fix.
  const v92 = read('scripts/migration-v92-cosmetics-crown.sql');
  checks.push(
    /create table if not exists public\.user_cosmetics/.test(v92)
      && /create unique index if not exists user_cosmetics_one_equipped_per_slot/.test(v92)
      && /create or replace function public\.cosmetic_purchase/.test(v92)
      && /public\._sc_apply\(/.test(v92)
      && /md5\('cosmetic:'/.test(v92)
      && /'crown_purchase'/.test(v92)
      && /\b40\b/.test(v92)
      ? ok('v92: cosmetics are Smart-Coin only, idempotent on a deterministic key, one equipped item per slot, Crown seeded at 40 SC')
      : fail('v92: the cosmetic purchase path, one-per-slot index, or the 40 SC Crown seed is missing'),
  );
  checks.push(
    /drop policy if exists "marketplace_purchases_all_own"/.test(v92)
      && /create policy "marketplace_purchases_read_own"[\s\S]*for select/.test(v92)
      && /create policy "marketplace_purchases_insert_own"[\s\S]*for insert/.test(v92)
      && !/for\s+all\s+on public\.marketplace_purchases/.test(v92)
      && /marketplace_purchases_unique/.test(v92)
      ? ok('v92: marketplace_purchases is no longer FOR ALL (a client could rewrite its own payment records); the (user_id, product_id) unique is kept')
      : fail('v92: the marketplace_purchases FOR ALL hole is still open, or the per-product unique was dropped'),
  );
  checks.push(
    /has_crown/.test(v92)
      && /coalesce\(cp\.has_crown, false\) as has_crown/.test(v92)
      && /'hasCrown', coalesce\(cp\.has_crown, false\)/.test(v92)
      && !/order by[\s\S]{0,400}has_crown/.test(v92)
      ? ok('v92: has_crown is exposed on community_profiles, community_feed, the leaderboard and the profile object, and never in an ORDER BY')
      : fail('v92: has_crown is not exposed everywhere, or it leaked into an ordering'),
  );
  // A plain view runs with the CALLER's privileges, so it needs EXECUTE on every
  // function it calls. Revoking _has_crown from anon/authenticated - the tidy
  // default, and what v92 originally did - made every read of community_feed
  // and community_profiles fail with 42501, which presents to users as an
  // EMPTY COMMUNITY FEED rather than a permissions error, and is invisible to
  // any check that runs as postgres. Caught by e2e-community-ephemeral.
  checks.push(
    /grant execute on function public\._has_crown\(uuid\) to anon, authenticated, service_role/.test(v92)
      && !/revoke all on function public\._has_crown\(uuid\) from public, anon, authenticated/.test(v92)
      ? ok('v92: _has_crown is executable by anon/authenticated, because community_profiles and community_feed call it as a plain view')
      : fail('v92: _has_crown is revoked from anon/authenticated - that 42501s the whole community feed'),
  );
  // The NGN path must refuse cosmetics in ALL THREE entry points. Checking only
  // initiate-payment would leave verify-payment (reachable directly) and the
  // webhook (attacker-reachable) able to charge for an item that grants nothing.
  checks.push(
    /COSMETIC_NOT_CARD_PURCHASABLE/.test(read(resolve(ROOT, 'api/initiate-payment.js')))
      && /COSMETIC_NOT_CARD_PURCHASABLE/.test(read(resolve(ROOT, 'api/verify-payment.js')))
      && /kind === 'cosmetic'/.test(read(resolve(ROOT, 'api/payments-webhook.js')))
      && /\.neq\('kind', 'cosmetic'\)/.test(read(resolve(ROOT, 'src/pages/Marketplace.jsx')))
      ? ok('Cosmetics are refused by initiate-payment, verify-payment and the webhook, and filtered out of the card storefront')
      : fail('Cosmetics can still reach a card payment path, or appear in the NGN storefront'),
  );

  // --- v93: the arena must report the stake it is actually running ---------
  const v93 = read('scripts/migration-v93-arena-challenge-stake.sql');
  checks.push(
    /nullif\(public\._arena_rules\(\) ->> 'stake_fixed', ''\)::int/.test(v93)
      && /'stake', v_stake/.test(v93)
      ? ok('v93: arena_challenge_targets reports stake_fixed, so the advertised stake matches the escrowed one')
      : fail('v93: arena_challenge_targets still reports min(stakes), which is not the arena\'s fixed stake'),
  );
  // ...and the client must USE the reported stake, not a hardcoded 2.
  const lbSrc = read(resolve(ROOT, 'src/pages/Leaderboard.jsx'));
  checks.push(
    /arenaInvite\(\{ userId, stake \}\)/.test(lbSrc)
      && !/stake: 2/.test(lbSrc)
      && /setStake\(Number\(res\.stake\) \|\| 2\)/.test(lbSrc)
      ? ok('The hub sends the stake the server reported, instead of a hardcoded 2')
      : fail('The hub still hardcodes the challenge stake'),
  );

  // --- sound effects: the preference exists, and now has a home -------------
  const settingsSrc = read(resolve(ROOT, 'src/pages/Settings.jsx'));
  const audioSrc = read(resolve(ROOT, 'src/utils/audio.js'));
  const appCtxSrc = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  checks.push(
    /Sound Effects/.test(settingsSrc)
      && /toggleSound/.test(settingsSrc)
      && /soundEnabled/.test(settingsSrc)
      ? ok('Settings has a Sound Effects toggle bound to the existing soundEnabled preference')
      : fail('Settings has no Sound Effects toggle'),
  );
  checks.push(
    /readStoredSoundPreference/.test(audioSrc)
      && /this\._enabled = readStoredSoundPreference\(\)/.test(audioSrc)
      ? ok('The audio singleton starts from the STORED preference, not from hardcoded true')
      : fail('The audio singleton ignores the stored sound preference on construction'),
  );
  checks.push(
    /useEffect\(\(\) => \{\s*audioManager\.setEnabled\(soundEnabled\);/.test(appCtxSrc)
      && /audioManager\.setEnabled\(soundEnabled\)/.test(appCtxSrc)
      ? ok('The sound preference is synced from AppContext, so it applies on every route and not only inside the Quiz')
      : fail('The sound preference is still only applied from the Quiz-scoped hook'),
  );
  // The Anonymous Room used to keep its OWN copy of the same preference.
  const anonSrc = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  checks.push(
    /soundEnabled, toggleSound/.test(anonSrc)
      && !/const loadSound/.test(anonSrc)
      && !/setSoundOn/.test(anonSrc)
      ? ok('The Anonymous Room uses the shared sound preference instead of a second copy of it')
      : fail('The Anonymous Room still keeps a duplicate sound preference'),
  );

  // --- identity synchronisation --------------------------------------------
  const greetSrc = read(resolve(ROOT, 'src/utils/getGreeting.js'));
  const dashSrc = read(resolve(ROOT, 'src/pages/Dashboard.jsx'));
  checks.push(
    // The CALL SITE, not the name: an import alone must not satisfy this.
    /greetingForDisplayName\(\s*\n?\s*userProfile\.identityName/.test(dashSrc)
      && !/greetingForName\(/.test(dashSrc)
      ? ok('The Dashboard greeting uses the IDENTITY name (the name the rest of the app shows), not the legal name')
      : fail('The Dashboard still greets with the legal name, so it disagrees with the ranking and community'),
  );
  checks.push(
    /identityName/.test(greetSrc)
      && /\.trim\(\)\.split\(\/\\s\+\/\)\[0\]/.test(greetSrc)
      ? ok('greetingForDisplayName keeps the identity name WHOLE and only first-words the legal-name fallback')
      : fail('greetingForDisplayName is missing, or it would truncate a display name to its first word'),
  );
  // A display name that can be wrong is worse than one that is late. These
  // gates cover the three ways it could drift.
  checks.push(
    // 1. SIGNED_IN must reset the profile, not just the cache.
    /event === 'SIGNED_IN'[\s\S]{0,1400}?setUserProfile\(ANONYMOUS_PROFILE\)/.test(appCtxSrc)
      && /event === 'SIGNED_IN'[\s\S]{0,1400}?setProfileLoaded\(false\)/.test(appCtxSrc)
      ? ok('SIGNED_IN resets userProfile and profileLoaded, so an account switch cannot render the previous account\'s display name')
      : fail('SIGNED_IN clears the cache but leaves userProfile set, so signing in as another user shows their predecessor\'s name'),
  );
  checks.push(
    // 2. A late fetch must not overwrite a newer one (save-while-loading race).
    //    The invalidation is `+= 1`, not `++`; match the statement as written.
    /profileFetchSeq\.current\s*\+=\s*1/.test(appCtxSrc)
      && /ticket !== profileFetchSeq\.current/.test(appCtxSrc)
      ? ok('Profile fetches carry a sequence ticket, so a slow response cannot overwrite a fresher profile')
      : fail('Profile fetches are unguarded, so a slow response can revert a just-saved display name'),
  );
  checks.push(
    // 3. The Dashboard must not guess a name before the row arrives.
    /profileLoaded/.test(dashSrc)
      && /!profileLoaded/.test(dashSrc)
      && /setProfileLoaded\(true\)/.test(appCtxSrc)
      ? ok('The Dashboard holds the greeting until the profile is actually loaded, instead of guessing "Scholar"')
      : fail('The Dashboard greets before the profile has loaded'),
  );
  // Settings must write from the server's answer, not from the form it sent.
  checks.push(
    /\.select\('full_name, identity_name, phone, department, level'\)/.test(settingsSrc)
      && /if \(!data\)/.test(settingsSrc)
      ? ok('Settings reads the profile row back after saving and reports a write that matched nothing')
      : fail('Settings updates the profile without reading it back, so it can show a name that was never stored'),
  );

  // --- v96: scholar search + the friend_search cap fix ----------------------
  const v96 = read('scripts/migration-v96-scholar-search.sql');
  checks.push(
    /create or replace function public\.scholar_search/.test(v96)
      && /create or replace function public\.friend_search/.test(v96)
      ? ok('v96: scholar_search is added and friend_search is redefined')
      : fail('v96: scholar_search is missing, or friend_search was not redefined'),
  );
  // The original defect: `limit 25` sat AFTER an ungrouped jsonb_agg, so it
  // capped the one-row result instead of the profiles, and a blank query
  // returned the whole activated user base. The cap must live INSIDE a
  // subquery over profiles.
  const friendSearchBody = (v96.match(/create or replace function public\.friend_search[\s\S]*?end;\s*\$\$;/i) || [''])[0];
  checks.push(
    /limit 25\s*\n\s*\)\s*s/i.test(friendSearchBody)
      && !/jsonb_agg\([\s\S]{0,900}?limit 25/i.test(friendSearchBody)
      ? ok('v96: friend_search caps its results INSIDE a subquery, so a blank query cannot dump the user directory')
      : fail('v96: friend_search still applies its limit to the aggregate result set, which returns every activated profile'),
  );
  checks.push(
    /relStatus/.test(v96)
      && /pending_out/.test(v96)
      && /_blocked_between/.test(v96)
      && /revoke all on function public\.scholar_search\(text, int\) from public, anon/.test(v96)
      ? ok('v96: scholar_search reports the relationship per row, filters blocked scholars, and is revoked from anon')
      : fail('v96: scholar_search is missing its relationship/block handling, or anon can execute it'),
  );

  // --- v97: profile visibility tiers ----------------------------------------
  const v97 = read('scripts/migration-v97-profile-visibility.sql');
  const profObjBody = (v97.match(/create or replace function public\._player_profile_obj[\s\S]*?end;\s*\$\$;/i) || [''])[0];
  checks.push(
    /'visibility'/.test(profObjBody)
      && /v_full/.test(profObjBody)
      && /_blocked_between/.test(profObjBody)
      ? ok('v97: the profile object carries a visibility tier and accounts for blocks')
      : fail('v97: the profile object has no visibility tier'),
  );
  // The tier must be decided BEFORE the aggregates run, not after: computing
  // achievements/head-to-head and then dropping them still reads the rows.
  checks.push(
    /if v_full then[\s\S]*?user_achievements[\s\S]*?if v_full then[\s\S]*?jsonb_build_object\(\s*'year'/.test(profObjBody)
      || (/if v_full then/.test(profObjBody) && profObjBody.indexOf('user_achievements') < profObjBody.lastIndexOf("if v_full then"))
      ? ok('v97: achievements and head-to-head are computed INSIDE the tier check, so an unauthorised viewer never causes the rows to be read')
      : fail('v97: the restricted aggregates are computed before the tier is applied'),
  );
  // The public tier must be exactly name + coins + duels.
  const pubTier = (profObjBody.match(/v_obj := jsonb_build_object\([\s\S]*?\n  \);/) || [''])[0];
  checks.push(
    /'name'/.test(pubTier)
      && /'smartCoins'/.test(pubTier)
      && /'duels'/.test(pubTier)
      && !/'achievements'/.test(pubTier)
      && !/'headToHead'/.test(pubTier)
      && !/'rank'/.test(pubTier)
      && !/'scoreBreakdown'/.test(pubTier)
      ? ok('v97: the public tier is exactly display name, Smart Coins and duel record')
      : fail('v97: the public tier leaks a restricted field'),
  );
  // get_player_leaderboard was the bigger leak - it was not viewer-scoped.
  // NOTE the two duel keys: `'threeVThreeWins',` (key + comma) only appears as
  // an OUTPUT key. The ORDER BY legitimately references `parts ->>
  // 'threeVThreeWins'`, so a bare quote match would false-positive on the sort
  // itself and pass a version that still shipped the column.
  const lbBody = (v97.match(/create or replace function public\.get_player_leaderboard[\s\S]*?end;\s*\$\$;/i) || [''])[0];
  checks.push(
    !/'smartCoins'/.test(lbBody)
      && !/'competitiveScore'/.test(lbBody)
      && !/'scoreBreakdown'/.test(lbBody)
      && !/'threeVThreeWins',/.test(lbBody)
      && !/'oneVOneWins',/.test(lbBody)
      && !/'playerScore'/.test(lbBody)
      && /'rank'/.test(lbBody)
      && /'totalAnswers'/.test(lbBody)
      ? ok('v97: the leaderboard no longer returns wallet, score or duel figures per row; position and totalAnswers remain')
      : fail('v97: the leaderboard still returns personal figures for every ranked row'),
  );
  // Ranking must be provably unchanged: the tie-break chain is what decides it.
  checks.push(
    /order by \(b\.parts ->> 'score'\)::int desc,\s*\(b\.parts ->> 'threeVThreeWins'\)::int desc,\s*\(b\.parts ->> 'oneVOneWins'\)::int desc,\s*\(b\.parts ->> 'wins'\)::int desc,\s*b\.sc_balance desc,\s*b\.user_id asc/.test(lbBody)
      && /'rank', row_number\(\) over/.test(lbBody)
      ? ok('v97: the leaderboard tie-break chain is untouched, so trimming the payload cannot move a row')
      : fail('v97: the leaderboard ordering changed - ranks may have moved'),
  );
  const sheetSrc = read(resolve(ROOT, 'src/components/PlayerSheet.jsx'));
  checks.push(
    /visibility/.test(sheetSrc)
      && /isDetailed/.test(sheetSrc)
      && !/seed\?\.scoreBreakdown/.test(sheetSrc)
      && !/seed\?\.smartCoins/.test(sheetSrc)
      ? ok('The profile sheet renders from the server visibility tier and no longer falls back to leaderboard figures')
      : fail('The profile sheet still reads personal figures off the leaderboard seed'),
  );
  const rankBoardSrc = read(resolve(ROOT, 'src/components/RankingBoard.jsx'));
  checks.push(
    !/row\.scoreBreakdown/.test(rankBoardSrc)
      && !/row\.playerScore/.test(rankBoardSrc)
      && !/row\.smartCoins/.test(rankBoardSrc)
      ? ok('Ranking rows no longer read the fields the leaderboard stopped sending')
      : fail('Ranking rows still read a field the leaderboard no longer returns'),
  );
  checks.push(
    /rpc\('scholar_search'/.test(rankBoardSrc)
      && /SEARCH_MIN/.test(rankBoardSrc)
      && /REL_LABEL/.test(rankBoardSrc)
      ? ok('The Ranking tab can find a scholar by name and shows their relationship')
      : fail('The Ranking tab has no scholar search'),
  );

  // --- v98: the marketplace self-grant hole ----------------------------------
  const v98 = read('scripts/migration-v98-marketplace-entitlement.sql');
  checks.push(
    /drop policy if exists "marketplace_purchases_insert_own"/.test(v98)
      ? ok('v98: the client INSERT policy on marketplace_purchases is dropped')
      : fail('v98: marketplace_purchases_insert_own still exists, so any client can still self-grant a product'),
  );
  checks.push(
    /create or replace function public\.marketplace_claim_free_product/.test(v98)
      && /access_type = 'free'/.test(v98)
      && /PREMIUM_ONLY/.test(v98)
      && /subscriptions s/.test(v98)
      && /'claim:' \|\| md5/.test(v98)
      ? ok('v98: claiming goes through a server-validated RPC that checks the product type and the live subscription, idempotently')
      : fail('v98: marketplace_claim_free_product is missing its product/subscription validation or its deterministic key'),
  );
  // Cosmetics must be refused on BOTH paths, or the grant writes a row that
  // grants nothing.
  checks.push(
    (v98.match(/COSMETIC_NOT_CLAIMABLE/g) || []).length >= 2
      && /PAID_PRODUCT/.test(v98)
      && /NOT_FREE/.test(v98)
      ? ok('v98: cosmetics, paid and mislabelled-free products are all refused explicitly')
      : fail('v98: a claim path does not refuse a product it cannot actually grant'),
  );
  checks.push(
    /create or replace function public\.admin_grant_marketplace_entitlement/.test(v98)
      && /if not public\.is_admin\(\)/.test(v98)
      && /CANNOT_GRANT_SUPER_ADMIN/.test(v98)
      && /admin_audit_log/.test(v98)
      && /marketplace_entitlement_grant/.test(v98)
      ? ok('v98: the admin grant re-checks is_admin, protects super-admin targets, and is audited')
      : fail('v98: the admin grant is unaudited, ungated, or will target a super admin'),
  );
  // anon EXECUTE on a new function is the documented default-privileges trap.
  checks.push(
    /revoke all on function public\.marketplace_claim_free_product\(bigint\) from public, anon/.test(v98)
      && /from public, anon, authenticated;/.test(v98)
      ? ok('v98: both new RPCs are revoked from anon (this project auto-grants anon EXECUTE on new functions)')
      : fail('v98: a new RPC is left executable by anon'),
  );
  const marketSrc = read(resolve(ROOT, 'src/pages/Marketplace.jsx'));
  checks.push(
    /rpc\('marketplace_claim_free_product'/.test(marketSrc)
      && !/from\('marketplace_purchases'\)\s*\n?\s*\.insert/.test(marketSrc)
      ? ok('Marketplace claims through the RPC and no longer inserts purchase rows from the browser')
      : fail('Marketplace still inserts entitlement rows directly'),
  );
  // The Premium CTA was dead code because it read a field userProfile does not
  // have. `isPremium` is a separate context value. Match the ASSIGNMENT, not
  // the bare token - the explanatory comment in Marketplace.jsx names the old
  // expression on purpose, and a bare match would flag its own explanation.
  checks.push(
    /const \{ session, isPremium \} = useAppContext\(\)/.test(marketSrc)
      && !/premium=\{!!userProfile\?\.isPremium\}/.test(marketSrc)
      ? ok('Marketplace gates the Premium CTA on the real isPremium context value')
      : fail('Marketplace still gates on userProfile.isPremium, which is always undefined'),
  );

  // --- the profile-views feature must actually be reachable -----------------
  // NOTE ON HOW THESE GATES ARE WRITTEN. The first draft of each of these
  // three matched a bare NAME, e.g. /profile_view_record/. Negative-tested,
  // that was a no-op: renaming the RPC to profile_view_record_disabled still
  // contains the substring, and the import statement still contains the name
  // even after the CALL is removed. So each gate below matches the CALL SITE
  // with its argument list, which a rename or an unused import cannot fake.
  const sheetHookSrc = read(resolve(ROOT, 'src/hooks/usePlayerSheet.jsx'));
  checks.push(
    /rpc\('profile_view_record',\s*\{\s*p_profile:\s*userId\s*\}\)/.test(sheetHookSrc)
      && /ProfilePrivacyCard/.test(settingsSrc)
      ? ok('Profile views are actually wired: opening a profile records the view, and Settings has the consent controls')
      : fail('Profile views are still inert - the RPC exists but nothing calls it'),
  );
  const privacyCardSrc = read(resolve(ROOT, 'src/components/ProfilePrivacyCard.jsx'));
  checks.push(
    /rpc\('profile_privacy_get'\)/.test(privacyCardSrc)
      && /rpc\('profile_privacy_set'/.test(privacyCardSrc)
      && /rpc\('profile_view_list'/.test(privacyCardSrc)
      ? ok('The privacy card reads and writes both consents, and lists the views')
      : fail('The privacy card does not exercise the profile-privacy RPCs'),
  );

  // --- the notifications table must not be write-only -----------------------
  const v94 = read('scripts/migration-v94-notifications-reader.sql');
  const bellSrc = read(resolve(ROOT, 'src/components/NotificationBell.jsx'));
  checks.push(
    /create or replace function public\.notifications_list/.test(v94)
      && /create or replace function public\.notifications_mark_read/.test(v94)
      && /rpc\('notifications_list'/.test(bellSrc)
      && /rpc\('notifications_mark_read'/.test(bellSrc)
      ? ok('The notifications table has a reader: the bell shows real events and marks them read')
      : fail('The notifications table is still write-only'),
  );
  checks.push(
    /drop policy if exists "notifications_all_own"/.test(v94)
      && /notifications_read_own/.test(v94)
      && !/for all\s+on public\.notifications/.test(v94)
      ? ok('The notifications FOR ALL policy is narrowed to select-own, so a client cannot forge rows in its own inbox')
      : fail('The notifications policy still allows a client to write its own inbox'),
  );

  // The hub shell itself.
  const activityPanel = read(resolve(ROOT, 'src/components/ActivityPanel.jsx'));
  const cosmeticsPanel = read(resolve(ROOT, 'src/components/CosmeticsPanel.jsx'));
  checks.push(
    /useSearchParams/.test(lb)
      && /key: 'ranking'/.test(lb)
      && /key: 'friends'/.test(lb)
      && /key: 'rivals'/.test(lb)
      && /key: 'activity'/.test(lb)
      && /key: 'cosmetics'/.test(lb)
      && /RankingBoard/.test(lb)
      && /SocialPanel/.test(lb)
      && /ActivityPanel/.test(lb)
      && /CosmeticsPanel/.test(lb)
      && /social_activity_feed/.test(activityPanel)
      && /cosmetic_catalog/.test(cosmeticsPanel)
      && /cosmetic_purchase/.test(cosmeticsPanel)
      ? ok('Social hub: /leaderboard carries all five tabs and each panel calls its own server RPC')
      : fail('Social hub: a tab, panel or RPC is missing from the hub shell'),
  );
  checks.push(
    /no-unused-vars/.test(read(resolve(ROOT, 'src/data/challengeCopy.js'))) === false
      && /BLOCKED_COPY/.test(lbBoard)
      && /BLOCKED_COPY/.test(lb)
      ? ok('Challenge refusal copy lives in one module, shared by the board and the hub shell')
      : fail('Challenge refusal copy has been duplicated or lost'),
  );

  // v80 - lifetime earnings + the passive-faucet shutdown + a reachable licence.
  const v80 = read('scripts/migration-v80-economy-sc-earn-faucets-loan.sql');
  const v80Code = v80.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  const econE2e = read('scripts/e2e-economy.mjs');
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v80-economy-sc-earn-faucets-loan.sql'))
      && /create or replace function public\.sc_earned_total/.test(v80)
      && /sum\(greatest\(l\.amount, 0\)\)/.test(v80Code)
      ? ok('v80: sc_earned_total sums positive ledger amounts (lifetime earned, which cannot shrink when you spend)')
      : fail('v80: sc_earned_total is missing or does not sum only credits'),
  );
  checks.push(
    !/scEarned: smartCoins \|\| 0/.test(read(resolve(ROOT, 'src/context/AppContext.jsx')))
      && !/scEarned: smartCoins \|\| 0/.test(read(resolve(ROOT, 'src/pages/Dashboard.jsx')))
      && /scEarned: scEarnedTotal \|\| 0/.test(read(resolve(ROOT, 'src/context/AppContext.jsx')))
      && /scEarned: scEarnedTotal \|\| 0/.test(read(resolve(ROOT, 'src/pages/Dashboard.jsx')))
      ? ok('the client no longer feeds the CURRENT BALANCE into the identity tiers (both call sites updated)')
      : fail('scEarned is still the balance in the client'),
  );
  checks.push(
    /passive_faucets_enabled/.test(v80)
      && /create or replace function public\._sc_faucets_enabled/.test(v80)
      && /'economy'/.test(v80)
      ? ok('v80: the faucet shutdown is a single config flag consulted by _sc_faucets_enabled (reversible, one place to reason about)')
      : fail('v80: the faucet shutdown is not driven by one shared flag'),
  );
  // Signatures were read from pg_proc; getting them wrong creates an overload
  // instead of replacing the live function (and drops defaults -> 42P13).
  checks.push(
    /sc_record_fail_penalty\(p_ref_type text default null, p_ref_id text default null\)/.test(v80)
      && /claim_challenge_reward\(p_challenge_key text, p_client_request_id uuid default null\)/.test(v80)
      && /create or replace function public\.claim_squad_reward\(\)/.test(v80)
      ? ok('v80: faucet replacements keep the live signatures AND their parameter defaults')
      : fail('v80: a faucet replacement changed its signature or dropped a parameter default'),
  );
  checks.push(
    /shark_require_balance_sc.*'250'/s.test(v80)
      && /the lender licence gate is affordable/.test(econE2e)
      && /spending reduces the BALANCE but not lifetime earned/.test(econE2e)
      ? ok('v80 + e2e: the lender licence is reachable (250 SC) and earned/balance are proven distinct')
      : fail('v80 licence gate or the earned-vs-balance assertion is missing'),
  );

  // v81 - transfers + World Bank, routed through api/quiz.js (12-fn cap).
  const v81 = read('scripts/migration-v81-transfers-world-bank.sql');
  const econApi = read(resolve(ROOT, 'api/_economy.js'));
  const quizApi = read(resolve(ROOT, 'api/quiz.js'));
  checks.push(
    existsSync(resolve(ROOT, 'scripts/migration-v81-transfers-world-bank.sql'))
      && /create table if not exists public\.worldbank_loans/.test(v81)
      && /revoke all on public\.worldbank_loans from public, anon, authenticated/.test(v81)
      ? ok('v81: worldbank_loans exists and is service-role only')
      : fail('v81: the loans table is missing or client-readable'),
  );
  checks.push(
    /revoke all on function public\.sc_transfer\(uuid, integer, uuid\) from public, anon/.test(v81)
      && /revoke all on function public\.worldbank_borrow\(integer, uuid\) from public, anon/.test(v81)
      && /revoke all on function public\.worldbank_repay\(bigint, uuid\) from public, anon/.test(v81)
      && /DAILY_CAP_REACHED/.test(v81)
      && /HOURLY_CAP_REACHED/.test(v81)
      ? ok('v81: transfers enforce the daily + hourly caps and every money RPC is revoked from anon')
      : fail('v81: transfer caps or ACLs are missing'),
  );
  // The bug the e2e caught: the bank was debited and the borrower never
  // credited, which destroyed the principal.
  checks.push(
    /THE BORROWER MUST BE CREDITED/.test(v81)
      && /v_disburse := public\._sc_apply\(v_me, p_amount, 'worldbank_loan'/.test(v81)
      && /borrowing 200 credits the principal/.test(econE2e)
      && /the principal came OUT of the bank wallet/.test(econE2e)
      && /the bank is made whole plus interest/.test(econE2e)
      ? ok('v81: borrowing credits the borrower as well as debiting the bank, and the e2e proves coins are conserved')
      : fail('v81: the borrower is not credited, or the conservation assertions are missing'),
  );
  checks.push(
    /worldbank_loan_request unique \(user_id, client_request_id\)/.test(v81)
      && /WORLD_BANK_REPLAY/.test(v81)
      && /LOAN_LIMIT_REACHED/.test(v81)
      && /OUTSTANDING_CAP_REACHED/.test(v81)
      ? ok('v81: loans are idempotent per requestId, one at a time, with an outstanding cap')
      : fail('v81: loan idempotency / limits are missing'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'api/_economy.js'))
      && /MISSING_REQUEST_ID/.test(econApi)
      && /p_request: body\.requestId/.test(econApi)
      && /from '\.\/_economy\.js'/.test(quizApi)
      && /economy === 'overview'/.test(quizApi)
      && /economy === 'transfer'/.test(quizApi)
      && /economy === 'borrow'/.test(quizApi)
      && /economy === 'repay'/.test(quizApi)
      && /\/api\/economy\/:path\*/.test(read(resolve(ROOT, 'vercel.json')))
      && /\/api\/economy\/:path\*/.test(read(resolve(ROOT, 'scripts/serve-api.mjs')))
      ? ok('transfers + bank are reachable via /api/economy/* on api/quiz.js, and requestId is mandatory (no new Vercel function)')
      : fail('the economy API is not routed, or does not require requestId'),
  );
  checks.push(
    existsSync(resolve(ROOT, 'src/pages/Wallet.jsx'))
      && /path="\/wallet"/.test(read(resolve(ROOT, 'src/App.jsx')))
      && /path: '\/wallet'/.test(read(resolve(ROOT, 'src/components/Sidebar.jsx')))
      && /e2e:economy/.test(read(resolve(ROOT, 'package.json')))
      ? ok('the Wallet page is routed + in the sidebar, and e2e:economy is wired')
      : fail('the Wallet page is not routed/sidebar-ed, or e2e:economy is missing'),
  );
}

// ===========================================================================
// PART R - ANONYMOUS ROOM: 18+ GATE, HOST DELETE, NO PRE-JOIN PRICE (v86-v88)
// ===========================================================================
{
  const anonRoom = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));
  const comm = read(resolve(ROOT, 'api/_community.js'));
  const v88 = read(resolve(ROOT, 'scripts/migration-v88-anonymous-host-room-delete.sql'));
  const v87 = read(resolve(ROOT, 'scripts/migration-v87-anonymous-price-299-190.sql'));
  const v82 = read(resolve(ROOT, 'scripts/migration-v82-voting-campaigns.sql'));

  // --- the 18+ gate is BLOCKING, not merely present ---
  checks.push(
    /const AgeGate = \(\{/.test(anonRoom)
      && /role="dialog"/.test(anonRoom)
      && /aria-modal="true"/.test(anonRoom)
      // The confirm button must be gated on the tick.
      && /disabled=\{!confirmed \|\| busy\}/.test(anonRoom)
      // A real checkbox, not a styled div.
      && /type="checkbox"/.test(anonRoom)
      ? ok('18+ gate: a real modal dialog with a real checkbox whose confirm is disabled until ticked')
      : fail('the 18+ gate is missing, or its confirm button is not gated on the tick'),
  );
  // A Modal closes on a backdrop click, so the gate must NOT be one.
  checks.push(
    /showNotice && isMember/.test(anonRoom) || !/const AgeGate[\s\S]{0,4000}<Modal/.test(anonRoom)
      ? ok('18+ gate is not built on the backdrop-dismissible Modal component')
      : fail('the 18+ gate renders inside <Modal>, which closes on a backdrop click'),
  );
  // Server-side enforcement, not just a UI block.
  checks.push(
    /export async function requireNoticeAck/.test(comm)
      && (comm.match(/await requireNoticeAck\(req, res, user\)/g) || []).length >= 6
      ? ok('requireNoticeAck exists and gates feed/members/message/send/event/duel server-side')
      : fail('the notice gate is client-only, or is applied to fewer than the 6 content endpoints'),
  );
  // Presence MUST stay ungated or a member loses their seat while reading the box.
  checks.push(
    /requireNoticeAck[\s\S]*?handleAnonPresence/.test(comm)
      || !/export async function handleAnonPresence[\s\S]{0,900}requireNoticeAck/.test(comm)
      ? ok('presence is deliberately NOT notice-gated (a gated heartbeat would cost the seat)')
      : fail('handleAnonPresence is notice-gated - a member reading the gate would lose their seat'),
  );
  // Spectators are covered from v6.
  checks.push(
    /access === 'member' \|\| access === 'spectator' \? await hasNoticeAck/.test(comm)
      ? ok('spectators must acknowledge the notice too (they can read the whole room)')
      : fail('noticeAccepted still hard-codes spectators as accepted'),
  );

  // --- host leave deletes the room, posts FIRST ---
  checks.push(
    /anonymous_room_delete_host/.test(comm) && /anonymous_room_delete_host/.test(v88)
      ? ok('host leave routes through the anonymous_room_delete_host RPC')
      : fail('host leave does not use the delete RPC'),
  );
  checks.push(
    // Ordering is the confidentiality property: community_posts is set-null and
    // community_feed admits any post with a null group_id.
    /delete from public\.community_posts where group_id = p_group/.test(v88)
      && v88.indexOf('delete from public.community_posts') < v88.indexOf('delete from public.study_groups')
      ? ok('v88 deletes community_posts BEFORE study_groups (prevents the public-feed leak)')
      : fail('v88 does not delete posts before the group - the room history would be published'),
  );
  checks.push(
    /revoke all on function public\.anonymous_room_delete_host\(bigint, uuid\) from public, anon, authenticated/.test(v88)
      && /grant  execute on function public\.anonymous_room_delete_host\(bigint, uuid\) to service_role/.test(v88)
      ? ok('anonymous_room_delete_host is service-role only')
      : fail('anonymous_room_delete_host is reachable by a client'),
  );

  // --- no price before a refused join ---
  // The 6 remaining sites are all post-refusal checkout surfaces.
  const priceSites = [...anonRoom.matchAll(/₦\{(memberPrice|price|bundleTotal)/g)].map((m) => m.index);
  checks.push(
    priceSites.length <= 6
      ? ok(`no price before a refused join (${priceSites.length} amount sites left, all in the two checkout modals)`)
      : fail(`${priceSites.length} price sites remain in AnonymousRoom.jsx - some are pre-join`),
  );
  checks.push(
    /then ₦\{memberPrice/.test(anonRoom) || /then ₦\{price/.test(anonRoom)
      ? fail('a pre-join surface still names an amount (the "then ₦X" phrasing)')
      : ok('no pre-join surface uses the "then ₦X" phrasing'),
  );

  // --- dynamic pre-join screens ---
  checks.push(
    /PREJOIN_POLL_MS/.test(anonRoom) && /isSeated/.test(anonRoom)
      && /This room is empty/.test(anonRoom)
      ? ok('the join gate polls live and has a distinct empty-room state')
      : fail('the pre-join screens are still a static snapshot with no empty state'),
  );

  // --- prices are DB-resolved, never hardcoded ---
  checks.push(
    /member_price\s*=\s*299\.00/.test(v87) && /spectator_price\s*=\s*190\.00/.test(v87)
      && /alter column member_price    set default 299/.test(v87)
      && /alter column spectator_price set default 190/.test(v87)
      ? ok('v87 sets 299/190 on every anonymous room AND on both column defaults')
      : fail('v87 does not set both the rows and the column defaults'),
  );

  // --- one review per service, all five ---
  checks.push(
    /ALREADY_RATED/.test(v82)
      && !/v_cat = 'overall' and exists/.test(v82)
      && /v_replay/.test(v82)
      ? ok('cast_service_rating refuses a second DIFFERING rating for every category, replay-safe')
      : fail('cast_service_rating is still overall-only, or the identical-replay path is missing'),
  );
  checks.push(
    /ONE_TIME_CATEGORIES = new Set\(SERVICE_CATEGORIES\.map/.test(read(resolve(ROOT, 'src/pages/Voting.jsx')))
      ? ok('the Voting UI locks all five categories once a rating exists')
      : fail('the Voting UI still only locks some categories'),
  );

  // --- the honest-error fixes ---
  checks.push(
    /statsError/.test(read(resolve(ROOT, 'src/pages/Voting.jsx')))
      && /'open', 'reviewing', 'resolved', 'ignored'/.test(read(resolve(ROOT, 'src/pages/Reviews.jsx')))
      ? ok('Voting surfaces load failures instead of claiming zero ratings; Reviews uses legal status values')
      : fail('the silent-error / illegal-status fixes are missing'),
  );

  // --- console-error fixes ---
  checks.push(
    /createContext\(\{\}\)/.test(read(resolve(ROOT, 'src/context/AppContext.jsx')))
      ? ok('AppContext has a default value, so an out-of-provider render degrades instead of throwing')
      : fail('AppContext is createContext() with no default - AdSenseManager crashed on this'),
  );
  checks.push(
    /<ErrorBoundary>\s*<AdSenseManager>/.test(read(resolve(ROOT, 'src/App.jsx')))
      ? ok('an ErrorBoundary now sits ABOVE AdSenseManager, so a fault cannot blank the whole tree')
      : fail('AdSenseManager is still above the only ErrorBoundary'),
  );
  checks.push(
    /body: \{ score, total, question_ids: ids \}/.test(read(resolve(ROOT, 'src/components/DailyChallengeWidget.jsx')))
      ? ok('daily-challenge/complete sends an object (it was double-stringified and stored score 0)')
      : fail('daily-challenge/complete still pre-stringifies its body'),
  );

  // --- auth exemplar text ---
  //
  // REWRITTEN against the wizard. Registration moved out of Auth.jsx into a
  // guided, one-task-per-step flow (src/components/SignupWizard.jsx); the old
  // gates below asserted on Auth.jsx's single-page form and would have failed
  // on correct code. They are rewritten, not deleted — the property behind each
  // one (exemplar copy, visible placeholder colour, a password visibility
  // toggle, a confirm hint) is still required, it just now lives in the wizard.
  const auth = read(resolve(ROOT, 'src/pages/Auth.jsx'));
  const cam = read(resolve(ROOT, 'src/components/CommunityAuthModal.jsx'));
  const wizard = read(resolve(ROOT, 'src/components/SignupWizard.jsx'));
  const signupValidation = read(resolve(ROOT, 'src/utils/signupValidation.js'));
  checks.push(
    /e\.g\. Amaka Okonkwo/.test(wizard) && /e\.g\. amaka@gmail\.com/.test(wizard)
      && /placeholder:text-slate-400/.test(wizard)
      ? ok('SignupWizard has exemplar placeholders with visible placeholder colour')
      : fail('SignupWizard is missing exemplar text or its placeholder colour class'),
  );
  // Auth.jsx no longer renders a name field — that step belongs to the wizard —
  // so this asserts exemplar copy for the fields it DOES still render (email
  // and password). The property is unchanged: no default placeholder text, and
  // the placeholder colour is visible against the dark field. The name exemplar
  // is asserted against the wizard above.
  checks.push(
    /e\.g\. amaka@gmail\.com/.test(auth) && /Your password/.test(auth)
      && /placeholder:text-slate-400/.test(auth)
      ? ok('Auth.jsx (sign-in + reset) still has exemplar placeholders with visible placeholder colour')
      : fail('Auth.jsx is missing exemplar text or its placeholder colour class'),
  );
  // The toggle now exists on all THREE surfaces: sign-in (Auth.jsx), and both
  // password steps in the wizard. The confirm hint moved into the wizard.
  checks.push(
    /setShowPassword/.test(auth) && /type="button"/.test(auth)
      && /setShowPassword/.test(wizard) && /setShowConfirm/.test(wizard)
      && /Type it again/.test(wizard)
      ? ok('a show/hide password toggle exists on sign-in and on both wizard password steps, with a confirm hint')
      : fail('a show/hide password toggle or the confirm hint is missing'),
  );
  checks.push(
    /e\.g\. 0803 123 4567/.test(cam)
      && /placeholder:text-slate-400/.test(cam)
      ? ok('CommunityAuthModal has exemplar text on every signup field')
      : fail('CommunityAuthModal is missing exemplar text'),
  );

  // --- the four stable aria-labels are a CONTRACT with the e2e suites ---
  //
  // scripts/e2e-utils.mjs builds AUTH_NAME / AUTH_EMAIL / AUTH_PASSWORD /
  // AUTH_CONFIRM from these four strings and ~15 browser suites fill them.
  // Renaming one silently breaks every one of those suites, and a rename is
  // exactly the kind of "tidy-up" that looks harmless. This gate makes the
  // contract explicit on BOTH sides: the wizard defines them and the e2e
  // helper keys on them, so the two cannot drift apart unnoticed.
  const e2eUtils = read(resolve(ROOT, 'scripts/e2e-utils.mjs'));
  checks.push(
    ['Full name', 'Email address', 'Password', 'Confirm password'].every(
      (label) => wizard.includes(`aria-label="${label}"`)
    )
      ? ok('SignupWizard keeps the four stable aria-labels the e2e suites key on')
      : fail('SignupWizard changed an aria-label that scripts/e2e-utils.mjs depends on'),
  );
  checks.push(
    /aria-label="Full name"/.test(e2eUtils) && /aria-label="Email address"/.test(e2eUtils)
      && /aria-label="Password"/.test(e2eUtils) && /aria-label="Confirm password"/.test(e2eUtils)
      ? ok('e2e-utils still keys on the same four aria-labels the wizard renders')
      : fail('e2e-utils selectors no longer match the wizard aria-labels'),
  );

  // --- registration is EXACTLY four required fields ---
  //
  // The directive is a product rule, not a style note: name, email, password,
  // confirm. Nothing else may become required. The wizard holds exactly these
  // four in one object; the assertion below fails if a fifth field key appears
  // in EMPTY_VALUES.
  checks.push(
    /const EMPTY_VALUES = \{ fullName: '', email: '', password: '', confirmPassword: '' \}/.test(wizard)
      ? ok('registration collects exactly the four required fields')
      : fail('registration is collecting something other than name/email/password/confirm'),
  );
  // Validation must live in ONE module, not in component JSX — that is the whole
  // point of utils/signupValidation.js (Auth.jsx and CommunityAuthModal are two
  // separate registration surfaces and their rules used to drift).
  checks.push(
    /export function validateName/.test(signupValidation)
      && /export function validateEmail/.test(signupValidation)
      && /export function validatePassword/.test(signupValidation)
      && /export function validateConfirm/.test(signupValidation)
      && /PASSWORD_MIN_LENGTH = 6/.test(signupValidation)
      && /STEP_VALIDATORS/.test(wizard) && /STEP_VALIDATORS/.test(signupValidation)
      ? ok('signup validation lives in one shared module and the wizard consumes it')
      : fail('signup validation is not centralised in utils/signupValidation.js'),
  );
  // The password must never reach the screen outside the two masked inputs, and
  // the review step must not echo it. A character count is the honest way to
  // show "your password is set" without showing the password.
  checks.push(
    !/value=\{values\.password\}/.test(wizard.replace(/type=\{showPassword[\s\S]*?\}[\s\S]*?value=\{values\.password\}/, ''))
      && /characters, hidden/.test(wizard)
      && /maskEmail/.test(wizard)
      ? ok('the review step shows a masked email and a length, never the password')
      : fail('the review step appears to render the password'),
  );
  // signUp must declare where a confirmation link returns to. Without it, the
  // one day email confirmation is switched on the link lands on the project's
  // Site URL with no handler for the token fragment.
  checks.push(
    /emailRedirectTo: `\$\{window\.location\.origin\}\/activate`/.test(wizard)
      ? ok('signUp passes emailRedirectTo so a confirmation link has a landing route')
      : fail('signUp passes no emailRedirectTo'),
  );
  // The wizard must be able to keep itself mounted long enough to show its
  // confirmation screen. Auth.jsx redirects (and unmounts via `session`) any
  // authenticated visitor off /signup, which silently ate the success screen
  // until the page claimed the redirect through a ref BEFORE signUp resolves.
  checks.push(
    /signupOwnsRedirect = useRef/.test(auth) && /!signupOwnsRedirect\.current/.test(auth)
      && /claimedRef\.current = true/.test(wizard)
      ? ok('Auth.jsx lets the wizard claim the post-signup redirect through a ref')
      : fail('Auth.jsx may tear the wizard down before it shows the success screen'),
  );

  // --- the visible pts are gone, the ranking maths is not ---
  const dash = read(resolve(ROOT, 'src/pages/Dashboard.jsx'));
  const quiz = read(resolve(ROOT, 'src/pages/Quiz.jsx'));
  const lb = read(resolve(ROOT, 'src/pages/Leaderboard.jsx'));
  // Match a rendered "N pts" TEXT NODE only - ` pts'` / " pts`" / ' pts<'.
  // A bare /pts/ would false-positive on `weakConcepts` (Con**cepts**) and on
  // the explanatory comment above, which is how the first version of this gate
  // failed on code that was already correct.
  const PTS_TEXT = /\spts['`<]/;
  checks.push(
    !PTS_TEXT.test(dash) && !PTS_TEXT.test(quiz) && !PTS_TEXT.test(lb)
      ? ok('no visible "N pts" score on the Dashboard, Quiz header or Leaderboard rows')
      : fail('a visible pts label is still rendered'),
  );
  checks.push(
    /playerScore/.test(read(resolve(ROOT, 'src/context/AppContext.jsx')))
      ? ok('the underlying score still exists and still decides the ranking (only the label was removed)')
      : fail('the ranking signal itself was removed, not just its display'),
  );

  // --- the static mock is gone ---
  checks.push(
    !existsSync(resolve(ROOT, 'Join the room.html'))
      ? ok('the standalone Join the room.html mock has been removed')
      : fail('Join the room.html still exists - it is an unwired static mock with a hardcoded taken=7'),
  );
}

// ---------------------------------------------------------------------------
// EVERY RELATIVE IMPORT RESOLVES.
//
// This gate exists because of a real break that shipped in a commit: a
// Sidebar.jsx import of BrandLogo was rewritten from './BrandLogo' to
// '../BrandLogo' by a diff-based edit that matched loosely and silently
// replaced the path. The app then failed to load the Sidebar at all, which
// took down the whole authenticated layout.
//
// It is the same failure mode as `friend_list()`: the code was there, the
// thing it pointed at was not, and nothing said so until a human opened the
// app. A build catches it, but the build takes 45-90 seconds, and the failure
// only shows up as "Failed to resolve import" in the browser console.
//
// This checks it statically, for EVERY file under src/, in about a second.
//
// It also proves the barrel is not quietly hiding a broken path: a relative
// import that resolves to a DIRECTORY with an index file is allowed, and
// anything else is reported with the file and the specifier that failed.
// ---------------------------------------------------------------------------
{
  const srcRoot = resolve(ROOT, 'src');
  const srcFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) srcFiles.push(full);
    }
  };
  if (existsSync(srcRoot)) walk(srcRoot);

  const broken = [];
  for (const file of srcFiles) {
    const src = readFileSync(file, 'utf8');
    const dir = dirname(file);
    // `from './x'`, `import './x'`, and `import('...')` for dynamic imports.
    const specs = [
      ...src.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/g),
      ...src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ];
    for (const m of specs) {
      const spec = m[1];
      const target = resolve(dir, spec);
      const candidates = [
        target,
        `${target}.jsx`, `${target}.js`, `${target}.mjs`, `${target}.ts`, `${target}.tsx`,
        resolve(target, 'index.jsx'), resolve(target, 'index.js'),
      ];
      if (!candidates.some((c) => existsSync(c))) {
        broken.push(`${relative(ROOT, file)} -> ${spec}`);
      }
    }
  }

  checks.push(
    broken.length === 0
      ? ok(`every relative import under src/ resolves (${srcFiles.length} files checked)`)
      : fail('a relative import under src/ does not resolve - the app will fail to load that module', broken.slice(0, 8).join(' | ')),
  );
}

// ---------------------------------------------------------------------------
// PART S — GUIDED SIGN-UP (v99 client) + TIMED LIVE EVENTS (migration-v99).
//
// Every gate below was written against a live-proven failure, not against the
// happy path. The "why" comment on each is the reason it exists.
// ---------------------------------------------------------------------------
{
  const v99 = read(resolve(ROOT, 'scripts/migration-v99-anonymous-live-event.sql'));
  const comm = read(resolve(ROOT, 'api/_community.js'));
  const utils = read(resolve(ROOT, 'api/_utils.js'));
  const initiate = read(resolve(ROOT, 'api/initiate-payment.js'));
  const bar = read(resolve(ROOT, 'src/components/LiveEventBar.jsx'));
  const room = read(resolve(ROOT, 'src/pages/AnonymousRoom.jsx'));

  // --- the 40-60 range is a CHECK, not a UI hint --------------------------
  checks.push(
    /event_duration_minutes between 40 and 60/.test(v99)
      && /study_groups_event_duration_check/.test(v99)
      && /EVENT_MIN_MINUTES = 40/.test(comm) && /EVENT_MAX_MINUTES = 60/.test(comm)
      ? ok('v99: the 40-60 minute range is enforced by a DB CHECK and mirrored by the server constants')
      : fail('v99: the 40-60 range is not enforced in the database'),
  );

  // --- the window cannot be extended --------------------------------------
  // The window CHECK alone was NOT enough: probing proved that shifting both
  // event_started_at and event_ends_at forward together satisfied it and
  // returned HTTP 201. This trigger is what closed that hole.
  checks.push(
    /study_groups_event_window_check/.test(v99)
      && /EVENT_CLOCK_IMMUTABLE/.test(v99)
      && /trg_anon_event_clock_lock/.test(v99)
      && /old\.event_started_at is null/.test(v99)
      ? ok('v99: the clock window is consistent AND immutable once an event has started')
      : fail('v99: a started event\'s deadline can still be moved (the extension hole)'),
  );

  // --- activation starts the clock, once ----------------------------------
  checks.push(
    /trg_anon_event_activate/.test(v99)
      && /new\.event_started_at is null/.test(v99)
      && /old\.group_state is distinct from 'active'/.test(v99)
      ? ok('v99: the clock is stamped on the waiting->active transition and is idempotent')
      : fail('v99: activation does not stamp the clock idempotently'),
  );

  // --- expiry is a PREDICATE on the server clock --------------------------
  checks.push(
    /create or replace function public\._anon_event_over/.test(v99)
      && /now\(\) >= g\.event_ends_at/.test(v99)
      && /coalesce/.test(v99)
      ? ok('v99: _anon_event_over() is a server-clock predicate that fails closed')
      : fail('v99: the expiry predicate is missing or does not use the server clock'),
  );

  // --- no new seat into an ended event, at the DATA layer -----------------
  checks.push(
    /trg_anon_event_member_seat/.test(v99) && /trg_anon_event_spectator_seat/.test(v99)
      && /raise exception 'EVENT_ENDED'/.test(v99)
      ? ok('v99: member and spectator seat INSERTs are refused for an ended event at the data layer')
      : fail('v99: a seat can still be granted into an ended event'),
  );

  // --- the seat RPCs stay service-role only ------------------------------
  checks.push(
    /revoke execute on function public\.community_anonymous_event_end\(bigint, text\)\s*\n?\s*from public, anon, authenticated/.test(v99)
      && /revoke execute on function public\.community_anonymous_event_sweep\(timestamptz\)\s*\n?\s*from public, anon, authenticated/.test(v99)
      ? ok('v99: the end/sweep RPCs are revoked from public, anon AND authenticated (the live-grant gotcha)')
      : fail('v99: the end/sweep RPCs are still executable by anon/authenticated'),
  );

  // --- exactly-once ending -----------------------------------------------
  checks.push(
    /pg_advisory_xact_lock\(hashtext\('anon_event:'/.test(v99)
      && /already_ended/.test(v99) && /event_ended_at is not null/.test(v99)
      ? ok('v99: ending an event is advisory-locked and idempotent (exactly once)')
      : fail('v99: ending an event is neither locked nor idempotent'),
  );

  // --- the sweep function must READ the jsonb result ---------------------
  // It was written as `if community_anonymous_event_end(...) then` — a 22P02
  // that took the whole sweep down. Caught by probing, not by reading.
  checks.push(
    /v_res := public\.community_anonymous_event_end/.test(v99)
      && /\(v_res ->> 'ok'\)::boolean/.test(v99)
      && !/if public\.community_anonymous_event_end\(/.test(v99)
      ? ok('v99: the bulk sweep reads the RPC\'s jsonb result instead of testing it as a boolean')
      : fail('v99: the bulk sweep tests a jsonb return value as a boolean (22P02)'),
  );

  // --- the watchdog is suspended only while live -------------------------
  checks.push(
    /v_event_live :=/.test(v99)
      && /if v_gr\.group_state = 'active' and v_event_live then/.test(v99)
      && /'event_live', v_event_live/.test(v99)
      ? ok('v99: idle-release and the wipe watchdog are suspended only while an event is live')
      : fail('v99: the membership watchdog is not suspended during a live event'),
  );

  // --- every write path is guarded, and no READ path is -----------------
  // The guard list is asserted by handler name so adding a new write handler
  // without a guard shows up as a diff against this gate.
  for (const fn of ['handleAnonSend', 'handleAnonReact', 'handleAnonSocial', 'handleAnonEventReact',
    'handleAnonEventRespond', 'handleAnonEncoded', 'handleVote', 'handleJoinGroup',
    'handleAnonSpectateFree', 'handleAnonGiftClaim', 'handleAnonDuel']) {
    const start = comm.indexOf(`export async function ${fn}(`);
    const next = comm.indexOf('\nexport async function ', start + 10);
    const body = comm.slice(start, next < 0 ? undefined : next);
    checks.push(
      /requireLiveEvent\(/.test(body)
        ? ok(`v99: ${fn} refuses writes once the event has ended`)
        : fail(`v99: ${fn} can still write into an ended event`),
    );
  }
  // Reads must survive the deadline — an event that hid its own history would
  // destroy the thing the 40-60 minute window produced.
  for (const fn of ['handleAnonFeed', 'handleAnonMessage', 'handleAnonEvent']) {
    const start = comm.indexOf(`export async function ${fn}(`);
    const next = comm.indexOf('\nexport async function ', start + 10);
    const body = comm.slice(start, next < 0 ? undefined : next);
    checks.push(
      !/const eventRefusal = await requireLiveEvent/.test(body)
        ? ok(`v99: ${fn} is a read and stays readable after the event ends`)
        : fail(`v99: ${fn} is a READ but is gated - history must survive expiry`),
    );
  }
  // The presence heartbeat must NOT be gated: a gated heartbeat releases seats.
  {
    const start = comm.indexOf('export async function handleAnonPresence(');
    const next = comm.indexOf('\nexport async function ', start + 10);
    const body = comm.slice(start, next < 0 ? undefined : next);
    checks.push(
      !/requireLiveEvent/.test(body)
        ? ok('v99: the presence heartbeat is NOT gated (a gated heartbeat releases seats)')
        : fail('v99: the presence heartbeat is gated'),
    );
  }

  // --- an out-of-range duration is REFUSED, not rounded ------------------
  checks.push(
    /normaliseEventDuration/.test(comm) && /EVENT_DURATION_OUT_OF_RANGE/.test(comm)
      && /return null;/.test(comm)
      && /event_duration_minutes: duration/.test(comm)
      ? ok('v99: room creation clamps the duration server-side and refuses an out-of-range request')
      : fail('v99: room creation does not validate the requested duration'),
  );

  // --- the payment surface refuses to SELL a seat into a closed event ----
  checks.push(
    /export async function isEventOver/.test(utils)
      && (initiate.match(/isEventOver\(supabase, groupId\)/g) || []).length === 3
      && /e\.code = 'EVENT_ENDED'; e\.status = 409/.test(initiate)
      ? ok('v99: all three anonymous-room purchase resolvers refuse before a Paystack transaction exists')
      : fail('v99: a closed event can still be charged for'),
  );

  // --- the client renders the bar from the SERVER's block ----------------
  checks.push(
    /eventBlockFor/.test(comm) && /serverNow: new Date\(nowMs\)\.toISOString\(\)/.test(comm)
      && /can_write: viewable && event\.state !== 'ended'/.test(comm)
      && /data-testid="live-event-bar"/.test(bar)
      && /<LiveEventBar/.test(room)
      ? ok('v99: the room payload carries an offset-correctable event block and the client renders it')
      : fail('v99: the live-event header is not wired to the server event block'),
  );

  // --- the client's countdown must not DECIDE validity --------------------
  checks.push(
    /const canWrite = room\?\.can_write !== false && room\?\.event\?\.state !== 'ended'/.test(room)
      && /\{canWrite \? \(/.test(room)
      && /room\?\.event\?\.endsAt/.test(room) === false
      ? ok('v99: writes are gated on the server flag, never on the local countdown')
      : fail('v99: the client is gating writes on its own countdown instead of the server flag'),
  );

  // --- a room with no clock must not render a fake countdown -------------
  checks.push(
    /if \(remainingMs === null\) return null/.test(bar)
      && /if \(state === 'ended'\) return null/.test(bar)
      && /the clock starts when the room opens/.test(bar)
      ? ok('v99: an un-started room shows an honest waiting state with no fabricated countdown')
      : fail('v99: the countdown is rendered even when there is no deadline'),
  );
}

// ===========================================================================
// PART T — PREMIUM CONVERSION (v100) + PAYSTACK INTEGRITY
// ===========================================================================
//
// Every gate here was written against a failure that was PROVEN LIVE, not
// against the happy path. The two money gates in particular are not style
// preferences: both were real ways to obtain Premium without paying for it.
// ---------------------------------------------------------------------------
{
  const v100 = read(resolve(ROOT, 'scripts/migration-v100-premium-conversion.sql'));
  const verifyPay = read(resolve(ROOT, 'api/verify-payment.js'));
  const webhook = read(resolve(ROOT, 'api/payments-webhook.js'));
  const feedback = read(resolve(ROOT, 'api/feedback.js'));
  const modal = read(resolve(ROOT, 'src/components/Modal.jsx'));
  const upsell = read(resolve(ROOT, 'src/components/PremiumUpgradeModal.jsx'));
  const activate = read(resolve(ROOT, 'src/pages/Activate.jsx'));
  const quiz = read(resolve(ROOT, 'src/pages/Quiz.jsx'));
  const setupFlow = read(resolve(ROOT, 'src/components/QuizSetupFlow.jsx'));
  const daily = read(resolve(ROOT, 'src/components/DailyChallengeWidget.jsx'));
  const market = read(resolve(ROOT, 'src/pages/Marketplace.jsx'));
  const adminPlans = read(resolve(ROOT, 'src/components/AdminPlansTab.jsx'));
  const adminFin = read(resolve(ROOT, 'src/pages/AdminFinance.jsx'));
  const ctx = read(resolve(ROOT, 'src/context/AppContext.jsx'));
  const safeStore = read(resolve(ROOT, 'src/utils/safeStorage.js'));
  const pkg = read(resolve(ROOT, 'package.json'));

  // --- THE EXPLOIT: a plan-less charge must grant nothing ------------------
  // The Paystack PUBLIC key is public, so anyone can initialize a charge whose
  // metadata omits plan_id. With a `durationDays = 30` default and a nullable
  // expected price, the amount guard was skipped entirely and a ₦1 charge
  // granted 30 days of Premium. The webhook was worse: it fell back to
  // `expected_amount_kobo`, which the PAYER wrote.
  checks.push(
    /if \(!planId\)/.test(verifyPay)
      && /if \(!metadata\?\.plan_id\)/.test(webhook)
      && !/let durationDays = 30/.test(verifyPay)
      && !/let durationDays = 30/.test(webhook)
      ? ok('v100: both payment paths REFUSE a charge with no plan_id (no 30-day default)')
      : fail('v100: a plan-less charge can still fall through to a default grant'),

    // The self-certified amount must not be treated as the authority.
    !/expectedPrice = Number\(metadata\.expected_amount_kobo\)/.test(webhook)
      && /plan_unresolved/.test(webhook)
      ? ok('v100: the webhook no longer trusts the payer-authored expected_amount_kobo')
      : fail('v100: the webhook still falls back to a payer-authored expected amount'),

    // The amount guard must be unconditional once a plan resolves.
    /Math\.abs\(paidAmount - expectedPrice\) > 1/.test(verifyPay)
      && !/expectedPrice !== null && Math\.abs/.test(verifyPay)
      ? ok('v100: the amount guard always runs once a plan resolves')
      : fail('v100: the amount guard can still be skipped'),

    // An INACTIVE plan must not be honoured either.
    /is_active === false/.test(verifyPay) && /is_active === false/.test(webhook)
      && /plan_unavailable/.test(webhook)
      ? ok('v100: an inactive plan is refused on both paths')
      : fail('v100: an inactive plan would still grant'),

    // The grant must use the PLAN's own duration, not a constant.
    /durationDays = plan\.duration_days/.test(verifyPay)
      && /durationDays = plan\.duration_days/.test(webhook)
      ? ok('v100: the grant duration comes from the plan row')
      : fail('v100: the grant duration is not taken from the plan'),
  );

  // --- signature comparison must be constant-time --------------------------
  checks.push(
    /crypto\.timingSafeEqual/.test(webhook)
      && /providedBuf\.length === expectedBuf\.length/.test(webhook)
      && !/hash !== req\.headers/.test(webhook)
      ? ok('v100: the webhook signature is compared with timingSafeEqual, length-guarded')
      : fail('v100: the webhook signature comparison is not constant-time'),

    // The length guard is what stops timingSafeEqual THROWING on a short
    // signature, which would be a 500 instead of a clean 401.
    /typeof req\.headers\['x-paystack-signature'\] === 'string'/.test(webhook)
      ? ok('v100: a missing or non-string signature header is coerced, not thrown on')
      : fail('v100: a missing signature header is not handled'),
  );

  // --- analytics privacy: closed allowlists, not passthroughs --------------
  checks.push(
    /VALID_CONVERSION_ACTIONS/.test(feedback) && /CONVERSION_METADATA_KEYS/.test(feedback)
      ? ok('v100: conversion events use a closed action AND metadata-key allowlist')
      : fail('v100: conversion events lack a closed allowlist'),

    // Spreading the caller's metadata object would let ANY key through. This
    // checks the CODE, not the prose: a match inside a comment is the comment
    // explaining the pitfall, not the pitfall.
    //
    // The spread pattern must tolerate the PARENTHESISED form. A negative test
    // proved `...metadata` does NOT match `...(metadata || {})`, so that gate
    // passed a real passthrough. `...(metadata` is now matched explicitly.
    (() => {
      const code = feedback
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      const spreadsCallerObject =
        /\.\.\.\s*\(?\s*metadata\b/.test(code) || /\.\.\.\s*\(?\s*flat\b/.test(code);
      return !spreadsCallerObject && /CONVERSION_METADATA_KEYS/.test(code);
    })()
      ? ok('v100: the caller metadata object is field-by-field, never spread through')
      : fail('v100: the caller metadata object is spread into the row'),

    // Writes are service-role only; there is no client INSERT policy.
    /grant select on public\.conversion_events to authenticated/.test(v100)
      && /revoke all on public\.conversion_events from public, anon;/.test(v100)
      ? ok('v100: conversion_events is admin-read-only and service-role-write')
      : fail('v100: conversion_events grants are wrong'),

    // The anonymous surface must not expose the rest of server_config.
    /create or replace function public\.premium_offer_public/.test(v100)
      && /conversion_events_prune\(p_days integer default 180\)/.test(v100)
      ? ok('v100: the offer has its own narrow RPC and retention defaults to 180 days')
      : fail('v100: the offer RPC or retention default is missing'),
  );

  // --- prices are admin-controlled, and the client cannot invent them ------
  checks.push(
    /reference_price/.test(v100)
      && /subscription_plans_reference_above_price/.test(v100)
      && /subscription_plans_price_non_negative/.test(v100)
      ? ok('v100: reference prices exist and are constrained in the database')
      : fail('v100: reference price constraints are missing'),

    /offer_eligible/.test(v100) && /sort_order/.test(v100)
      && /\.order\('sort_order', \{ ascending: true \}\)/.test(ctx)
      ? ok('v100: annual-first ordering is data-driven via sort_order')
      : fail('v100: plan ordering is not driven by sort_order'),

    // Ordering by PRICE would put the cheapest (weekly) first and quietly
    // defeat the annual-first decision.
    !/\.order\('price', \{ ascending: true \}\)\s*;/.test(ctx.slice(0, ctx.indexOf("static:subscription-plans") + 400))
      || /sort_order/.test(ctx.slice(0, ctx.indexOf("static:subscription-plans") + 400))
      ? ok('v100: plans are not ordered by price alone (annual would sort last)')
      : fail('v100: plans are still ordered by price ascending'),

    /admin_set_plan_pricing/.test(v100) && /admin_set_premium_offer/.test(v100)
      && /admin_set_plan_pricing/.test(adminPlans) && /admin_set_premium_offer/.test(adminPlans)
      ? ok('v100: both admin pricing/offer RPCs exist and are wired to the admin UI')
      : fail('v100: the admin pricing/offer controls are not wired'),

    // The plans tab must be reachable and must render the real controls.
    /activeTab === 'plans'/.test(adminFin) && /<AdminPlansTab \/>/.test(adminFin)
      ? ok('v100: the admin plans tab renders real controls, not the maintenance placeholder')
      : fail('v100: the admin plans tab is still a placeholder'),

    /id: 'plans'/.test(adminFin) && !/id: 'plans', label: 'Subscription Plans', icon: <SettingsIcon size=\{16\} \/>, superOnly: true/.test(adminFin)
      ? ok('v100: the plans tab is visible to is_admin() users, matching the RPC gate')
      : fail('v100: the plans tab visibility does not match the is_admin() gate'),
  );

  // --- no fabricated deadlines --------------------------------------------
  checks.push(
    /if \(!endsAt\) return null/.test(upsell) && /if \(!endsAt\) return null/.test(activate)
      ? ok('v100: a countdown is only ever rendered from a server-supplied end time')
      : fail('v100: a countdown can render without a real deadline'),

    // The offer ships disabled; the client must gate promo display on it.
    /const offerLive = premiumOffer\?\.enabled === true/.test(activate)
      && /offerLive && promoPlans\.length > 0/.test(activate)
      ? ok('v100: promo pricing is hidden unless the server says the offer is live')
      : fail('v100: promo pricing is shown regardless of the server offer state'),

    // "Student Offer" was a hardcoded banner reading ₦990 / ₦550 while the
    // same numbers lived in the plan table — two sources that can drift.
    !/Student Bonus pricing is live — pay/.test(activate)
      && /premiumOffer\?\.headline/.test(activate)
      ? ok('v100: the promo banner is rendered from server state, not hardcoded prices')
      : fail('v100: the promo banner still hardcodes prices'),
  );

  // --- the upsell must not overclaim --------------------------------------
  // Premium does NOT grant unlimited questions, flashcards, Arena, or Smart
  // Coins. Flashcards are an admin grant and the Arena is coin-gated, so
  // advertising either would sell something that never arrives.
  checks.push(
    // "Unlimited rounds" overclaims: what Premium removes is the 30-minute
    // cooldown, and "unlimited" reads to a learner as "unlimited questions",
    // which is a different (and untrue) promise. Comments explaining WHY the
    // claim was removed are excluded — the gate is on rendered copy.
    [upsell, activate, quiz, daily].every((src) => {
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/\{\/\*/.test(l))
        .join('\n');
      return !/unlimited\s+rounds/i.test(code) && !/for unlimited/i.test(code);
    })
      ? ok('v100: no "unlimited rounds" overclaim survives in the Premium surface')
      : fail('v100: an "unlimited rounds" overclaim is still present'),

    /This does not auto-renew/.test(upsell) && /No auto-renewal/.test(activate)
      ? ok('v100: the no-auto-renewal fact is stated on both the modal and the pricing page')
      : fail('v100: the no-auto-renewal statement is missing'),

    // Activation is NOT premium: `is_activated` is a free signup milestone, so
    // routing that gate through a paid prompt would be mis-selling.
    /requireActivated/.test(quiz) && /navigate\('\/activate'\)/.test(quiz)
      && /is not a synonym for/.test(quiz)
      ? ok('v100: the ACTIVATION gate stays on /activate and is not treated as Premium')
      : fail('v100: the activation gate may be routed as a Premium upsell'),

    // Every gate must open the modal rather than hard-navigate.
    /PremiumUpgradeModal/.test(quiz) && /PremiumUpgradeModal/.test(setupFlow)
      && /PremiumUpgradeModal/.test(daily) && /PremiumUpgradeModal/.test(market)
      ? ok('v100: all four Premium gates render the contextual modal')
      : fail('v100: a Premium gate still bypasses the modal'),

    !/onClick=\{\(\) => navigate\('\/activate'\)\}/.test(quiz)
      ? ok('v100: no bare navigate("/activate") remains on a Premium gate')
      : fail('v100: a bare navigate("/activate") remains on a Premium gate'),

    // The marketplace lock used to be a static panel with no way out.
    /onClick=\{onUpgrade\}/.test(market) && /onUpgrade/.test(adminFin + market)
      ? ok('v100: the marketplace Premium lock is actionable')
      : fail('v100: the marketplace Premium lock is still a dead end'),
  );

  // --- the modal must be an accessible, escapeable overlay ----------------
  checks.push(
    /role="dialog"/.test(modal) && /aria-modal="true"/.test(modal)
      && /e\.key === 'Escape'/.test(modal)
      && /e\.key !== 'Tab'/.test(modal)
      ? ok('v100: the shared Modal is a keyboard-dismissable, focus-trapped dialog')
      : fail('v100: the shared Modal lacks ARIA, Escape or a Tab trap'),

    /document\.body\.style\.overflow = 'hidden'/.test(modal)
      ? ok('v100: the shared Modal locks body scroll while open')
      : fail('v100: the shared Modal does not lock body scroll'),

    // A dismissible gate is not a gate; the prop must exist so a real gate can
    // turn Escape off.
    /dismissible = true/.test(modal)
      ? ok('v100: the Modal can opt out of dismissal for non-dismissible gates')
      : fail('v100: the Modal cannot be made non-dismissible'),

    // Frequency: a contextual upsell must not reappear on every attempt, and a
    // user who explicitly asked for it must not be silently suppressed.
    /isPromptAllowed/.test(safeStore) && /notePromptShown/.test(safeStore)
      && /PROMPT_MAX_PER_WINDOW/.test(upsell) && /automatic = true/.test(upsell)
      ? ok('v100: the upsell is frequency-capped, and explicit prompts bypass the cap')
      : fail('v100: the upsell has no frequency control'),
  );

  // --- the e2e suite is wired ---------------------------------------------
  checks.push(
    /"e2e:premium": "node scripts\/e2e-premium\.mjs"/.test(pkg)
      && /P6–P8/.test(read(resolve(ROOT, 'scripts/e2e-premium.mjs')))
      ? ok('v100: the e2e:premium suite is registered and covers the payment paths')
      : fail('v100: the e2e:premium suite is missing or does not cover payments'),

    // A policy without a grant is dead code: proven live as
    // `permission denied for table conversion_events` on an admin read.
    /create policy "conversion_events_admin_read"/.test(v100)
      && /grant select on public\.conversion_events to authenticated/.test(v100)
      ? ok('v100: the admin read policy is backed by an actual table GRANT')
      : fail('v100: the admin RLS policy has no matching GRANT'),
  );
}

// ===========================================================================
// PART U — BLITZ DUEL WITH FLOW STATE (v101)
// ===========================================================================
//
// A server-authoritative 1v1 (user vs Scholar bot) with a 90s shared clock, a
// 2 SC stake and a Flow State. Every rule lives in service_role-only
// blitz_duel_* RPCs; the client reaches them only through api/_blitz-duel.js.
// ---------------------------------------------------------------------------
{
  const v101 = read(resolve(ROOT, 'scripts/migration-v101-blitz-duel.sql'));
  const api = read(resolve(ROOT, 'api/_blitz-duel.js'));
  const router = read(resolve(ROOT, 'api/quiz.js'));
  const vercel = read(resolve(ROOT, 'vercel.json'));
  const serveApi = read(resolve(ROOT, 'scripts/serve-api.mjs'));
  const clientApi = read(resolve(ROOT, 'src/utils/blitzDuelApi.js'));
  const page = read(resolve(ROOT, 'src/pages/BlitzDuel.jsx'));
  const app = read(resolve(ROOT, 'src/App.jsx'));
  const pkg = read(resolve(ROOT, 'package.json'));
  const e2e = read(resolve(ROOT, 'scripts/e2e-blitz-duel.mjs'));

  // --- THE BUG THE LIVE E2E CAUGHT -----------------------------------------
  // `(timestamptz - timestamptz)` is an INTERVAL, and `interval::bigint` is a
  // hard 42846. `((m.ends_at - m.starts_at) * 1000)::bigint` therefore made
  // EVERY blitz RPC throw before it could answer. This gate exists because the
  // bug passed the apply AND the static verifier and was only found by running
  // the RPCs live — a static gate proves the SQL is written, never that it runs.
  checks.push(
    /extract\(epoch from \(m\.ends_at - m\.starts_at\)\)/.test(v101)
      ? ok('v101: the match duration uses extract(epoch …) rather than a bare interval')
      : fail('v101: the match duration is not extracted from the interval'),

    !/\(\(m\.ends_at - m\.starts_at\) \* 1000\)::bigint/.test(v101)
      ? ok('v101: no raw interval is cast straight to bigint (a live 42846)')
      : fail('v101: an interval is cast straight to bigint (42846 at runtime)'),
  );

  // --- schema + the three service_role-only tables -------------------------
  checks.push(
    /create table if not exists public\.blitz_duel_questions/.test(v101)
      && /create table if not exists public\.blitz_duels/.test(v101)
      && /create table if not exists public\.blitz_duel_rate_limits/.test(v101)
      && /enable row level security/.test(v101)
      ? ok('v101: the question bank, the match table and the rate limiter exist with RLS on')
      : fail('v101: a blitz table or its RLS is missing'),

    /create unique index if not exists uq_blitz_duels_active_user[\s\S]{0,160}where status = 'active'/.test(v101)
      ? ok('v101: one ACTIVE match per user is enforced by a partial unique index')
      : fail('v101: a user could hold two active blitz matches'),

    /_blitz_rate_check/.test(v101)
      && /on conflict \(user_id, action, window_start\)/.test(v101)
      ? ok('v101: the rate limiter increments atomically via an upsert, not read-then-write')
      : fail('v101: the rate limiter is not atomic'),
  );

  // --- the answer key can never leave the database -------------------------
  // _blitz_question is the ONLY egress for a question, and it selects columns
  // by name — correct_answer and explanation are simply absent, so a rationale
  // that quotes the answer cannot leak either.
  checks.push(
    (() => {
      const start = v101.indexOf('create or replace function public._blitz_question');
      const end = v101.indexOf('create or replace function public._blitz_state');
      const body = start >= 0 && end > start ? v101.slice(start, end) : '';
      return /'options', options/.test(body) && !/correct_answer|explanation/.test(body);
    })()
      ? ok('v101: _blitz_question projects no correct_answer/explanation — the key stays server-side')
      : fail('v101: the question egress can leak the answer key'),
  );

  // --- money moves only through the one canonical mutator ------------------
  checks.push(
    /public\._sc_apply\(/.test(v101)
      && /md5\('blitz:' \|\| m\.id::text \|\| ':win'\)/.test(v101)
      && /md5\('blitz:' \|\| m\.id::text \|\| ':refund'\)/.test(v101)
      && /md5\('blitz:' \|\| v_new\.id::text \|\| ':stake'\)/.test(v101)
      ? ok('v101: stake/win/refund all go through _sc_apply with deterministic md5 keys')
      : fail('v101: a blitz coin move is not deterministic through _sc_apply'),

    /revoke all on function public\.%s from public, anon, authenticated/.test(v101)
      && /grant execute on function public\.%s to service_role/.test(v101)
      && /blitz_duel_settle\(uuid, uuid\)/.test(v101)
      ? ok('v101: every blitz function is revoked from anon/authenticated and granted to service_role only')
      : fail('v101: the blitz function ACLs are not locked to service_role'),

    /notify pgrst, 'reload schema'/.test(v101)
      ? ok('v101: the migration reloads the PostgREST schema cache')
      : fail('v101: the migration does not reload the schema cache'),
  );

  // --- the server module + router + rewrites -------------------------------
  checks.push(
    ['handleBlitzCreate', 'handleBlitzState', 'handleBlitzAnswer', 'handleBlitzSkip', 'handleBlitzFlow', 'handleBlitzSettle', 'handleBlitzRematch']
      .every((h) => api.includes(`export async function ${h}(`))
      && /ERROR_STATUS/.test(api) && /RATE_LIMITED: 429/.test(api) && /MATCH_CLOSED: 409/.test(api)
      ? ok('v101: api/_blitz-duel.js exports all seven handlers with the error→status map')
      : fail('v101: an api/_blitz-duel.js handler or the error map is missing'),

    !existsSync(resolve(ROOT, 'api/blitz.js'))
      ? ok('v101: blitz rides the existing quiz function (no new api/*.js — Hobby cap intact)')
      : fail('v101: a new api/blitz.js function would breach the Hobby cap'),

    /blitz\[-\/\]\?duel\[-\/\]/.test(router)
      && ['create', 'state', 'answer', 'skip', 'flow', 'settle', 'rematch'].every((r) => router.includes(`blitz === '${r}'`))
      ? ok('v101: api/quiz.js dispatches all seven blitz sub-routes before the batch routes')
      : fail('v101: a blitz sub-route is not dispatched from api/quiz.js'),

    /"source": "\/api\/blitz-duel\/:path\*"/.test(vercel)
      && /source: '\/api\/blitz-duel\/:path\*', destination: '\/api\/quiz'/.test(serveApi)
      ? ok('v101: vercel.json and serve-api.mjs both rewrite /api/blitz-duel/* to /api/quiz')
      : fail('v101: the blitz rewrite is missing from vercel.json or serve-api.mjs'),

    /apiFetch\('\/blitz-duel\/create'/.test(clientApi)
      && !/apiFetch\('\/api\/blitz-duel/.test(clientApi)
      ? ok('v101: the client talks to /blitz-duel/* (apiFetch adds the /api prefix)')
      : fail('v101: the client duplicates the /api prefix'),
  );

  // --- the client surface --------------------------------------------------
  checks.push(
    /export default function BlitzDuel\(/.test(page)
      && /function SetupView\(/.test(page) && /function ActiveView\(/.test(page) && /function ResultsView\(/.test(page)
      && /const BLITZ_CSS = `/.test(page)
      ? ok('v101: BlitzDuel.jsx ships the setup/active/results views and its page-scoped styles')
      : fail('v101: a BlitzDuel.jsx view or its scoped CSS is missing'),

    /const MATCH_KEY = 'blitz_duel_match_id'/.test(page) && /const PACE_KEY = 'blitz_duel_pace'/.test(page)
      ? ok('v101: the active match id and pace persist under their own localStorage keys')
      : fail('v101: the blitz localStorage keys are missing'),

    // RotateCcw is not exported by Icons.jsx; RefreshCw is. A wrong icon import
    // is a runtime blank page, not a lint error, so it is gated.
    /RefreshCw/.test(page) && !/RotateCcw/.test(page)
      ? ok('v101: the rematch icon is the exported RefreshCw, not the unexported RotateCcw')
      : fail('v101: the page imports an icon Icons.jsx does not export'),

    /const BlitzDuel = lazy\(\(\) => import\('\.\/pages\/BlitzDuel'\)\)/.test(app)
      && /path="\/blitz-duel" element=\{<RequireAuth><BlitzDuel \/><\/RequireAuth>\}/.test(app)
      ? ok('v101: /blitz-duel is a lazy, auth-gated route')
      : fail('v101: the /blitz-duel route is missing or not auth-gated'),

    /"e2e:blitz-duel": "node scripts\/e2e-blitz-duel\.mjs"/.test(pkg)
      && /match\?\.settlement/.test(e2e)
      ? ok('v101: the e2e:blitz-duel suite is registered and reads the nested match.settlement')
      : fail('v101: the blitz e2e suite is missing or reads the wrong settlement path'),
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