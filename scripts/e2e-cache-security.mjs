// scripts/e2e-cache-security.mjs
//
// Caching-layer verification for the Vercel redeployment checklist:
//
//   PART A — Pure unit tests of src/utils/cache.js (runs OFFLINE; no dev server,
//            no Supabase). Proves TTL expiry, cache-first reads, stale-while-
//            revalidate, in-flight dedupe, and invalidation semantics.
//
//   PART B — Static security invariants (quota/difficulty/payment/community
//            content must never be TTL-cached; only public metadata may be).
//
// Run: node scripts/e2e-cache-security.mjs   (exit 0 = all green)
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const cache = await import(pathToFileURL(resolve(ROOT, 'src/utils/cache.js')).href);

let passed = 0;
let failed = 0;
const check = (label, cond, detail) => {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// PART A — cache unit semantics
// ---------------------------------------------------------------------------
console.log('\n[PART A] cache module semantics\n');

cache.cacheClearAll();

// A1. basic set/get
cache.cacheSet('a:key', { x: 1 }, 60_000);
check('set/get round-trips a value', cache.cacheGet('a:key')?.x === 1);

// A2. TTL expiry (short ttl)
cache.cacheSet('a:expiring', 'v', 20);
await sleep(30);
check('value expires after its TTL', cache.cacheGet('a:expiring') === undefined);

// A3. null/undefined values are never stored
cache.cacheSet('a:null', null, 60_000);
cache.cacheSet('a:undef', undefined, 60_000);
check('null/undefined are not cached', cache.cacheGet('a:null') === undefined && cache.cacheGet('a:undef') === undefined);

// A4. cacheFirst: miss fetches + stores; second read is served from cache
let fetchCount = 0;
const fetcher = async () => { fetchCount++; return { n: fetchCount }; };
await cache.getCacheFirst('a:cf', fetcher, { ttlMs: 300 });
await cache.getCacheFirst('a:cf', fetcher, { ttlMs: 300 });
check('cache-first serves second read from cache (1 fetch total)', fetchCount === 1 && cache.cacheGet('a:cf')?.n === 1);

// A5. cacheFirst: failed fetcher falls back to stale cache instead of throwing
cache.cacheSet('a:stale', { keep: true }, 60_000);
const boom = async () => { throw new Error('upstream down'); };
const staleResult = await cache.getCacheFirst('a:stale', boom, { ttlMs: 300 });
check('failed refresh falls back to the cached value', staleResult?.keep === true);

// A6. dedupe: N concurrent callers share ONE network promise
let dedupeCalls = 0;
const slowFetcher = async () => { dedupeCalls++; await sleep(30); return { done: true }; };
const [r1, r2, r3] = await Promise.all([
  cache.dedupe('d:shared', slowFetcher),
  cache.dedupe('d:shared', slowFetcher),
  cache.dedupe('d:shared', slowFetcher),
]);
check('dedupe coalesces concurrent callers into one in-flight request', dedupeCalls === 1 && r1.done && r2.done && r3.done);

// A7. dedupe releases after settle (a LATER call re-runs the fetcher)
dedupeCalls = 0;
await cache.dedupe('d:again', slowFetcher);
await cache.dedupe('d:again', slowFetcher);
check('dedupe does not persist results past the in-flight window', dedupeCalls === 2);

// A8. clear-by-prefix only removes matching keys
cache.cacheSet('prefix:x', 1, 60_000);
cache.cacheSet('prefix:y', 2, 60_000);
cache.cacheSet('other:z', 3, 60_000);
cache.cacheClear('prefix:');
check('clear(prefix) removes only matching keys', cache.cacheGet('prefix:x') === undefined && cache.cacheGet('prefix:y') === undefined && cache.cacheGet('other:z') === 3);

// A9. clearAll wipes everything
cache.cacheClearAll();
check('clearAll empties the store', cache.cacheGet('other:z') === undefined);

// A10. stale-while-revalidate: a within-TTL read returns instantly and a
//      background refresh refills the entry without blocking the caller
cache.cacheClearAll();
let swrFetches = 0;
const swrFetcher = async () => { swrFetches++; return { stamped: `v${swrFetches}` }; };
await cache.getCacheFirst('a:swr', swrFetcher, { ttlMs: 10000, staleWhileRevalidate: true });
const swrCountBefore = swrFetches;
const hit = await cache.getCacheFirst('a:swr', swrFetcher, { ttlMs: 10000, staleWhileRevalidate: true });
check('SWR serves the cached value on a within-TTL read', hit?.stamped === 'v1');
await sleep(40);
check('SWR kicked off exactly one background refresh', swrFetches === swrCountBefore + 1);

// A11. sensitive TTL keys must be absent from the module
const cacheSrc = readFileSync(resolve(ROOT, 'src/utils/cache.js'), 'utf8');

// ---------------------------------------------------------------------------
// PART B — static security invariants
// ---------------------------------------------------------------------------
console.log('\n[PART B] security invariants\n');

const neverCached = ['quota', 'difficulty', 'payment', 'cooldown', 'session', 'membership', 'spectator', 'feed', 'lives_until'];
const bad = neverCached.filter((k) => cacheSrc.toLowerCase().includes(`${k}:`) || cacheSrc.includes(`'${k}:`));
check('cache.js TTL keys never cover security-sensitive read paths', bad.length === 0, bad.join(', '));

// B2. cache.js must not persist to any browser/web storage
check('cache.js is in-memory only', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(cacheSrc));

// B3. AppContext only TTL-caches the public subscription-plans catalog
const app = readFileSync(resolve(ROOT, 'src/context/AppContext.jsx'), 'utf8');
check('subscription_plans reads cache-first via static:subscription-plans', app.includes("getCacheFirst('static:subscription-plans'"));
const quotaSlice = app.slice(app.indexOf('fetchCourseQuotaStatus'), app.indexOf('fetchDifficultyStatus'));
check('quota status never enters the TTL cache', !/getCacheFirst/.test(quotaSlice));
const diffSlice = app.slice(app.indexOf('fetchDifficultyStatus'), app.indexOf('recordAnsweredBatch'));
check('difficulty status never enters the TTL cache', !/getCacheFirst/.test(diffSlice));

// B4. Community feed is never TTL-cached (dedupe only)
const com = readFileSync(resolve(ROOT, 'src/pages/Community.jsx'), 'utf8');
check('community feed deduped, never TTL-cached', /dedupe\('community:feed:p0'/.test(com) && !/getCacheFirst\('community/.test(com));

// B5. Flashcards stay disabled AND out of the cache path
const lib = readFileSync(resolve(ROOT, 'src/components/FlashcardLibrary.jsx'), 'utf8');
check('flashcards remain HIGHLY CLASSIFIED gated with no cache involvement', /HIGHLY CLASSIFIED/.test(lib) && !/cache|dedupe|getCacheFirst/.test(lib));

// B6. logout invalidates every cached entry
check('cacheClearAll on sign-out', app.includes('cacheClearAll()'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);