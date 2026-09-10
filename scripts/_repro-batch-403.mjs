import { createClient } from '@supabase/supabase-js';
import handler from '../api/quiz.js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
Object.assign(process.env, {
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
});

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const pub = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const stamp = Date.now().toString().slice(-8);
const email = `br403${stamp}@apextest.local`;
const password = 'testpass123';
let userId = null;

const mockRes = () => {
  const r = { statusCode: 200, bodySent: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.setHeader = () => {};
  r.end = () => {};
  r.json = (body) => { r.bodySent = body; return r; };
  return r;
};
const call = async (body) => {
  const req = { method: 'POST', url: '/api/quiz/batch-create', headers: { authorization: `Bearer ${token}` }, body };
  const res = mockRes();
  try { await handler(req, res); } catch (err) { res.statusCode = 500; res.bodySent = { error: err.message }; }
  return { status: res.statusCode, body: res.bodySent };
};

const { data: signup, error: suErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (suErr) throw suErr;
userId = signup.user.id;
const { data: agent } = await pub.auth.signInWithPassword({ email, password });
const token = agent.session.access_token;
console.log('fresh free user:', email, userId);

let failed = false;
const expect = (cond, label, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed = true;
};

const scenarios = [
  ['nursing-200:Pharmacology  Easy (1st — launches)', { mode: 'practice', courseKey: 'nursing-200:Pharmacology', batchSize: 10, difficultyDistribution: { Easy: 10 } }, 200, null],
  ['nursing-200:Pharmacology  Moderate (same round — cooldown)', { mode: 'practice', courseKey: 'nursing-200:Pharmacology', batchSize: 10, difficultyDistribution: { Moderate: 10 } }, 403, 'COOLDOWN_ACTIVE'],
  ['clinical-challenge:nclex  no diff (other course — allowed)', { mode: 'practice', courseKey: 'clinical-challenge:nclex', batchSize: 10 }, 200, null],
  ['quick-quiz:both  Easy (other course — allowed)', { mode: 'practice', courseKey: 'quick-quiz:both', batchSize: 10, difficultyDistribution: { Easy: 10 } }, 200, null],
  ['quick-quiz:nclex  no diff (cooldown — OTHER course key, allowed)', { mode: 'practice', courseKey: 'quick-quiz:nclex', batchSize: 10 }, 200, null],
  ['nursing-200:Pharmacology  Easy (replay during cooldown)', { mode: 'practice', courseKey: 'nursing-200:Pharmacology', batchSize: 10, difficultyDistribution: { Easy: 10 } }, 403, 'COOLDOWN_ACTIVE'],
];

for (const [label, body, wantStatus, wantCode] of scenarios) {
  const r = await call(body);
  const okStatus = r.status === wantStatus;
  const okCode = wantCode ? r.body?.error === wantCode : true;
  const okFields = wantCode ? r.body?.window_expires_at != null && typeof r.body?.cooldown_remaining_seconds === 'number' : true;
  console.log(`[${label}] -> ${r.status} ${JSON.stringify(r.body)}`);
  expect(okStatus, `${label} status ${wantStatus}`, `got ${r.status}`);
  expect(okCode, `${label} code ${wantCode || 'n/a'}`, `got ${r.body?.error}`);
  if (wantCode) {
    expect(okFields, `${label} cooldown fields present`, `cd=${r.body?.cooldown_remaining_seconds} window=${r.body?.window_expires_at}`);
  }
}

// Invalid course must 400 (server validates; nothing is served).
const invalid = await call({ mode: 'practice', courseKey: 'nursing-999:NotARealSubject', batchSize: 10 });
console.log(`[invalid course] -> ${invalid.status} ${JSON.stringify(invalid.body)}`);
expect(invalid.status === 400 && invalid.body?.error === 'UNKNOWN_COURSE', 'invalid course 400 UNKNOWN_COURSE', `got ${invalid.status} ${invalid.body?.error}`);

// Cleanup
if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
console.log('cleanup done');
if (failed) process.exit(1);