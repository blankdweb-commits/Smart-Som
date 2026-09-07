// scripts/_free-quota-api-run.mjs — TEMP orchestration (delete after use)
// Starts API (3001) + Vite (5173), creates a FRESH FREE account through the
// real signup UI, then tests the FREE-PLAN QUOTA purely at the API layer:
//   GET  /api/quota/course-status   → empty map for a brand-new user
//   POST /api/quota/course-consume  → allowed (free: 10 qs, 1h cooldown, premium
//                                     resolved server-side = false)
//   POST /api/quota/course-consume  → second consume blocked by cooldown
//   GET  /api/quota/course-status   → reflects the reserved round (is_ready false)
//   Session/single-device gating (X-Session-Id) is verified too while we're at it.
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { createBrowser, loadEnv } from './e2e-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API_PORT = 3001;
const WEB_PORT = 5173;
const BASE = `http://localhost:${WEB_PORT}`;
const API = `http://localhost:${API_PORT}`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function httpGet(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

async function waitReady(url, timeoutMs = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const { status } = await httpGet(url); if (status > 0) return true; } catch {}
    await wait(600);
  }
  return false;
}

async function apiCall(method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

const children = [];
const spawnLog = (name) => (data) => {
  const s = String(data);
  if (/error|listen|3001|5173|ready|Local:|started|failed/i.test(s)) process.stdout.write(`[${name}] ${s}`);
};
const api = spawn('node', ['scripts/serve-api.mjs'], { cwd: ROOT, stdio: 'pipe' });
api.stdout.on('data', spawnLog('api')); api.stderr.on('data', spawnLog('api')); children.push(api);
const vite = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: ROOT, stdio: 'pipe' });
vite.stdout.on('data', spawnLog('vite')); vite.stderr.on('data', spawnLog('vite')); children.push(vite);

const apiReady = await waitReady(`${API}/`);
const webReady = await waitReady(`${BASE}/`);
console.log(`\nAPI ready: ${apiReady} | Web ready: ${webReady}`);
if (!apiReady || !webReady) {
  for (const c of children) try { c.kill(); } catch {}
  process.exit(1);
}

const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const browser = await createBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

const waitBody = async (re, timeout = 25000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    if (typeof re === 'string' ? body.includes(re) : re.test(body)) return true;
    await page.waitForTimeout(400);
  }
  return false;
};
const btn = (t) => page.locator('button', { hasText: t }).first();

const stamp = Date.now().toString().slice(-9);
const EMAIL = `apiquota${stamp}@apextest.local`;
const PASS = 'quota api test 123';

