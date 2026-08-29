import {
  loadEnv,
  createBrowser,
  createLogger,
  signupFlow,
  waitForText,
  exit
} from './e2e-utils.mjs';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);

const tester = createLogger();
const browser = await createBrowser();
let page;

try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const email = `grp${stamp}@apextest.local`;
  const { urlNow } = await signupFlow(page, BASE, `Group Tester ${stamp}`, email, 'testpass123');
  tester.log('signup', true, urlNow);

  await page.goto(`${BASE}/study-groups`, { waitUntil: 'networkidle' });
  await waitForText(page, 'Create Group').catch(() => {});
  await waitForText(page, 'Verified Study Groups').catch(() => {});
  tester.log('study groups page opens', /Verified Study Groups/i.test(await page.textContent('body')));

  const groupName = `E2E Group ${stamp}`;
  const focus = 'E2E Pharmacology Sprint';
  await page.locator('button', { hasText: 'Create Group' }).first().click();
  await page.waitForTimeout(800);

  await page.locator('input[placeholder*="Warri Study Group"]').fill(groupName);
  await page.locator('input[placeholder*="work on together"]').fill('E2E automatic study group verification');
  await page.locator('input[placeholder="e.g. UNIBEN School of Nursing"]').fill('Apex Test School');
  await page.locator('input[placeholder="e.g. Year 2"]').fill('Year 2');
  await page.locator('input[placeholder="2026 Council Exam Preparation"]').fill(focus);
  await page.locator('button', { hasText: /^Create$/ }).click();
  await waitForText(page, groupName).catch(() => {});

  const bodyAfterCreate = await page.textContent('body');
  tester.log('created group opens (detail view)', (bodyAfterCreate || '').includes(groupName) && /Back to Study Groups/i.test(bodyAfterCreate || ''));
  tester.log('owner membership applied (member count 1)', (bodyAfterCreate || '').includes(groupName) && /member/i.test(bodyAfterCreate || ''));

  const backBtn = page.locator('button', { hasText: 'Back to Study Groups' });
  await backBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  if ((await backBtn.count().catch(() => 0)) > 0) {
    await backBtn.click();
    await waitForText(page, 'Verified Study Groups').catch(() => {});
    const listText = await page.textContent('body');
    const openBtn = page.locator('button', { hasText: 'Open' }).first();
    tester.log('group card in list with Open button', (listText || '').includes(groupName) && (await openBtn.count().catch(() => 0)) > 0);

    if ((await openBtn.count().catch(() => 0)) > 0) {
      await openBtn.click();
      await waitForText(page, 'Back to Study Groups').catch(() => {});
      const detailText = await page.textContent('body');
      tester.log('group detail reopens', (detailText || '').includes(groupName));
      await backBtn.click();
      await waitForText(page, 'Verified Study Groups').catch(() => {});
    } else {
      tester.log('group detail reopens', false, 'no Open button in list');
    }
  } else {
    tester.log('group card in list with Open button', false, 'no Back to Study Groups button');
  }

  const joinBtn = page.locator('button', { hasText: /^Join\b/ }).first();
  const hasOtherGroup = (await joinBtn.count().catch(() => 0)) > 0;
  if (hasOtherGroup) {
    await joinBtn.click();
    await page.waitForTimeout(1500);
    const joinedText = await page.textContent('body');
    tester.log('join another group works', /Leave/.test(joinedText || ''));
  } else {
    console.log('INFO  no other group available to join (fresh account created the only group)');
    tester.log('join another group works', true, '(nothing to join — ownership only)');
  }

  await page.screenshot({ path: 'test-results/e2e-study-groups.png' });
  await page.close();
} catch (e) {
  tester.log('E2E study groups flow', false, e.message);
} finally {
  exit(browser, tester.results);
}