// scripts/_free-quota-run.mjs — TEMP orchestration (delete after use)
// Starts API (3001) + Vite (5173) as in-process children, then runs a free
// quota E2E with a freshly created account, and verifies the server-side
// quota row (AC4) via service role. Single process keeps servers alive.
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { createBrowser, loadEnv } from './e2e-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API_PORT = 3001;
const WEB_PORT = 5173;
const BASE = `http://localhost:${WEB_PORT}`;
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

const children = [];
const spawnLog = (name) => (data) => {
  const s = String(data);
  if (/error|listen|3001|5173|ready|Local:|started/i.test(s)) process.stdout.write(`[${name}] ${s}`);
};
const api = spawn('node', ['scripts/serve-api.mjs'], { cwd: ROOT, stdio: 'pipe' });
api.stdout.on('data', spawnLog('api'));
api.stderr.on('data', spawnLog('api'));
children.push(api);
const vite = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: ROOT, stdio: 'pipe' });
vite.stdout.on('data', spawnLog('vite'));
vite.stderr.on('data', spawnLog('vite'));
children.push(vite);

const apiReady = await waitReady(`http://localhost:${API_PORT}/`);
const webReady = await waitReady(`http://localhost:${WEB_PORT}/`);
console.log(`\nAPI ready: ${apiReady} | Web ready: ${webReady}`);
if (!apiReady || !webReady) {
  for (const c of children) try { c.kill(); } catch {}
  process.exit(1);
}

// ---------------- E2E ---------------- //
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
const bodySnapshot = async () => ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 200);
const btn = (t) => page.locator('button', { hasText: t }).first();

const stamp = Date.now().toString().slice(-9);
const EMAIL = `freetest${stamp}@apextest.local`;
const PASS = 'quota test 123';

