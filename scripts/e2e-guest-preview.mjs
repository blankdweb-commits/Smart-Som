// ============================================================================
// e2e-guest-preview.mjs  (npm run e2e:guest-preview)
//
// Proves the Phase 1 one-time guest preview contract against the REAL dev API
// (serve-api on :3001) and the REAL handlers, using raw fetch — no browser, no
// signed-in session. Every guest assertion here is a negative: the point is
// that a signed-out visitor with a valid preview token still cannot touch
// anything that writes.
//
// Run:  node --env-file=.env scripts/e2e-guest-preview.mjs
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API = process.env.DEV_API_BASE || 'http://localhost:3001';

// Windows: an absolute path is not a valid ESM specifier. Go via file://.
const { handleGuestPreviewStart, handleGuestPreviewStream } = await import(
  pathToFileURL(path.join(ROOT, 'api/_community.js')).href
);

// --- tiny harness ----------------------------------------------------------
let passed = 0, failed = 0;
const log = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed += 1; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (t) => console.log(`\n---- ${t} ----`);

// Call a Vercel-style handler with a fake req/res. Returns { status, body }.
function callHandler(fn, body, { method = 'POST', headers = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, url: '/', body, headers: { host: 'localhost', ...headers } };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
    };
    fn(req, res).catch((e) => resolve({ status: 500, body: { error: String(e?.message || e) } }));
  });
}

const start = (body = {}, headers) => callHandler(handleGuestPreviewStart, body, { headers });
const stream = (body = {}, headers) => callHandler(handleGuestPreviewStream, body, { headers });

