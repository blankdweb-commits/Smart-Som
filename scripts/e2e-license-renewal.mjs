// scripts/e2e-license-renewal.mjs
//
// Live verification of the Nursing License Renewal flow (milestone S8) against
// the real project. Drives the SAME server handlers api/quiz.js dispatches to
// (handleLicenseStatus/Start/Submit + handleAnswer) with real GoTrue tokens, and
// probes the DB + RLS with the service role and publishable clients.
//
// Contract proven:
//   1.  the first license is auto-issued FREE (12-month validity, renewed_count 0)
//   2.  status shape: valid / days_remaining / reminder / attempts / config
//   3.  start charges the fee EXACTLY once (100 SC) via _sc_apply, and the exam
//       returns server-selected questions with NO correct_answer/rationale leak
//   4.  replaying start with the same attemptId does NOT double-charge
//   5.  submit scores ONLY from the persisted, server-graded rows (0 answered ->
//       0/total, passed false) — a client cannot fabricate a pass
//   6.  a FAILED attempt opens a 24h retry cooldown (429 RETRY_COOLDOWN)
//   7.  a PASS renews the license (+1 renewed_count, extended expiry) and is
//       idempotent on replay
//   8.  license exams do NOT credit player_score (no quiz_results row)
//   9.  RLS: clients read only their OWN license/attempts and cannot write
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_SERVICE_ROLE_KEY in .env). Run:
//   npm run e2e:license-renewal
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import { handleLicenseStatus, handleLicenseStart, handleLicenseSubmit } from '../api/_license.js';
import { handleAnswer } from '../api/_quiz-batches.js';

const env = loadEnv();
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// Pure service-role client (never signs in — keeps PostgREST writes RLS-clean).
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const uuid = () => crypto.randomUUID();
const password = 'testpass123';