let userId = null;
try {
  // 1. Fresh free signup (inline — networkidle never settles on this WebGL app)
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  await page.waitForSelector('input[placeholder="Email Address"]', { timeout: 90000 });
  await page.fill('input[placeholder="Full Name"]', 'Free Quota Tester');
  await page.fill('input[placeholder="Email Address"]', EMAIL);
  await page.fill('input[placeholder="Password"]', PASS);
  await page.fill('input[placeholder="Confirm Password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  const urlNow = page.url();
  const afterBody = ((await page.textContent('body').catch(() => '')) || '');
  const needsSignIn = urlNow.includes('/signup') && /account created/i.test(afterBody);
  if (needsSignIn) {
    await page.fill('input[placeholder="Email Address"]', EMAIL);
    await page.fill('input[placeholder="Password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(1500);
  const onActivate = await waitBody('Institutional Access', 30000);
  await btn('Continue as Free').click();
  await page.waitForTimeout(1500);
  log('fresh free account created + signed in (free plan)', onActivate, `url=${page.url()} onActivate=${onActivate}`);

  // 1b. Confirm new user has NO premium / activation
  const { data: userList } = await admin.auth.admin.listUsers();
  const me = (userList.users || []).find(x => x.email === EMAIL) || null;
  userId = me?.id;
  const { data: prof } = await admin.from('profiles').select('is_activated').eq('id', userId).maybeSingle();
  log('flag: new user is free (is_activated=false)', prof && prof.is_activated === false, JSON.stringify(prof));

  // 2. Quiz grid banner
  await page.goto(`${BASE}/quiz`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  await waitBody('Clinical Challenge', 30000);
  await waitBody('10 questions per round', 20000);
  const gridText = (await page.textContent('body').catch(() => '')) || '';
  log('free plan banner present', gridText.includes('10 questions per round') && gridText.includes('new round every 30 minutes'));

  // 3. Clinical setup difficulty lock
  const clinicalBtn = page.locator('button', { hasText: 'Clinical Challenge' }).first();
  await clinicalBtn.scrollIntoViewIfNeeded().catch(() => {});
  await clinicalBtn.click({ timeout: 30000, force: true });
  await waitBody('Choose Difficulty', 15000);
  const lockCheck = await page.evaluate(() => {
    const locked = (label) => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes(label));
      return b ? { disabled: b.disabled, disabledAttr: b.hasAttribute('disabled') } : null;
    };
    return { easy: locked('Easy'), moderate: locked('Moderate'), hard: locked('Hard'), expert: locked('Expert') };
  });
  log('per-course difficulty locked (Moderate/Hard/Expert disabled, Easy open)',
    lockCheck.easy && !lockCheck.easy.disabled && !lockCheck.easy.disabledAttr &&
    lockCheck.moderate && lockCheck.moderate.disabledAttr !== false &&
    lockCheck.hard && lockCheck.hard.disabledAttr !== false &&
    lockCheck.expert && lockCheck.expert.disabledAttr !== false,
    JSON.stringify(lockCheck));

  // 4. Proceed with Easy -> free locked to 10
  await btn('Easy').click();
  await btn('Continue').click();
  await waitBody('Customize Your Session', 15000);
  await waitBody('Free plan: 10 questions per round', 10000);
  const step2 = await page.evaluate(() => {
    const t = (document.body.innerText || '').toUpperCase();
    const countBtns = [...document.querySelectorAll('button')].filter(b => /^(10|20|30|50|100)$/.test(b.textContent.trim()) && b.offsetParent !== null).map(b => b.textContent.trim());
    return { countBtns, freeCopy: t.includes('FREE PLAN: 10 QUESTIONS PER ROUND') };
  });
  log('free user locked to exactly 10 questions', step2.countBtns.length === 1 && step2.countBtns[0] === '10' && step2.freeCopy, `counts=[${step2.countBtns}]`);

  // 5. Start first round -> allowed
  await btn('Continue').click();
  await waitBody('Review Your Session', 15000);
  await btn('Start Quiz').click();
  const firstRoundOk = await waitBody(/Question \d+ of 10/, 25000);
  log('first round starts immediately (10qs)', firstRoundOk, firstRoundOk ? '' : await bodySnapshot());

  // 6. Verify DB: consume_course_quota row created with is_ready false (cooldown)
  await page.waitForTimeout(1500);
  const { data: quotaRows } = await admin.from('user_course_quota').select('course_key, questions_used, rounds_completed, is_ready, cooldown_remaining_seconds').eq('user_id', userId);
  log('server-side quota row created for the course', Array.isArray(quotaRows) && quotaRows.length >= 1,
    quotaRows ? JSON.stringify(quotaRows) : 'none');

  // 7. Exit -> cooldown chip "Next round · 30m"
  await page.click('button[aria-label="Exit quiz"]');
  await waitBody('Exit for now', 10000);
  await page.click('button:has-text("Exit for now")');
  const chipShown = await waitBody('Next round · 30m', 25000);
  log('course entry shows "Next round · 30m" cooldown chip', chipShown, await bodySnapshot());

  // 8. Second start attempt -> cooldown modal (AC4 enforcement)
  const clinicalBtn2 = page.locator('button', { hasText: 'Clinical Challenge' }).first();
  await clinicalBtn2.scrollIntoViewIfNeeded().catch(() => {});
  await clinicalBtn2.click({ timeout: 30000, force: true });
  await waitBody('Choose Difficulty', 15000);
  await btn('Easy').click();
  await btn('Continue').click();
  await waitBody('Customize Your Session', 15000);
  await btn('Continue').click();
  await waitBody('Review Your Session', 15000);
  await btn('Start Quiz').click();
  const modalShown = await waitBody('Next round not ready yet', 25000);
  const modal = await page.evaluate(() => {
    const t = (document.body.innerText || '').toUpperCase();
    return {
      countdown: /[0-9]{2}:[0-9]{2}/.test(t),
      tryAnother: t.includes('TRY ANOTHER COURSE'),
      premium: t.includes('GO PREMIUM') && t.includes('UNLIMITED ROUNDS')
    };
  });
  log('second start within cooldown -> quota modal blocks (AC4)', modalShown && modal.countdown && modal.tryAnother && modal.premium,
    `countdown=${modal.countdown} tryAnother=${modal.tryAnother} premium=${modal.premium}`);

  // 9. DB still shows rounds_completed=1 (no double-consume)
  const { data: secondRows } = await admin.from('user_course_quota').select('course_key, rounds_completed').eq('user_id', userId).eq('course_key', 'clinical-challenge:both');
  log('only ONE round consumed (no double-consume on blocked attempt)',
    Array.isArray(secondRows) && secondRows.length === 1 && secondRows[0].rounds_completed === 1,
    secondRows ? JSON.stringify(secondRows) : 'none');
} catch (e) {
  console.log('FATAL:', e.message);
  log('fatal error', false, `${e.message} | ${await bodySnapshot()}`);
} finally {
  // Cleanup: delete the throwaway user
  if (userId) { try { await admin.auth.admin.deleteUser(userId); } catch {} try { await admin.from('user_course_quota').delete().eq('user_id', userId); } catch {} }
  browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n=== FREE QUOTA TEST: ${results.length - failed.length}/${results.length} passed ===`);
for (const c of children) try { c.kill(); } catch {}
process.exit(failed.length ? 1 : 0);