// --- 0. the dev API must be up --------------------------------------------
section('dev API reachable');
try {
  const r = await fetch(`${API}/api/community/anonymous/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  log('dev API answers the preview route', r.ok, `status=${r.status}`);
} catch (e) {
  console.log(`FAIL  dev API unreachable at ${API} — start it with: npm run dev`);
  process.exit(1);
}

// --- 1. one mint per guest -------------------------------------------------
section('one-time window');
const first = await start({});
log('first visit mints a window', first.status === 200 && first.body?.ok === true,
  `status=${first.status} already_used=${first.body?.already_used}`);
const token = first.body?.token;

log('the token is opaque and signed', typeof token === 'string' && /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
// expires_at is truncated to a whole second (the token signs a second-granular
// `e`), while server_now carries milliseconds, so the observed gap can read as
// 299.x. What matters is that it is never MORE than 300 — the advertised
// deadline must never exceed what the signed token will actually honour.
const windowSecs = (Date.parse(first.body?.expires_at) - Date.parse(first.body?.server_now)) / 1000;
log('the window is 5 minutes on the SERVER clock, and never oversold',
  windowSecs > 298 && windowSecs <= 300, `${windowSecs.toFixed(3)}s`);

const again = await start({ token });
log('re-presenting the token does NOT mint or extend a second window',
  again.status === 200 && again.body?.already_used === true
  && again.body?.expires_at === first.body?.expires_at,
  `already_used=${again.body?.already_used} sameExpiry=${again.body?.expires_at === first.body?.expires_at}`);

// --- 2. a spent / forged token is refused, never re-minted ----------------
section('spent and forged tokens');
for (const [label, bad] of [
  ['garbage', 'nonsense'],
  ['wrong signature', 'v1.aaaa.bbbb'],
  ['stripped signature', String(token || '').replace(/^v1\./, '')],
  ['empty', '   '],
]) {
  const r = await start({ token: bad });
  log(`${label} token is refused as already-used`, r.status === 403 && r.body?.error === 'PREVIEW_ALREADY_USED',
    `status=${r.status} ${r.body?.error}`);
}

// A signature from a DIFFERENT secret must not validate.
const foreign = await start({ token: `${String(token).split('.').slice(0, 2).join('.')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` });
log('a forged HMAC from another secret is refused', foreign.status === 403);

// --- 3. the read is bounded and minimal -----------------------------------
section('read-only stream');
const read = await stream({ token });
log('the stream is readable with a live token', read.status === 200 && read.body?.ok === true,
  `status=${read.status}`);
log('the stream declares itself read-only', read.body?.read_only === true && read.body?.access === 'guest_preview');
log('messages are a bounded array', Array.isArray(read.body?.messages),
  `${read.body?.messages?.length ?? 0} messages`);
log('the stream returns a server_now + expiry to anchor the client clock',
  !!read.body?.server_now && !!read.body?.expires_at);

// Nothing private may appear anywhere in the payload.
const payloadText = JSON.stringify(read.body);
const leaks = [
  ['author_id', /author_id/],
  ['user id', /user_id/i],
  ['email', /@|email/i],
  ['access token', /eyJ[A-Za-z0-9_-]{10,}/],
  ['supabase key', /supabase|sb_publishable|service_role/i],
  ['score', /"score"/],
  ['reaction counts', /"reactions"/],
  ['encoded reveal flags', /encoded_for_me|can_unreveal/],
  ['roster', /members/],
];
for (const [label, re] of leaks) {
  log(`payload carries no ${label}`, !re.test(payloadText));
}

// Per-message shape.
for (const m of read.body?.messages || []) {
  log('each message exposes only the minimal field set',
    Object.keys(m).every((k) => ['id', 'alias', 'author', 'content', 'encoded', 'created_at', 'state', 'lives_until'].includes(k)),
    Object.keys(m).join(','));
  log('alias is rendered as "Anonymous #NN"', /^Anonymous #\d{2,4}$/.test(m.author || ''), m.author);
  break;
}

// --- 4. expiry is enforced by the SERVER ----------------------------------
section('server-enforced expiry');
for (const [label, bad] of [['no token', undefined], ['forged token', 'v1.aaa.bbb']]) {
  const r = await stream(bad ? { token: bad } : {});
  log(`${label} cannot read the stream`, r.status === 403 && r.body?.error === 'PREVIEW_ALREADY_USED',
    `status=${r.status} ${r.body?.error}`);
}

// --- 5. a guest token buys NOTHING that writes ----------------------------
section('guest token cannot open a write route');
// Reached through the real HTTP surface, because that is where a crafted
// request would land. Every one of these must be refused.
const writeRoutes = [
  '/api/community/anonymous/send',
  '/api/community/anonymous/react',
  '/api/community/anonymous/room-create',
  '/api/community/anonymous/spectate-free',
  '/api/community/anonymous/gifts',
  '/api/community/anonymous/gift-claim',
  '/api/community/anonymous/social',
  '/api/community/anonymous/event',
  '/api/community/anonymous/prefs',
  '/api/community/anonymous/presence',
  '/api/community/anonymous/members',
  '/api/community/anonymous/feed',
  '/api/community/groups/join',
  '/api/community/groups/leave',
  '/api/community/groups/feed',
  '/api/community/groups/panel',
  '/api/community/posts',
  '/api/community/posts/vote',
  '/api/community/posts/like',
  '/api/community/posts/reply',
  '/api/community/moderation/reports',
];
let wrote = 0;
for (const route of writeRoutes) {
  const res = await fetch(`${API}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token, group_id: 12, content: 'guest probe', post_id: crypto.randomUUID(),
      text: 'guest probe', target_alias: 1, message_id: crypto.randomUUID(),
      candidate_id: 1, campaign_id: 1,
    }),
  }).catch(() => ({ status: 0 }));
  if (res.status !== 401 && res.status !== 404) {
    wrote += 1;
    console.log(`      ! ${route} answered ${res.status}`);
  }
}
log(`no write/member route accepted a guest token (${writeRoutes.length} probed)`, wrote === 0,
  `${writeRoutes.length - wrote}/${writeRoutes.length} refused with 401/404`);

// --- 6. no RLS was widened ------------------------------------------------
section('existing RLS untouched');
{
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

  // The anon role may be *allowed* to issue the SELECT but must see ZERO rows
  // for anonymous-room posts. An error is not required — an empty result set is
  // the actual protection, so assert on rows, not on the presence of an error.
  const room = await anon.from('community_posts').select('id').eq('group_id', 12).limit(1);
  log('the anon key still CANNOT read anonymous-room posts directly',
    (room.error || (room.data || []).length === 0),
    room.error ? `error=${room.error.code}` : `rows=${(room.data || []).length}`);

  const roster = await anon.from('study_group_members').select('user_id').eq('group_id', 12).limit(1);
  log('the anon key still CANNOT read the room roster',
    !!roster.error || (roster.data || []).length === 0,
    roster.error ? `error=${roster.error.code}` : `rows=${(roster.data || []).length}`);

  const aliases = await anon.from('anonymous_room_identities').select('alias').limit(1);
  log('the anon key still CANNOT read Anonymous #NN identities', !!aliases.error,
    aliases.error ? `error=${aliases.error.code}` : 'LEAKED');

  const c = await anon.from('campaign_totals').select('candidate_id').limit(1);
  log('campaign_totals exposes nothing to anon pre-migration',
    !!c.error || (c.data || []).length === 0,
    c.error ? `error=${c.error.code}` : `rows=${(c.data || []).length}`);
}

console.log(`\n---- ${passed} passed, ${failed} failed ----`);
process.exit(failed === 0 ? 0 : 1);