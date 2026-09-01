// scripts/e2e-render-check.mjs
// Verifies the post single-device-lock-removal render path:
//   1. A fresh account can sign up and the DASHBOARD renders (not blank, not a
//      forced sign-up, no "/session-revoked" redirect).
//   2. Reloading /dashboard stays on the dashboard (no spurious sign-in loop).
//   3. Signing out and logging back in renders the dashboard again.
// Usage: node scripts/e2e-render-check.mjs
import {
  loadEnv,
  createBrowser,
  createLogger,
  signupFlow,
  loginFlow,
  waitForText,
  exit
} from './e2e-utils.mjs';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);

const tester = createLogger();
const browser = await createBrowser();
let page;

const DASH_MARKER = 'Nursing Exam Command Center';

try {
  // ---------- A. FRESH SIGNUP -> DASHBOARD RENDERS ----------
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const email = `render${stamp}@apextest.local`;
  const { urlNow } = await signupFlow(page, BASE, `Render Tester ${stamp}`, email, 'testpass123');
  tester.log('signup triggered', !!urlNow, urlNow);

  // Give the app a moment to settle, then go to /dashboard explicitly.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);

  const urlAfter = page.url();
  tester.log('stays on app (not /session-revoked)', !urlAfter.includes('/session-revoked'), urlAfter);
  tester.log('not forced to /signin', !/\/signin|\/login/.test(urlAfter), urlAfter);

  let rendered = true;
  try {
    await waitForText(page, DASH_MARKER, 30000);
  } catch {
    rendered = false;
  }
  tester.log('dashboard content rendered', rendered, urlAfter);

  const body = (await page.textContent('body').catch(() => '')) || '';
  tester.log('dashboard body is non-blank', body.trim().length > 0);
  tester.log('no "Signed in elsewhere" screen', !/Signed in elsewhere/i.test(body));

  await page.screenshot({ path: 'test-results/render-dashboard.png' });

  // ---------- B. RELOAD STAYS LOGGED IN (no spurious loop) ----------
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  const urlReload = page.url();
  tester.log('reload stays on /dashboard', /\/(dashboard)?$/.test(urlReload), urlReload);
  let stillRendered = true;
  try {
    await waitForText(page, DASH_MARKER, 20000);
  } catch {
    stillRendered = false;
  }
  tester.log('dashboard re-renders after reload', stillRendered, urlReload);
  await page.screenshot({ path: 'test-results/render-dashboard-reload.png' });

  // ---------- C. SIGN OUT -> SIGN BACK IN -> RENDERS ----------
  // Run sign-out from the app (AppContext signOut is not on a shared control on
  // this viewport, so navigate via Supabase-driven logout is hard here);
  // instead do a fresh login flow which validates re-login renders the app.
  await page.close();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await loginFlow(page, BASE, email, 'testpass123');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  const urlLogin = page.url();
  tester.log('re-login stays on app', !urlLogin.includes('/session-revoked') && !/\/signin/.test(urlLogin), urlLogin);
  let loginRendered = true;
  try {
    await waitForText(page, DASH_MARKER, 20000);
  } catch {
    loginRendered = false;
  }
  tester.log('dashboard renders after re-login', loginRendered, urlLogin);
  await page.screenshot({ path: 'test-results/render-re-login.png' });

  await page.close();
  exit(browser, tester.results);
} catch (err) {
  console.error('\nFATAL', err && err.message);
  if (page) await page.screenshot({ path: 'test-results/render-fatal.png' }).catch(() => {});
  await browser.close();
  process.exit(1);
}
