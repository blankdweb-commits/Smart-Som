// scripts/e2e-auth-flow.mjs
// End-to-end Supabase auth integration test:
//   1. Fresh signup -> redirected to /activate
//   2. "Continue as Free" -> free-tier dashboard renders with quota (50/12h)
//   3. Backend verification: auth.users + profiles row exist (service role)
//   4. Sign out from Settings -> back on the login page
//   5. Signup with the SAME email again -> "already exists" toast
//   6. Sign back in -> dashboard renders, still free-tier quota
// Usage: node scripts/e2e-auth-flow.mjs
import { createClient } from '@supabase/supabase-js';
import {
  loadEnv,
  createBrowser,
  createLogger,
  signupFlow,
  loginFlow,
  exit
} from './e2e-utils.mjs';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const email = `authflow${stamp}@apextest.local`;
const password = 'testpass123';
const name = `Auth Flow ${stamp}`;

const tester = createLogger();
const browser = await createBrowser();
let page;
const consoleLog = [];

const pageBody = async () => ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 180);

// Interval body polling. waitForFunction proved unreliable against this app's
// WebGL-budget-starved frames, but plain textContent polling is rock solid.
const waitBody = async (text, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    if (body.includes(text)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

try {
  // ---------- 1. FRESH SIGNUP -> /activate ----------
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleLog.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => consoleLog.push(`[PAGEERROR] ${e.message}`));
  const { urlNow } = await signupFlow(page, BASE, name, email, password);
  tester.log('signup submitted', !!urlNow, urlNow);

  const onActivate = await waitBody('Institutional Access');
  tester.log('redirected to /activate after signup', onActivate, `${page.url()} | body: ${await pageBody()}`);

  // ---------- 2. CONTINUE AS FREE -> FREE DASHBOARD + QUOTA ----------
  const freeBtn = page.locator('button', { hasText: 'Continue as Free' }).first();
  const freeVisible = await freeBtn.isVisible().catch(() => false);
  tester.log('"Continue as Free" button prominent on activate page', freeVisible);
  await freeBtn.click();

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  const dashboardRendered = await waitBody('Nursing Exam Command Center');
  tester.log('free account lands on dashboard', dashboardRendered, `${page.url()} | body: ${await pageBody()}`);

  const bodyFree = (await page.textContent('body').catch(() => '')) || '';
  tester.log('free quota card shows "50 / 12h"', /Free Daily Quota/.test(bodyFree) && /50 \/ 12h/.test(bodyFree));
  tester.log('no session-revoked screen', !/Signed in elsewhere/i.test(bodyFree) && !/session-revoked/i.test(page.url()));
  await page.screenshot({ path: 'test-results/auth-free-dashboard.png' });

  // ---------- 3. BACKEND VERIFICATION (auth + profile row) ----------
  const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: authUser } = await admin.auth.admin.listUsers().then(r => ({
    data: r.data.users.find(u => u.email === email) || null
  }));
  tester.log('auth user row exists in auth.users', !!authUser, authUser?.id || 'not found');

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, email, is_activated, role')
    .eq('email', email)
    .maybeSingle();
  tester.log('profiles row exists (DB trigger)', !!profile, profile ? `${profile.full_name} role=${profile.role}` : 'missing');
  tester.log('profile defaults to free (not activated, student)', !!profile && profile.is_activated === false && profile.role === 'student');

  // ---------- 4. SIGN OUT FROM SETTINGS -> LOGIN PAGE ----------
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' }).catch(() => {});
  const signOutVisible = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const btn = page.locator('button', { hasText: 'Sign Out' }).first();
      if (await btn.isVisible().catch(() => false)) return true;
      await page.waitForTimeout(500);
    }
    return false;
  })();
  tester.log('sign-out button available in Settings', signOutVisible, `body: ${await pageBody()}`);
  await page.locator('button', { hasText: 'Sign Out' }).first().click();
  await waitBody('Welcome Back').then(() => {});
  const signedOutUrl = page.url();
  tester.log('sign-out returns to login', /\/login/.test(signedOutUrl), signedOutUrl);

  // ---------- 5. SIGNUP WITH SAME EMAIL -> "ALREADY EXISTS" TOAST ----------
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Full Name"]', name);
  await page.fill('input[placeholder="Email Address"]', email);
  await page.fill('input[placeholder="Password"]', password);
  await page.fill('input[placeholder="Confirm Password"]', password);
  await page.click('button[type="submit"]');
  const duplicateToast = await waitBody('already exists', 15000);
  tester.log('duplicate signup warns "account already exists"', duplicateToast, `url=${page.url()} body: ${await pageBody()}`);
  await page.screenshot({ path: 'test-results/auth-duplicate-toast.png' });

  // ---------- 6. SIGN BACK IN -> DASHBOARD + QUOTA ----------
  await loginFlow(page, BASE, email, password);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  const reloginRendered = await waitBody('Nursing Exam Command Center', 25000);
  tester.log('re-login renders dashboard', reloginRendered, `${page.url()} | body: ${await pageBody()}`);
  const bodyRelogin = (await page.textContent('body').catch(() => '')) || '';
  tester.log('free quota persists after re-login (50/12h)', /50 \/ 12h/.test(bodyRelogin));
  await page.screenshot({ path: 'test-results/auth-relogin-dashboard.png' });

  await page.close();
  if (consoleLog.length > 0) console.log('\n--- console errors/warnings ---\n' + consoleLog.slice(0, 20).join('\n'));
  exit(browser, tester.results);
} catch (err) {
  console.error('\nFATAL', err && err.message);
  if (page) await page.screenshot({ path: 'test-results/auth-flow-fatal.png' }).catch(() => {});
  await browser.close();
  process.exit(1);
}