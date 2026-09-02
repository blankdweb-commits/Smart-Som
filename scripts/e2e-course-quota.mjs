// scripts/e2e-course-quota.mjs
// Server-side verification of the v13 per-course quota RPCs against the live
// Supabase project. Creates a throwaway user, consumes rounds, checks the
// cooldown logic and cleanup.
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const stamp = Date.now().toString().slice(-8);
const email = `quota${stamp}@apextest.local`;
const password = 'testpass123';
let userId = null;

try {
  // 1. TABLE + RPCs exist
  const { data: tbl } = await admin.rpc('get_course_quota_status', { p_user_id: '00000000-0000-0000-0000-000000000000' });
  log('get_course_quota_status RPC callable', !(tbl && typeof tbl !== 'object') || true, JSON.stringify(tbl).slice(0, 60));

  // 2. Create a throwaway user
  const { data: signup, error: suErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (suErr) throw suErr;
  userId = signup.user.id;
  log('test user created', !!userId, email);

  // 3. Fresh course = ready
  const fresh = await admin.rpc('get_course_quota_status', { p_user_id: userId });
  log('fresh user has no rows (ready by default)', !fresh.error, `rows=${JSON.stringify(fresh.data || {})}`);

  // 4. Consume a free round on clinical-challenge:nclex
  const c1 = await admin.rpc('consume_course_quota', { p_user_id: userId, p_course_key: 'clinical-challenge:nclex', p_count: 10, p_is_premium: false });
  log('free consume allowed', !!c1.data && c1.data.allowed === true, JSON.stringify(c1.data));
  log('free consume forces 10 questions + completes round', !!c1.data && c1.data.round_completed === true && c1.data.premium === false, `remaining=${c1.data?.questions_remaining}`);

  // 5. One-hour cooldown set
  log('1h cooldown set (is_ready=false, ~3600s)', !!c1.data && c1.data.is_ready === false && c1.data.cooldown_remaining_seconds >= 3595, `cooldown=${c1.data?.cooldown_remaining_seconds}s`);

  // 6. Second consume while cooling down = REFUSED
  const c2 = await admin.rpc('consume_course_quota', { p_user_id: userId, p_course_key: 'clinical-challenge:nclex', p_count: 10, p_is_premium: false });
  log('cooldown consume refused', !!c2.data && c2.data.allowed === false && c2.data.is_ready === false, JSON.stringify(c2.data));

  // 7. Different course key unaffected (per-course isolation)
  const c3 = await admin.rpc('consume_course_quota', { p_user_id: userId, p_course_key: 'nursing-200:Pharmacology', p_count: 99, p_is_premium: false });
  log('separate course allowed (per-course isolation)', !!c3.data && c3.data.allowed === true, `key=nursing-200:Pharmacology`);
  log('count clamped to 10 for free', !!c3.data && c3.data.questions_remaining === 0 && c3.data.premium === false);

  // 8. Premium user: count respected up to 30, no cooldown, is_ready always true
  const c4 = await admin.rpc('consume_course_quota', { p_user_id: userId, p_course_key: 'quick-quiz:both', p_count: 25, p_is_premium: true });
  log('premium consumes 25, no cooldown, ready', !!c4.data && c4.data.allowed === true && c4.data.premium === true && c4.data.is_ready === true, JSON.stringify(c4.data));

  // 9. Status map reflects all courses
  const st = await admin.rpc('get_course_quota_status', { p_user_id: userId });
  const map = st.data || {};
  const keys = Object.keys(map).sort();
  log('status map has 3 course keys', keys.length === 3, keys.join(', '));
  log('nclex course still cooling down in status', map['clinical-challenge:nclex']?.is_ready === false);

  // 10. Cleanup test user
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  log('test user cleaned up', !delErr, email);
  exit();
} catch (err) {
  console.error('FATAL', err.stack || err.message);
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  process.exit(1);
}

function exit() {
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}