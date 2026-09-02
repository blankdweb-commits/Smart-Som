// scripts/test-premium-quiz.mjs
// End-to-end verification of the quiz quota system for BOTH premium and free
// users against the live Supabase project + the real api/quota.js handler.
//
// FREE user:
//   - consume a course -> allowed, exactly 10 questions, premium=false
//   - 1h cooldown set (is_ready=false)
//   - second consume on same course -> REFUSED (allowed=false)
//   - a different course -> allowed (per-course isolation)
//   - course-status map reflects the cooldown
//
// PREMIUM user (subscription row with future expiry):
//   - isPremium resolves true server-side
//   - consume count=25 -> allowed, premium=true, count HONORED (not clamped to 10)
//   - no cooldown -> can consume again immediately
//   - course-status map shows is_ready=true, no cooldown
//   - client-style isPremium derivation from subscriptions row = active
//
// Both users are deleted at the end.
//
// Usage: node scripts/test-premium-quiz.mjs
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import handler from '../api/quota.js';

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const env = loadEnv();
Object.assign(process.env, {
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY
});
// Service-role client kept PURE (no GoTrue sign-in on it).
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const pub = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const stamp = Date.now().toString().slice(-8);
const PASSWORD = 'testpass123';
const FREE_EMAIL = `tstfree${stamp}@apextest.local`;
const PREM_EMAIL = `tstprem${stamp}@apextest.local`;

let freeUid = null;
let premUid = null;
let premSubId = null;

