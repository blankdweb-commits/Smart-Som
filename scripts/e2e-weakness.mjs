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
const ADMIN =
  env.E2E_ADMIN_EMAIL && env.E2E_ADMIN_PASSWORD
    ? { email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }
    : null;

const tester = createLogger();
const browser = await createBrowser();
let page;

try {
  // ---------- A. NON-ACTIVATED ACCOUNT → PREMIUM GATE ----------
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const email = `weak${stamp}@apextest.local`;
  const { urlNow } = await signupFlow(page, BASE, `Weakness Tester ${stamp}`, email, 'testpass123');
  tester.log('signup', true, urlNow);

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await waitForText(page, 'Weakness Challenge').catch(() => {});
  const dashBody = await page.textContent('body');
  tester.log('weakness challenge card present', /Weakness Challenge/i.test(dashBody));
  tester.log('premium gate shown for inactive account', /Premium feature/i.test(dashBody));

  const activateBtn = page.locator('button', { hasText: /^Activate\b/ }).first();
  const hasActivate = (await activateBtn.count().catch(() => 0)) > 0;
  tester.log('activate CTA present on gated card', hasActivate);
  if (hasActivate) {
    await activateBtn.click();
    await page.waitForTimeout(1800);
    tester.log('activate CTA routes to /activate', /\/activate/.test(page.url()), page.url());
  }

  await page.goto(`${BASE}/quiz?weakness=1`, { waitUntil: 'domcontentloaded' });
  let gated = true;
  try {
    await page.waitForURL('**/activate', { timeout: 25000, polling: 500 });
  } catch {
    gated = false;
  }
  tester.log('weakness deep-link gated to /activate', gated, page.url());

  await page.screenshot({ path: 'test-results/e2e-weakness-gated.png' });
  await page.close();

  // ---------- B. ADMIN / ACTIVATED ACCOUNT → UNLOCKED ----------
  if (ADMIN) {
    const adminPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await loginFlow(adminPage, BASE, ADMIN.email, ADMIN.password);
    await adminPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await waitForText(adminPage, 'Weakness Challenge').catch(() => {});
    const adminBody = await adminPage.textContent('body');
    tester.log('weakness card visible for admin', /Weakness Challenge/i.test(adminBody));
    tester.log('premium gate NOT shown for admin', !/Premium feature/i.test(adminBody), '(activated)');
    tester.log(
      'challenge content unlocked for admin',
      /questions to unlock|custom weakness quiz|weak concepts/i.test(adminBody)
    );
    await adminPage.screenshot({ path: 'test-results/e2e-weakness-unlocked.png' });
    await adminPage.close();
  } else {
    console.log('SKIP  admin unlocked-state check (set E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD in .env)');
  }
} catch (e) {
  tester.log('E2E weakness flow', false, e.message);
} finally {
  exit(browser, tester.results);
}