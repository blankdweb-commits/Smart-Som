import { createClient } from '@supabase/supabase-js';
import handler from '../api/quiz/batch-create.js';
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

const scenarios = [
  ['nursing-200:Pharmacology  Easy', { mode: 'practice', courseKey: 'nursing-200:Pharmacology', batchSize: 10, difficultyDistribution: { Easy: 10 } }],
  ['nursing-200:Pharmacology  Moderate', { mode: 'practice', courseKey: 'nursing-200:Pharmacology', batchSize: 10, difficultyDistribution: { Moderate: 10 } }],
  ['clinical-challenge:nclex  no diff', { mode: 'practice', courseKey: 'clinical-challenge:nclex', batchSize: 10 }],
  ['quick-quiz:both  Easy', { mode: 'practice', courseKey: 'quick-quiz:both', batchSize: 10, difficultyDistribution: { Easy: 10 } }],
  ['quick-quiz:nclex  no diff', { mode: 'practice', courseKey: 'quick-quiz:nclex', batchSize: 10 }],
  ['nursing-300:Pharmacology  Easy', { mode: 'practice', courseKey: 'nursing-300:Pharmacology', batchSize: 10, difficultyDistribution: { Easy: 10 } }],
];

for (const [label, body] of scenarios) {
  const r = await call(body);
  console.log(`[${label}] -> ${r.status} ${JSON.stringify(r.body)}`);
}

// Cleanup
if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
console.log('cleanup done');