let userId = null;
let token = null;
try {
  // ---------- 1. Run the app + create a FRESH FREE account via the real UI ----------
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  await page.waitForSelector('input[placeholder="Email Address"]', { timeout: 90000 });
  await page.fill('input[placeholder="Full Name"]', 'API Quota Tester');
  await page.fill('input[placeholder="Email Address"]', EMAIL);
  await page.fill('input[placeholder="Password"]', PASS);
  await page.fill('input[placeholder="Confirm Password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  if (page.url().includes('/signup') && /account created/i.test((await page.textContent('body').catch(() => '')) || '')) {
    await page.fill('input[placeholder="Email Address"]', EMAIL);
    await page.fill('input[placeholder="Password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  await waitBody('Institutional Access', 30000);
  try {
    await btn('Continue as Free').click({ timeout: 15000 });
  } catch {}
  await page.waitForTimeout(2000);
  log('fresh free account created via signup UI', true, `${EMAIL}`);

  // ---------- 2. Capture the live auth token (from the browser client) ----------
  token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      try {
        const o = JSON.parse(localStorage.getItem(key));
        if (o && typeof o === 'object') {
          if (o.access_token) return o.access_token;
          if (o.session?.access_token) return o.session.access_token;
          if (o.currentSession?.access_token) return o.currentSession.access_token;
        }
      } catch {}
    }
    return null;
  });
  log('auth token captured from live browser session', !!token, token ? `token ${token.slice(0,12)}…` : 'token missing');

  const { data: userList } = await admin.auth.admin.listUsers();
  const me = (userList.users || []).find(x => x.email === EMAIL) || {};
  userId = me.id || null;

  // ---------- 3. API: session register with a device id ----------
  const devId = `dev-${stamp}`;
  let r = await apiCall('POST', '/api/session/register', { token, body: { device_identifier: 'apiquota-run' }, headers: { 'x-session-id': devId } });
  log('POST /api/session/register → 200 registered', r.status === 200 && r.body?.success === true,
    `status=${r.status} mode=${r.body?.sessionMode} sessionId=${r.body?.sessionId}`);

  // ---------- 4. API: brand-new free user → course-status is EMPTY ----------
  r = await apiCall('GET', '/api/quota/course-status', { token });
  const emptySubjects = r.body && Object.keys(r.body.subjects || {}).length === 0;
  log('GET /api/quota/course-status (new user) → empty map', r.status === 200 && emptySubjects,
    `status=${r.status} subjects=${JSON.stringify(r.body?.subjects)}`);

  // ---------- 5. API: first consume → ALLOWED, free = 10qs + 1h cooldown ----------
  r = await apiCall('POST', '/api/quota/course-consume', { token, body: { course_key: 'clinical-challenge:both', count: 30 } });
  const b = r.body || {};
  const cooldown1h = b.cooldown_remaining_seconds != null && b.cooldown_remaining_seconds <= 1800 && b.cooldown_remaining_seconds >= 1790;
  log('POST /api/quota/course-consume → allowed=true, premium=false (server-side), 1h cooldown',
    r.status === 200 && b.allowed === true && b.premium === false && b.rounds_completed === 1 && cooldown1h,
    `status=${r.status} allowed=${b.allowed} premium=${b.premium} rounds=${b.rounds_completed} cooldown=${b.cooldown_remaining_seconds}s`);

  // ---------- 6. API: second consume within cooldown → BLOCKED (allowed=false) ----------
  r = await apiCall('POST', '/api/quota/course-consume', { token, body: { course_key: 'clinical-challenge:both', count: 30 } });
  const b2 = r.body || {};
  log('POST /api/quota/course-consume (2nd, same course) → allowed=false (cooldown)', 
    r.status === 200 && b2.allowed === false && b2.is_ready === false,
    `status=${r.status} allowed=${b2.allowed} ready=${b2.is_ready} cooldown=${b2.cooldown_remaining_seconds}s`);

  // ---------- 7. API: course-status now reflects the reserved round ----------
  r = await apiCall('GET', '/api/quota/course-status', { token });
  const sub = (r.body?.subjects || {})['clinical-challenge:both'] || {};
  log('GET /api/quota/course-status now shows the course round (10 used, 1h)',
    r.status === 200 && sub.questions_used === 10 && sub.rounds_completed === 1 && sub.is_ready === false,
    `status=${r.status} ${JSON.stringify(sub)}`);

  // ---------- 8. API: different course is INDEPENDENT (per-course isolation) ----------
  r = await apiCall('POST', '/api/quota/course-consume', { token, body: { course_key: 'quick-quiz:both', count: 10 } });
  const isoAllowed = r.status === 200 && r.body?.allowed === true && r.body?.rounds_completed === 1;
  log('POST /api/quota/course-consume (diff course) → allowed (per-course isolation)', isoAllowed,
    `allowed=${r.body?.allowed} rounds=${r.body?.rounds_completed}`);

  // ---------- 9. API: unauthorized consume (no token) → 401 ----------
  r = await apiCall('POST', '/api/quota/course-consume', { body: { course_key: 'uselu-test', count: 10 } });
  log('POST /api/quota/course-consume with NO token → 401 Unauthorized', r.status === 401,
    `status=${r.status}`);

  // ---------- 10. Session gating: X-Session-Id honored; token still authenticates ----------
  r = await apiCall('GET', '/api/session/status', { token, headers: { 'x-session-id': devId } });
  log('GET /api/session/status with X-Session-Id → authenticated', r.status === 200 && r.body?.authenticated === true,
    `status=${r.status} auth=${r.body?.authenticated} mode=${r.body?.sessionMode}`);

  // ---------- 11. DB cross-check: server-authoritative row persisted ----------
  const { data: rows } = await admin.from('user_course_quota')
    .select('course_key, questions_used, rounds_completed, last_round_completed_at')
    .eq('user_id', userId).order('course_key');
  const keys = (rows || []).map(x => x.course_key).sort();
  log('server-side user_course_quota rows persisted for both consumed courses',
    Array.isArray(rows) && rows.length === 2 && keys.includes('clinical-challenge:both') && keys.includes('quick-quiz:both'),
    JSON.stringify(rows));
} catch (e) {
  console.log('FATAL:', e.message);
  log('fatal error', false, e.message);
} finally {
  if (userId) { try { await admin.auth.admin.deleteUser(userId); } catch {} }
  browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n=== FREE QUOTA (API FOCUS) TEST: ${results.length - failed.length}/${results.length} passed ===`);
for (const c of children) try { c.kill(); } catch {}
process.exit(failed.length ? 1 : 0);