// Minimal req/res harness matching the handler contract.
const call = async (fn, user, { method = 'POST', body = {}, url = '/api/license/test' } = {}) => {
  const out = { status: 200, body: null };
  const req = { body, url, method, headers: { authorization: `Bearer ${user.token}` }, query: {} };
  const res = {
    _status: 200,
    status(code) { this._status = code; return this; },
    json(payload) { out.status = this._status; out.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  await fn(req, res);
  return out;
};

async function makeUser(tag) {
  const email = `lic-${tag}-${Date.now().toString().slice(-7)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const id = data.user.id;
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  // Seed a known SC balance through the canonical ledger mutator.
  const { error: scErr } = await admin.rpc('_sc_apply', {
    p_user_id: id,
    p_amount: 500,
    p_reason: 'e2e_license_seed',
    p_source: 'e2e',
    p_transaction_type: 'earn',
    p_ref_type: 'e2e',
    p_ref_id: uuid(),
    p_metadata: { e2e: true },
    p_client_request_id: uuid(),
  });
  if (scErr) throw new Error(`seed SC ${tag}: ${scErr.message}`);
  return { id, email, token: s.session.access_token, pub };
}

const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return data?.smart_coins ?? null;
};

let users = [];

try {
  // ------------------------------------------------------------------
  // 1. Auto-issue + status shape
  // ------------------------------------------------------------------
  const a = await makeUser('a');
  users.push(a);
  const bal0 = await balanceOf(a.id);
  log('seeded SC balance (500)', bal0 === 500, `balance=${bal0}`);

  const status1 = await call(handleLicenseStatus, a, { method: 'GET' });
  log('status 200', status1.status === 200, `status=${status1.status}`);
  const lic1 = status1.body?.license;
  log('first license auto-issued as valid', lic1?.status === 'valid', `status=${lic1?.status}`);
  log('renewed_count starts at 0', lic1?.renewed_count === 0, `renewed=${lic1?.renewed_count}`);
  const days = lic1?.days_remaining;
  log('validity ~12 months (360..366 days)', Number.isFinite(days) && days >= 360 && days <= 366, `days=${days}`);
  log('status exposes exam config', Number(status1.body?.config?.fee_sc) === 100 && Number(status1.body?.config?.question_count) === 50, JSON.stringify(status1.body?.config));

  const { data: licRow } = await admin.from('nursing_licenses').select('status, issued_at, expires_at, renewed_count').eq('user_id', a.id).maybeSingle();
  log('nursing_licenses row persisted', licRow?.status === 'valid' && licRow?.renewed_count === 0, JSON.stringify(licRow));

  // ------------------------------------------------------------------
  // 2. Start charges once + no answer leak
  // ------------------------------------------------------------------
  const attemptId = uuid();
  const start1 = await call(handleLicenseStart, a, { body: { attemptId } });
  log('start 200', start1.status === 200, `status=${start1.status} ${start1.body?.error || ''}`);
  const b1 = start1.body || {};
  log('start returns a batch id', !!b1.batch_id, `batch=${b1.batch_id}`);
  log('start returns configured question count', Array.isArray(b1.questions) && b1.questions.length === 50, `n=${b1.questions?.length}`);
  const leakKeys = ['correct_answer', 'answer', 'correct', 'rationale', 'explanation', 'hint'];
  const leaked = (b1.questions || []).some((q) => leakKeys.some((k) => k in q));
  log('questions carry NO answer/rationale fields', !leaked);
  const balAfterStart = await balanceOf(a.id);
  log('fee charged exactly once (-100)', balAfterStart === 400, `balance=${balAfterStart}`);

  // ------------------------------------------------------------------
  // 3. Replay start (same attemptId) must NOT double-charge
  // ------------------------------------------------------------------
  const startReplay = await call(handleLicenseStart, a, { body: { attemptId } });
  log('replayed start 200', startReplay.status === 200, `status=${startReplay.status}`);
  const balAfterReplay = await balanceOf(a.id);
  log('replay did NOT double-charge', balAfterReplay === 400, `balance=${balAfterReplay}`);

  // ------------------------------------------------------------------
  // 4. Submit scores from persisted rows only (0 answered -> fail)
  // ------------------------------------------------------------------
  const submitFail = await call(handleLicenseSubmit, a, { body: { batchId: b1.batch_id } });
  log('submit 200', submitFail.status === 200, `status=${submitFail.status}`);
  const r1 = submitFail.body || {};
  log('server-computed score 0/0 -> not passed', r1.score === 0 && r1.total === 0 && r1.passed === false, `score=${r1.score}/${r1.total} passed=${r1.passed}`);

  // ------------------------------------------------------------------
  // 5. A failed attempt opens the retry cooldown
  // ------------------------------------------------------------------
  const startCooldown = await call(handleLicenseStart, a, { body: { attemptId: uuid() } });
  log('failed attempt opens 24h cooldown (429)', startCooldown.status === 429 && startCooldown.body?.error === 'RETRY_COOLDOWN', `status=${startCooldown.status} ${startCooldown.body?.error || ''}`);
  log('cooldown remaining reported', Number(startCooldown.body?.cooldown_remaining_ms) > 0, `ms=${startCooldown.body?.cooldown_remaining_ms}`);

  // Attempt history records the failure.
  const { data: attempts } = await admin.from('license_renewal_attempts').select('id, passed, score, total').eq('user_id', a.id);
  log('failed attempt recorded in history', (attempts || []).length === 1 && attempts[0].passed === false, JSON.stringify(attempts));

  // ------------------------------------------------------------------
  // 6. Pass path (fresh user): answer all correctly -> pass + renew
  // ------------------------------------------------------------------
  const b = await makeUser('b');
  users.push(b);
  const start2 = await call(handleLicenseStart, b, { body: { attemptId: uuid() } });
  const batchB = start2.body?.batch_id;
  log('user B start 200', start2.status === 200 && !!batchB, `status=${start2.status}`);
  const questionsB = start2.body?.questions || [];

  // Fetch the canonical answers (service role) and submit them all.
  const qIds = questionsB.map((q) => q.id);
  const { data: qRows } = await admin.from('questions').select('id, correct_answer').in('id', qIds);
  const answerById = new Map((qRows || []).map((q) => [q.id, q.correct_answer]));
  let answerPasses = 0;
  for (const q of questionsB) {
    const res = await call(handleAnswer, b, { body: { batchId: batchB, questionId: q.id, selectedAnswer: answerById.get(q.id) } });
    if (res.status === 200 && res.body?.success) answerPasses += 1;
  }
  log('all answers recorded server-side', answerPasses === questionsB.length, `recorded=${answerPasses}/${questionsB.length}`);

  const { data: licB0 } = await admin.from('nursing_licenses').select('expires_at, renewed_count').eq('user_id', b.id).maybeSingle();
  const submitPass = await call(handleLicenseSubmit, b, { body: { batchId: batchB } });
  const r2 = submitPass.body || {};
  log('submit 200 (pass)', submitPass.status === 200, `status=${submitPass.status}`);
  log('score == total == 50 and passed', r2.score === 50 && r2.total === 50 && r2.passed === true, `score=${r2.score}/${r2.total} passed=${r2.passed}`);
  log('license renewed (+1 renewed_count)', r2.license?.renewed_count === 1, `renewed=${r2.license?.renewed_count}`);
  const { data: licB1 } = await admin.from('nursing_licenses').select('expires_at, renewed_count').eq('user_id', b.id).maybeSingle();
  log('expiry extended on pass', Date.parse(licB1?.expires_at) > Date.parse(licB0?.expires_at), `${licB0?.expires_at} -> ${licB1?.expires_at}`);

  // Idempotent submit replay: renewed_count must not bump again.
  const submitReplay = await call(handleLicenseSubmit, b, { body: { batchId: batchB } });
  log('submit replay flagged', submitReplay.body?.replay === true, `replay=${submitReplay.body?.replay}`);
  const { data: licB2 } = await admin.from('nursing_licenses').select('renewed_count').eq('user_id', b.id).maybeSingle();
  log('replay did NOT renew again', licB2?.renewed_count === 1, `renewed=${licB2?.renewed_count}`);

  // ------------------------------------------------------------------
  // 7. License exams do NOT credit player_score
  // ------------------------------------------------------------------
  const { data: qr } = await admin.from('quiz_results').select('id').eq('batch_id', batchB);
  log('no quiz_results row for license exam', (qr || []).length === 0, `rows=${(qr || []).length}`);

  // ------------------------------------------------------------------
  // 8. RLS: read-own only, no client writes
  // ------------------------------------------------------------------
  const { data: seenByA } = await a.pub.from('nursing_licenses').select('user_id');
  log('RLS: A sees only own license', (seenByA || []).length === 1 && seenByA[0].user_id === a.id, `n=${(seenByA || []).length}`);
  const { data: seenByB } = await b.pub.from('nursing_licenses').select('user_id');
  log('RLS: B sees only own license', (seenByB || []).length === 1 && seenByB[0].user_id === b.id, `n=${(seenByB || []).length}`);
  const { error: writeErr } = await a.pub.from('nursing_licenses').insert({ user_id: a.id, status: 'valid' });
  log('RLS: client cannot insert a license', !!writeErr, writeErr ? writeErr.code || 'denied' : 'ALLOWED (bad)');

  const { data: attA } = await a.pub.from('license_renewal_attempts').select('user_id');
  log('RLS: A sees only own attempts', (attA || []).every((r) => r.user_id === a.id), `n=${(attA || []).length}`);

} catch (err) {
  log('FATAL', false, err?.message || String(err));
} finally {
  // Cleanup: remove test users (cascades licenses/attempts) + any batch rows.
  for (const u of users) {
    try {
      const { data: batches } = await admin.from('quiz_batches').select('id').eq('user_id', u.id);
      for (const bt of batches || []) {
        await admin.from('quiz_batch_questions').delete().eq('batch_id', bt.id);
      }
    } catch { /* noop */ }
    try { await admin.from('quiz_batches').delete().eq('user_id', u.id); } catch { /* noop */ }
    try { await admin.from('user_question_history').delete().eq('user_id', u.id); } catch { /* noop */ }
    // FK on delete cascade also removes nursing_licenses + license_renewal_attempts.
    try { await admin.auth.admin.deleteUser(u.id); } catch { /* noop */ }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}