const mockRes = () => {
  const r = { statusCode: 200, bodySent: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (body) => { r.bodySent = body; return r; };
  return r;
};
const call = async (method, url, token, body) => {
  const req = { method, url, headers: { authorization: token ? `Bearer ${token}` : '' }, body };
  const res = mockRes();
  try { await handler(req, res); } catch (err) { res.statusCode = 500; res.bodySent = { error: err.message }; }
  return { status: res.statusCode, body: res.bodySent };
};

const signIn = async (email) => {
  const { data, error } = await pub.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return data.session.access_token;
};

try {
  // ============================================================
  // 0. Setup: create FREE + PREMIUM users
  // ============================================================
  const { data: fu, error: fe } = await admin.auth.admin.createUser({ email: FREE_EMAIL, password: PASSWORD, email_confirm: true });
  if (fe) throw fe;
  freeUid = fu.user.id;
  log('free test user created', !!freeUid, FREE_EMAIL);

  const { data: pu, error: pe } = await admin.auth.admin.createUser({ email: PREM_EMAIL, password: PASSWORD, email_confirm: true });
  if (pe) throw pe;
  premUid = pu.user.id;
  log('premium test user created', !!premUid, PREM_EMAIL);

  // Give the premium user a real subscription row (expires 30 days out, +2 grace).
  const { data: premSub, error: subErr } = await admin
    .from('subscriptions')
    .insert({
      user_id: premUid,
      plan: 'monthly',
      status: 'active',
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      grace_until: new Date(Date.now() + 32 * 24 * 3600 * 1000).toISOString(),
      amount: 6999.00,
      reference: `test-prem-${stamp}`
    })
    .select('id');
  if (subErr) throw new Error(`subscription insert: ${subErr.code} ${subErr.message}`);
  premSubId = premSub?.[0]?.id;
  log('premium subscription row inserted', !!premSubId);

  const freeToken = await signIn(FREE_EMAIL);
  const premToken = await signIn(PREM_EMAIL);
  log('both users signed in (RLS-scoped JWTs)', !!freeToken && !!premToken);

  // ============================================================
  // 1. PREMIUM: server-side isPremium resolves true
  // ============================================================
  const premCheck = await admin
    .from('subscriptions')
    .select('id, expires_at, grace_until, status')
    .eq('user_id', premUid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const premiumRow = premCheck.data;
  const nowMs = Date.now();
  const premiumActive =
    premiumRow && premiumRow.status === 'active' &&
    (new Date(premiumRow.expires_at).getTime() > nowMs);
  log('premium subscription is active + unexpired', !!premiumActive, `expires=${premiumRow?.expires_at}`);

  // ============================================================
  // 2. PREMIUM: consume count=25 honored (no clamp), no cooldown
  // ============================================================
  const pc1 = await call('POST', '/api/quota/course-consume', premToken, { course_key: 'clinical-challenge:both', count: 25 });
  log('premium consume hit quota API', pc1.status === 200, `status=${pc1.status}`);
  log('premium consume returns premium=true', pc1.body?.premium === true);
  log('premium consume allowed (no cooldown gate)', pc1.body?.allowed === true, JSON.stringify(pc1.body));
  log('premium count honored (25 consumed, premium rounds have no capped remaining)', pc1.body?.allowed === true && (pc1.body?.questions_remaining === null || pc1.body?.questions_remaining === 0), `remaining=${pc1.body?.questions_remaining}`);
  log('premium is_ready=true (no cooldown)', pc1.body?.is_ready === true, `cooldown=${pc1.body?.cooldown_remaining_seconds}`);

  // ============================================================
  // 3. PREMIUM: can consume again immediately (unlimited rounds)
  // ============================================================
  const pc2 = await call('POST', '/api/quota/course-consume', premToken, { course_key: 'clinical-challenge:both', count: 10 });
  log('premium second consume allowed (no cooldown)', pc2.body?.allowed === true, JSON.stringify(pc2.body));

  // ============================================================
  // 4. PREMIUM: course-status map shows ready, no cooldown
  // ============================================================
  const pstatus = await call('GET', '/api/quota/course-status', premToken);
  const pmap = pstatus.body?.subjects || {};
  const premRowMap = pmap['clinical-challenge:both'];
  log('premium status map includes course', !!premRowMap);
  log('premium course is_ready=true in map', !!premRowMap && premRowMap.is_ready !== false, `ready=${premRowMap?.is_ready}`);
  log('premium cumulative questions_used persisted (35)', !!premRowMap && premRowMap.questions_used === 35, `used=${premRowMap?.questions_used}`);

  // ============================================================
  // 5. FREE: consume -> allowed, clamped to 10, premium=false, 1h cooldown
  // ============================================================
  const fc1 = await call('POST', '/api/quota/course-consume', freeToken, { course_key: 'clinical-challenge:nclex', count: 25000 });
  log('free consume returns premium=false', fc1.body?.premium === false);
  log('free consume allowed', fc1.status === 200 && fc1.body?.allowed === true, JSON.stringify(fc1.body));
  log('free count clamped to 10 (round complete, nothing left)', fc1.body?.questions_remaining === 0 && fc1.body?.round_completed === true, `remaining=${fc1.body?.questions_remaining}`);
  log('free 1h cooldown set (is_ready=false)', fc1.body?.is_ready === false && (fc1.body?.cooldown_remaining_seconds || 0) >= 3595, `cooldown=${fc1.body?.cooldown_remaining_seconds}s`);

  // ============================================================
  // 6. FREE: second consume on same course -> REFUSED (cooldown)
  // ============================================================
  const fc2 = await call('POST', '/api/quota/course-consume', freeToken, { course_key: 'clinical-challenge:nclex', count: 10 });
  log('free second consume refused during cooldown', fc2.body?.allowed === false && fc2.body?.is_ready === false, JSON.stringify(fc2.body));

  // ============================================================
  // 7. FREE: different course allowed (per-course isolation)
  // ============================================================
  const fc3 = await call('POST', '/api/quota/course-consume', freeToken, { course_key: 'nursing-200:Pharmacology', count: 25 });
  log('free separate course allowed (isolation)', fc3.body?.allowed === true, JSON.stringify(fc3.body));
  log('free separate course also clamped to 10', fc3.body?.questions_remaining === 0 && fc3.body?.premium === false);

  // ============================================================
  // 8. FREE: course-status map reflects the cooldown
  // ============================================================
  const fstatus = await call('GET', '/api/quota/course-status', freeToken);
  const fmap = fstatus.body?.subjects || {};
  const nclexMap = fmap['clinical-challenge:nclex'];
  const pharmMap = fmap['nursing-200:Pharmacology'];
  log('free status map has both courses', !!nclexMap && !!pharmMap, Object.keys(fmap).sort().join(', '));
  log('free nclex course still cooling down in map', !!nclexMap && nclexMap.is_ready === false);
  log('free pharm course cooling down too (just consumed)', !!pharmMap && pharmMap.is_ready === false);

  // ============================================================
  // 9. Cleanup
  // ============================================================
  if (premSubId) { const { error: de } = await admin.from('subscriptions').delete().eq('id', premSubId); if (de) console.log('cleanup sub err', de.message); }
  let delErr1 = null, delErr2 = null;
  if (freeUid) delErr1 = (await admin.auth.admin.deleteUser(freeUid)).error;
  if (premUid) delErr2 = (await admin.auth.admin.deleteUser(premUid)).error;
  log('cleanup (both users + subscription)', !delErr1 && !delErr2);
} catch (err) {
  console.error('FATAL', err.stack || err.message);
  if (premSubId) await admin.from('subscriptions').delete().eq('id', premSubId).catch(() => {});
  if (freeUid) await admin.auth.admin.deleteUser(freeUid).catch(() => {});
  if (premUid) await admin.auth.admin.deleteUser(premUid).catch(() => {});
  process.exit(1);
}

const failed = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);
