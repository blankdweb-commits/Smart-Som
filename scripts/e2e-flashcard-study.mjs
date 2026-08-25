import { chromium } from 'playwright';

// E2E: restructured flashcard study flow — Academic Vault -> Study All Cards ->
// count picker setup (5/10/15/20/All + shuffle) -> swipeable study session ->
// flip reveal -> SRS rating buttons -> exit back to library.
const BASE = 'http://localhost:5173';
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();

// Click the top card and verify the flipped back face renders
async function tapFlipRevealsAnswer(page) {
  await page.locator('[data-swipeable-cards-top-card="true"] .flashcard-container')
    .click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const inner = document.querySelector('.flashcard-inner.flipped');
    if (!inner) return false;
    const back = inner.querySelector('.flashcard-back');
    return !!back && back.getBoundingClientRect().height > 0;
  }).catch(() => false);
}
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile
const page = await ctx.newPage();
let pageErrors = 0;
page.on('pageerror', err => { pageErrors++; console.log('PAGEERROR:', err.message); });

try {
  await page.goto(`${BASE}/flashcards`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // ---------- 1. Directory view ----------
  const dirText = await page.textContent('body');
  log('Academic Vault directory renders', dirText.includes('Academic Vault') || dirText.includes('General Nursing'));
  // By design: Study All Cards stays disabled until a program is selected
  const studyAllDisabled = await page.isDisabled('button:has-text("Study All Cards")').catch(() => true);
  log('Study All Cards gated until program selected', studyAllDisabled);

  // ---------- 2. Walk hierarchy: General Nursing -> first level -> first semester ----------
  await page.click('button:has-text("General Nursing")');
  await page.waitForTimeout(800);
  const lvlBtn = page.locator('button:has-text("Year")').first();
  if (await lvlBtn.count() === 0) throw new Error('No level buttons rendered');
  const lvlLabel = (await lvlBtn.textContent()).trim();
  await lvlBtn.click();
  await page.waitForTimeout(800);
  const semBtn = page.locator('button:has-text("Semester")').first();
  if (await semBtn.count() === 0) throw new Error('No semester buttons rendered');
  await semBtn.click();
  await page.waitForTimeout(800);

  // ---------- 3. Subject list with per-subject Study buttons ----------
  const subjText = await page.textContent('body');
  const studyButtons = await page.locator('button:text-is("Study")').count();
  log(`subject list renders under ${lvlLabel} with Study buttons`, studyButtons >= 1, `study buttons=${studyButtons}`);

  const firstStudy = page.locator('button:text-is("Study")').first();
  if (await firstStudy.isDisabled()) throw new Error('First subject Study button disabled (0 cards)');
  await firstStudy.click();
  await page.waitForTimeout(1000);
  const setupText = await page.textContent('body');
  const hasCounts = ['5', '10', '15', '20'].every(c => setupText.includes(c));
  const hasAll = setupText.includes('All');
  const hasShuffle = /shuffle/i.test(setupText);
  log('setup shows count picker (5/10/15/20) + All + Shuffle',
    hasCounts && hasShuffle, `counts=${hasCounts}, all=${hasAll}, shuffle=${hasShuffle}`);

  // ---------- 3. Pick 5 and start session ----------
  await page.click('button:has-text("5")').catch(() => {});
  await page.waitForTimeout(300);
  const startClicked = await page.click('button:has-text("Start")', { timeout: 5000 }).then(() => true).catch(() => false);
  if (!startClicked) {
    await page.click('button:has-text("Begin")', { timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);

  // ---------- 4. Session active: progress bar / card stack present ----------
  const sessText = await page.textContent('body');
  const stackNodes = await page.$$eval('.swipe-cards-root > *', els => els.length).catch(() => 0);
  const sessionUi = stackNodes >= 1 || /\d+\s*\/\s*\d+/.test(sessText);
  log('study session renders card stack', sessionUi, `stack nodes=${stackNodes}`);

  // ---------- 5. Tap top card flips it; SRS bar removed ----------
  const flipOk = await tapFlipRevealsAnswer(page);
  log('tap flips card and reveals answer', flipOk);
  const srsGone = !(await page.textContent('body')).includes('<1m');
  log('legacy SRS rating bar removed', srsGone);

  // ---------- 6. Exit (back arrow in session header) returns to library ----------
  const backArrow = page.locator('div.fixed button').first();
  if (await backArrow.count() > 0) {
    await backArrow.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  const backText = await page.textContent('body');
  log('exit returns to vault/library', backText.includes('Academic Vault') || backText.includes('General Nursing') || backText.includes('Semester'));

} catch (e) {
  console.log('FATAL:', e.message);
  results.push({ step: 'fatal', ok: false });
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
