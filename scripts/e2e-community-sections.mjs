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

const SECTIONS = [
  'General',
  'Clinical Questions',
  'Exam Discussions',
  'Clinical Experience',
  'Pharmacology',
  'Adult Health',
  'Maternal & Child Health',
  'Mental Health',
  'School Communities'
];

const tester = createLogger();
const browser = await createBrowser();
let page;

try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const email = `sec${stamp}@apextest.local`;
  const { urlNow } = await signupFlow(page, BASE, `Sections Tester ${stamp}`, email, 'testpass123');
  tester.log('signup', true, urlNow);

  await page.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
  await waitForText(page, 'Community Hub').catch(() => {});
  tester.log('community hub renders', /Community Hub/i.test(await page.textContent('body')));

  for (const label of SECTIONS) {
    const tab = page.locator('button', { hasText: label }).first();
    tester.log(`section tab renders: ${label}`, (await tab.count().catch(() => 0)) > 0);
  }

  tester.log('study groups tab renders', (await page.locator('button', { hasText: 'Study Groups' }).count()) > 0);

  const goToSection = async (label) => {
    await page.locator('button', { hasText: label }).first().click();
    await page.waitForTimeout(1500);
  };

  const postText = `E2E section post ${stamp} — pharmacology only`;
  await goToSection('Pharmacology');
  await page.fill('textarea', postText);
  await page.locator('button', { hasText: 'Post' }).first().click();
  let appeared = true;
  try {
    await waitForText(page, postText, 25000);
  } catch {
    appeared = false;
  }
  tester.log('post appears in Pharmacology feed', appeared);

  await goToSection('Clinical Questions');
  const clinicalText = await page.textContent('body');
  tester.log('post hidden in other section (Clinical Questions)', !(clinicalText || '').includes(postText));

  await goToSection('Pharmacology');
  const backText = await page.textContent('body');
  tester.log('post visible again in Pharmacology', (backText || '').includes(postText));

  await page.screenshot({ path: 'test-results/e2e-community-sections.png' });
  await page.close();
} catch (e) {
  tester.log('E2E community sections flow', false, e.message);
} finally {
  exit(browser, tester.results);
}