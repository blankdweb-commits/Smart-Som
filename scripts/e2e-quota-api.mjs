// API-level e2e for the v13 per-course quota system.
// Exercises api/quota.js's REAL handler (mock req/res) against the live DB:
//   - unauthenticated 401
//   - free consume: allowed, count clamped to 10, 1h cooldown, second consume refused
//   - separate-course isolation
//   - course-status map reflects both courses
//   - premium path via a synthetic subscription row: 10–30 count honored, no cooldown
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import handler from '../api/quota.js';

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const env = loadEnv();
Object.assign(process.env, { VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY });
// Service-role client is kept PURE (no GoTrue sign-in on it — a signed-in
// service client makes PostgREST authorize later writes as that user).
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const pub = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);
const stamp = Date.now().toString().slice(-8);
const email = `qapi${stamp}@apextest.local`;
const password = 'testpass123';
let userId = null;
let premiumRowId = null;

const mockRes = () => {
  const r = { statusCode: 200, bodySent: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (body) => { r.bodySent = body; return r; };
  return r;
};
const call = async (method, url, token, body) => {
  const req = {
    method,
    url,
    headers: { authorization: token ? `Bearer ${token}` : '' },
    body
  };
  const res = mockRes();
  try {
    await handler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.bodySent = { error: err.message };
  }
  return { status: res.statusCode, body: res.bodySent };
};

try {
  const { data: signup, error: suErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (suErr) throw suErr;
  userId = signup.user.id;
  const { data: agent, error: siErr } = await pub.auth.signInWithPassword({ email, password });
  if (siErr) throw siErr;
  const token = agent.session.access_token;
  log('test user + token ready', !!token, email);

  // 1. Unauthenticated → 401
  const unauth = await call('POST', '/api/quota/course-consume', null, { course_key: 'clinical-challenge:nclex', count: 10 });
  log('unauthenticated consume = 401', unauth.status === 401, `status=${unauth.status}`);

  // 2. GET course-status with token → 200 + empty map
  const fresh = await call('GET', '/api/quota/course-status', token);
  log('GET course-status 200', fresh.status === 200, `keys=${Object.keys(fresh.body?.subjects || {}).join(',') || '(none)'}`);

  // 3. Free consume: allowed, clamped to 10, 1h cooldown
  const c1 = await call('POST', '/api/quota/course-consume', token, { course_key: 'clinical-challenge:nclex', count: 25000 });
  log('free consume allowed', c1.status === 200 && c1.body.allowed === true, JSON.stringify(c1.body));
  log('free count clamped to 10 (round completed, nothing left)', c1.body.questions_remaining === 0 && c1.body.round_completed === true, `remaining=${c1.body.questions_remaining}`);
  log('1h cooldown returned', c1.body.cooldown_remaining_seconds >= 3595 && c1.body.is_ready === false, `cooldown=${c1.body.cooldown_remaining_seconds}s`);
  log('premium flag false on free path', c1.body.premium === false);

  // 4. Second consume on the same key while cooling down → REFUSED
  const c2 = await call('POST', '/api/quota/course-consume', token, { course_key: 'clinical-challenge:nclex', count: 10 });
  log('cooldown consume refused', c2.status === 200 && c2.body.allowed === false, JSON.stringify(c2.body));

  // 5. Different course key unaffected (per-course isolation, composite key)
  const c3 = await call('POST', '/api/quota/course-consume', token, { course_key: 'nursing-200:Pharmacology', count: 25 });
  log('separate course consume allowed (composite key)', c3.status === 200 && c3.body.allowed === true, JSON.stringify(c3.body));

  // 6. Status map reflects both courses
  const status = await call('GET', '/api/quota/course-status', token);
  const map = status.body?.subjects || {};
  log('status map has both courses', !!map['clinical-challenge:nclex'] && !!map['nursing-200:Pharmacology'], Object.keys(map).sort().join(', '));
  log('nclex course still cooling in map', map['clinical-challenge:nclex']?.is_ready === false);

  // 7. Premium: inject a synthetic subscription row (expires in future)
  const { data: prem, error: premErr } = await admin
    .from('subscriptions')
    .insert({ user_id: userId, expires_at: new Date(Date.now() + 86400000).toISOString(), status: 'active', plan: 'premium' })
    .select('id');
  if (premErr) throw new Error(`subscription insert: ${premErr.code} ${premErr.message}`);
  premiumRowId = prem?.[0]?.id;
  const c4 = await call('POST', '/api/quota/course-consume', token, { course_key: 'quick-quiz:both', count: 25 });
  log('premium consume 25 honored', c4.status === 200 && c4.body.premium === true && c4.body.allowed === true, JSON.stringify(c4.body));
  log('premium no cooldown (is_ready always true)', c4.body.is_ready === true && c4.body.cooldown_remaining_seconds === 0);
  const c5 = await call('POST', '/api/quota/course-consume', token, { course_key: 'quick-quiz:both', count: 30 });
  log('premium consume again allowed (no cooldown)', c5.body.allowed === true);

  // 8. Premium status map: no cooldown; the 25+30 counts actually landed
  const status2 = await call('GET', '/api/quota/course-status', token);
  const rowPremium = status2.body?.subjects?.['quick-quiz:both'];
  log('premium course is_ready true in map', rowPremium?.is_ready !== false);
  log('premium counts persisted (25 then 30)', rowPremium?.questions_used === 55, `used=${rowPremium?.questions_used}`);

  // 9. Cleanup: subscription + user
  if (premiumRowId) { const { error: de } = await admin.from('subscriptions').delete().eq('id', premiumRowId); if (de) console.log('cleanup sub err', de.message); }
  const delErr = (await admin.auth.admin.deleteUser(userId)).error;
  log('cleanup (subscription + user)', !delErr, email);
} catch (err) {
  console.error('FATAL', err.stack || err.message);
  if (premiumRowId) await admin.from('subscriptions').delete().eq('id', premiumRowId).catch(() => {});
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  process.exit(1);
}

const failed = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);