// TEMP repro: does the Create Group modal content render? (delete after use)
import { loadEnv, createBrowser, createLogger, signupFlow, waitForText, exit } from './e2e-utils.mjs';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const tester = createLogger();
const browser = await createBrowser();
let page;

const consoleErrors = [];
try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 500)); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 500)));

  const email = `cg${stamp}@apextest.local`;
  await signupFlow(page, BASE, `CG Tester ${stamp}`, email, 'testpass123');
  tester.log('signup ok', true, email);

  await page.goto(`${BASE}/study-groups`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const urlNow = page.url();
  tester.log('landed on /study-groups', urlNow.includes('/study-groups'), urlNow);

  const header = await page.locator('text=/Verified Study Groups/').count();
  tester.log('groups header text renders', header >= 1, `count=${header}`);

  const createBtn = page.locator('button', { hasText: /Create Group/i }).first();
  const btnCount = await page.locator('button', { hasText: /Create Group/i }).count();
  tester.log('Create Group button exists', btnCount >= 1, `count=${btnCount}`);
  if (!(await btnCount)) {
    const bodyText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1500);
    tester.log('page state note', true, bodyText.slice(0, 500));
    throw new Error('No Create Group button — page may not be StudyGroups');
  }
  await createBtn.click();
  await page.waitForTimeout(1500);

  const titleCount = await page.locator('text=/^Create Study Group$/').count();
  const labels = ['Group Name', 'Description', 'School', 'Level / Year', 'Focus Area'];
  const labelCounts = {};
  for (const l of labels) labelCounts[l] = await page.locator('label', { hasText: l }).count();
  const inputs = await page.locator('input').count();

  const card = page.locator('.max-w-md');
  let cardOpacity = null;
  let cardTransform = null;
  if (await card.count()) {
    cardOpacity = await card.evaluate((el) => getComputedStyle(el).opacity);
    cardTransform = await card.evaluate((el) => getComputedStyle(el).transform);
  }

  tester.log('modal title "Create Study Group" counts', titleCount >= 1, `count=${titleCount}`);
  tester.log('modal label counts', labels.every(l => labelCounts[l] >= 1), JSON.stringify(labelCounts));
  tester.log('inputs in modal', inputs >= 5, `inputs=${inputs}`);
  tester.log('modal card present + opacity/transform', cardOpacity !== null, `opacity=${cardOpacity} transform=${cardTransform?.slice(0, 80)}`);
  tester.log('no console/page errors while opening modal', consoleErrors.length === 0, consoleErrors.join(' | ') || 'clean');

  await page.screenshot({ path: 'test-results/dbg-create-modal.png', fullPage: true });
  tester.log('screenshot saved', true, 'test-results/dbg-create-modal.png');

  const bodyText = (await page.evaluate(() => document.body.innerText.slice(0, 4000))).replace(/\s+/g, ' ');
  console.log('BODY TEXT:'); console.log(bodyText.slice(0, 2500));
} catch (e) {
  tester.log('repro flow', false, e.message);
  if (page) await page.screenshot({ path: 'test-results/dbg-create-modal-error.png', fullPage: true }).catch(() => {});
} finally {
  await page.screenshot({ path: 'test-results/dbg-create-modal-final.png', fullPage: true }).catch(() => {});
  console.log(consoleErrors.length ? 'CONSOLE/PAGE ERRORS:\n' + consoleErrors.join('\n---\n') : 'no console/page errors');
  exit(browser, tester.results);
}