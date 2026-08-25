import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
let passed = 0, failed = 0;
const log = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

try {
  // ---- Speed Challenge: No Time Limit must hide countdown ----
  await page.goto(`${BASE}/quiz`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('text=Speed Challenge', { timeout: 30000 });
  await page.click('text=Speed Challenge');
  await page.waitForSelector('text=Choose Difficulty', { timeout: 10000 });
  await page.click('button:has-text("Hard")');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Customize Your Session', { timeout: 10000 });

  // Forced sections replaced by notes
  const orderNote = await page.locator('text=Questions always randomized in this mode').count();
  log('Speed setup hides Order section (note shown)', orderNote === 1);
  const answerNote = await page.locator('text=Instant feedback mode').count();
  log('Speed setup hides Answer Mode section (note shown)', answerNote === 1);

  await page.click('button:has-text("No Time Limit")');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Review Your Session', { timeout: 10000 });
  const reviewTime = await page.locator('text=No Time Limit').count();
  log('Review shows No Time Limit', reviewTime >= 1);
  await page.click('button:has-text("Start Quiz")');

  // Fullscreen may fail headless — dismiss any dialog
  await page.waitForTimeout(2500);

  const body = page.locator('body');
  const hasCountdown = await body.locator('text=/^\\d+s$/').count();
  log('Speed quiz hides per-question countdown when timer off', hasCountdown === 0, `countdown elements=${hasCountdown}`);

  // Options render and header shows SPEED MODE uppercase
  const speedHeader = await page.locator('text=SPEED MODE').count();
  log('Speed header shows SPEED MODE', speedHeader >= 1);
  const options = await page.locator('[data-testid="quiz-option"]').count();
  log('Speed quiz renders options', options >= 2, `options=${options}`);

  // Quit back
  await page.locator('button[aria-label="Exit quiz"]').click();
  await page.waitForTimeout(500);
  const quitModal = await page.locator('text=Abandon Challenge?').count();
  if (quitModal >= 1) {
    await page.click('text=Quit for now');
    log('Speed quit modal works', true);
  } else {
    log('Speed quit modal works', false, 'modal not found after clicking exit icon');
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
} catch (e) {
  console.log('FATAL:', e.message);
  await browser.close();
  process.exit(1);
}
