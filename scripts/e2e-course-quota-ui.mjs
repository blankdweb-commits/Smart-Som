import { createBrowser, loadEnv, createLogger, signupFlow, exit } from './e2e-utils.mjs';

// E2E: free-plan per-course quota UX.
//   - free user sees plan banner + locked 10-question round in setup
//   - first round launches the immersive player (no false cooldown gate)
//   - exiting back to the grid shows the "Next round · 1h" cooldown chip
//   - a second start attempt triggers the centered cooldown modal
const BASE = 'http://localhost:5173';
const stamp = Date.now().toString().slice(-9);
const EMAIL = `cuq${stamp}@apextest.local`;
const PASS = 'quota test 123';

const logger = createLogger();
const log = logger.log;
const browser = await createBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

// Poll body.innerText (NOT waitForFunction — WebGL-starved frames make
// waitForFunction flaky on this app; plain textContent polling is stable).
const waitBody = async (re, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    if (typeof re === 'string' ? body.includes(re) : re.test(body)) return true;
    await page.waitForTimeout(450);
  }
  return false;
};
const bodySnapshot = async () => ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 200);

const btn = (t) => page.locator('button', { hasText: t }).first();

try {
  // ---------- 1. Fresh FREE signup ----------
  await signupFlow(page, BASE, 'Quota Tester', EMAIL, PASS);
  const onActivate = await waitBody('Institutional Access', 30000);
  await btn('Continue as Free').click();
  await page.waitForTimeout(1500);
  log('fresh free user signed in', onActivate, `url=${page.url()}`);

  // ---------- 2. Quiz grid: plan banner + course sections ----------
  await page.goto(`${BASE}/quiz`, { waitUntil: 'networkidle' }).catch(() => {});
  await waitBody('Clinical Challenge', 25000);
  const gridText = (await page.textContent('body').catch(() => '')) || '';
  log('free plan banner present', gridText.includes('10 questions per round') && gridText.includes('new round every hour'));
  const headers = ['Clinical Challenge', 'Quick Quiz', 'Uselu Test Questions', 'Fix My Weak Areas', 'Nursing 200-Level', 'Midwifery 200-Level'];
  const missing = headers.filter(h => !gridText.includes(h));
  log('all course sections listed', missing.length === 0, missing.length ? `missing=${missing}` : '6/6');

  // ---------- 3. Clinical Challenge setup: free-locked options ----------
  await btn('Clinical Challenge').click();
  await waitBody('Choose Difficulty', 15000);
  await btn('Hard').click();
  await btn('Continue').click();
  await waitBody('Customize Your Session', 15000);
  await waitBody('Free plan: 10 questions per round', 10000); // let the section settle

  const step2 = await page.evaluate(() => {
    const text = (document.body.innerText || '').toUpperCase();
    const has = (s) => text.includes(s.toUpperCase());
    const countBtns = [...document.querySelectorAll('button')]
      .filter(b => /^(10|20|30|50|100)$/.test(b.textContent.trim()) && b.offsetParent !== null)
      .map(b => b.textContent.trim());
    return {
      countBtns,
      freeCopy: has('Free plan: 10 questions per round'),
      timerLockCopy: has('Faster/slower timers are premium'),
      has10: has('10s / Q'),
      hasNoLimit: has('No Time Limit'),
      has20: has('20s / Q'),
      has30: has('30s / Q')
    };
  });
  log('free user locked to exactly 10 questions', step2.countBtns.length === 1 && step2.countBtns[0] === '10' && step2.freeCopy,
    `counts=[${step2.countBtns}]`);
  log('free timer locked <=15s (10s only here, No Limit hidden)', step2.has10 && !step2.hasNoLimit && !step2.has20 && !step2.has30 && step2.timerLockCopy,
    `noLimit=${step2.hasNoLimit} 20s=${step2.has20} 30s=${step2.has30}`);

  // ---------- 4. Start first round -> immersive player (allowed) ----------
  await btn('Continue').click();
  await waitBody('Review Your Session', 15000);
  await btn('Start Quiz').click();
  const firstRoundOk = await waitBody(/Question \d+ of 10/, 20000);
  const navHidden = await page.evaluate(() => document.body.classList.contains('quiz-active'));
  log('first round starts immediately (no false cooldown)', firstRoundOk && navHidden, firstRoundOk ? 'player active' : await bodySnapshot());

  // ---------- 5. Exit -> grid shows the cooldown chip ----------
  await page.click('button[aria-label="Exit quiz"]');
  await waitBody('Exit for now', 10000);
  await page.click('button:has-text("Exit for now")');
  const chipShown = await waitBody('Next round · 1h', 20000);
  log('course entry shows "Next round · 1h" cooldown chip', chipShown, await bodySnapshot());

  // ---------- 6. Second start attempt -> centered cooldown modal ----------
  await btn('Clinical Challenge').click();
  await waitBody('Choose Difficulty', 15000);
  await btn('Easy').click();
  await btn('Continue').click();
  await waitBody('Customize Your Session', 15000);
  await btn('Continue').click();
  await waitBody('Review Your Session', 15000);
  await btn('Start Quiz').click();
  const modalShown = await waitBody('Next round not ready yet', 20000);
  const modal = await page.evaluate(() => {
    const t = (document.body.innerText || '').toUpperCase();
    const has = (s) => t.includes(s.toUpperCase());
    return {
      countdown: /[0-9]{2}:[0-9]{2}/.test(t),
      tryAnother: has('Try another course'),
      premium: has('Go Premium') && has('unlimited rounds'),
      freeCopy: has('10-question round per course')
    };
  });
  log('cooldown modal appears on second start', modalShown && modal.countdown && modal.tryAnother && modal.premium && modal.freeCopy,
    `countdown=${modal.countdown}`);

  // ---------- 7. Dismiss modal -> chip persists (countdown may now be under 1h) ----------
  await btn('🔄 Try another course').click();
  await page.waitForTimeout(1200); // grid re-renders; settle
  const chipPersists = await waitBody(/Next round · (\d+h|\d+m)/, 15000);
  log('modal dismissed back to grid, cooldown chip persists', chipPersists, await bodySnapshot());
} catch (e) {
  console.log('FATAL:', e.message);
  log('fatal error', false, `${e.message} | ${await bodySnapshot()}`);
}

exit(browser, logger.results);