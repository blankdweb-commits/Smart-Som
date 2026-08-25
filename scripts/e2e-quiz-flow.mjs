import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// E2E: guided quiz setup flow (all steps), immersive player, one-look review,
// nav hiding, exit, and pharmacology bank presence in the non-Uselu pools.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const BASE = 'http://localhost:5173';
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile viewport
const page = await ctx.newPage();
page.on('pageerror', err => console.log('PAGEERROR:', err.message));

try {
  // ---------- 0. Pharmacology bank sanity ----------
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const pharm = await page.evaluate(async () => {
    const mod = await import('/src/data/pharmacologyBank.js');
    return {
      count: mod.default.length,
      subjects: [...new Set(mod.default.map(q => q.subject))],
      missingAnswers: mod.default.filter(q => !q.correctAnswer).length,
      badOptions: mod.default.filter(q => !Array.isArray(q.options) || q.options.length < 2).length,
      answersInOptions: mod.default.filter(q => q.options.includes(q.correctAnswer)).length
    };
  });
  log('pharmacology bank normalized', pharm.count === 100 && pharm.missingAnswers === 0 &&
    pharm.badOptions === 0 && pharm.answersInOptions === pharm.count,
    `${pharm.count} questions, subject=${pharm.subjects.join(',')}`);

  // ---------- 1. Mode selection -> setup flow ----------
  await page.goto(`${BASE}/quiz`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.click('text=Clinical Challenge');
  await page.waitForTimeout(600);
  const step1Visible = await page.isVisible('text=Choose Difficulty');
  const progressVisible = await page.isVisible('text=Step 1 of 3');
  log('setup flow opens (Step 1: Choose Difficulty)', step1Visible && progressVisible);

  // Continue must be disabled before selection
  const continueDisabled = await page.isDisabled('button:has-text("Continue")');
  log('Continue disabled before difficulty selection', continueDisabled);

  await page.click('button:has-text("Hard")');
  await page.waitForTimeout(300);
  const continueEnabled = !(await page.isDisabled('button:has-text("Continue")'));
  log('Hard selected enables Continue', continueEnabled);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(400);

  // ---------- 2. Session parameters ----------
  const step2Visible = await page.isVisible('text=Customize Your Session');
  const counts = await page.$$eval('button', btns =>
    btns.filter(b => ['10', '20', '30', '50', '100'].includes(b.textContent.trim())).length
  );
  const examModeOption = await page.isVisible('button:has-text("Exam Mode")');
  const noLimitOption = await page.isVisible('button:has-text("No Time Limit")');
  log('Step 2: Customize Your Session', step2Visible,
    `counts=${counts >= 5}, examMode=${examModeOption}, noTimeLimit=${noLimitOption}`);

  await page.click('button:has-text("30s / Q")').catch(() => {});
  await page.click('button:has-text("Randomized")').catch(() => {});
  await page.waitForTimeout(200);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(1000);

  // ---------- 3. Review ----------
  const reviewVisible = await page.isVisible('text=Review Your Session');
  const summaryRows = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase();
    const labels = ['quiz', 'difficulty', 'questions', 'time', 'question order', 'answer mode'];
    return { ok: labels.every(l => text.includes(l)), missing: labels.filter(l => !text.includes(l)) };
  });
  log('Step 3: Review Your Session summary', reviewVisible && summaryRows.ok,
    summaryRows.ok ? '' : `missing: ${summaryRows.missing.join(',')}`);
  await page.screenshot({ path: '../opencode-setup-review.png' });

  // Edit button goes back
  await page.click('button:has-text("Edit")');
  await page.waitForTimeout(300);
  const backOnStep2 = await page.isVisible('text=Customize Your Session');
  log('Edit returns to Step 2', backOnStep2);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(300);

  // ---------- 4. Start quiz -> immersive player ----------
  await page.click('button:has-text("Start Quiz")');
  await page.waitForTimeout(900);

  const playerVisible = await page.isVisible('text=of 10'); // default 20 picked? config default is 20 unless changed; check generically below
  const questionHeader = await page.isVisible('text=/Question \\d{2}/');
  const optionCount = await page.locator('[data-testid="quiz-option"], button:has(span.flex-1.font-bold)').count();
  const bottomNavHidden = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return true;
    return getComputedStyle(nav).display === 'none' || document.body.classList.contains('quiz-active');
  });
  log('immersive player active (question header, options, nav hidden)',
    questionHeader && optionCount >= 2 && bottomNavHidden,
    `options=${optionCount}, navHidden=${bottomNavHidden}`);

  // ---------- 5. Answer -> locked -> one-look review ----------
  // Tap first option, then Confirm
  const firstOption = page.locator('button:has(span.flex-1.font-bold)').first();
  await firstOption.click();
  await page.waitForTimeout(250);
  const confirmVisible = await page.isVisible('button:has-text("Confirm Answer")');
  log('selecting an option reveals Confirm bar', confirmVisible);
  await page.click('button:has-text("Confirm Answer")');
  await page.waitForTimeout(500);

  const resultBanner = await page.isVisible('text=Result');
  const correctOrIncorrect = await page.isVisible('text=✓ Correct') || await page.isVisible('text=/✕ (Incorrect|Time Up)/');
  const yourAnswer = await page.isVisible('text=Your Answer');
  const rationaleLabel =
    (await page.isVisible('text=Why You Got It Right')) || (await page.isVisible('text=Why the Correct Answer'));
  const misalignmentIfWrong = !(await page.isVisible('text=/✕/')) || (await page.isVisible('text=Conceptual Misalignment'));
  log('one-look review renders inline',
    resultBanner && correctOrIncorrect && yourAnswer && rationaleLabel && misalignmentIfWrong);
  await page.screenshot({ path: '../opencode-review.png' });

  // Next Question button advances or completes
  const nextLabel = await page.textContent('button:has(svg):below(:text("Result"))').catch(() => null);
  const hasNext = await page.isVisible('button:has-text("Next Question")') ||
                  await page.isVisible('button:has-text("View Results")');
  log('Next Question / View Results available', hasNext);

  // ---------- 6. Exit quiz ----------
  await page.click('button[aria-label="Exit quiz"]');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Exit for now")');
  await page.waitForTimeout(600);
  const backAtModes = await page.isVisible('text=Quiz Modes');
  const navRestored = await page.evaluate(() => !document.body.classList.contains('quiz-active'));
  log('exit restores mode selection and navigation', backAtModes && navRestored);

  // ---------- 7. Quick Quiz forces 10 questions ----------
  await page.click('button:has-text("Back to Quiz Modes")').catch(() => {});
  await page.waitForTimeout(400);
  await page.click('text=Quick Quiz');
  await page.waitForTimeout(500);
  // Setup opens on Step 1 — pick a difficulty and continue
  await page.click('button:has-text("Easy")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(700);
  const quickCountsShown = await page.$$eval('button', btns =>
    btns.filter(b => /^10$|^20$|^30$|^50$|^100$/.test(b.textContent.trim())).map(b => b.textContent.trim())
  );
  log('Quick Quiz offers exactly one question count (10)', quickCountsShown.length === 1 && quickCountsShown[0] === '10',
    `counts shown: ${quickCountsShown.join(',') || 'none'}`);
  // No Exam Mode for Quick Quiz (rapid feedback identity)
  const quickExamMode = await page.locator('button:has-text("Exam Mode")').isDisabled().catch(() => 'absent');
  log('Quick Quiz locks Exam Mode (instant feedback identity)', quickExamMode === true || quickExamMode === 'absent');

  // ---------- 8. Uselu caps at 50 ----------
  await page.click('button:has-text("Back to Quiz Modes")').catch(() => {});
  await page.waitForTimeout(400);
  await page.click('text=Uselu Test Questions');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Easy")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(700);
  const useluText = await page.textContent('body');
  const useluCounts = await page.$$eval('button', btns =>
    btns.filter(b => /^10$|^20$|^30$|^50$|^100$/.test(b.textContent.trim())).map(b => b.textContent.trim())
  );
  log('Uselu setup shows bank note (61 questions), capped at 50',
    useluText.includes('61 questions') && !useluCounts.includes('100'),
    `counts: ${useluCounts.join(',')}`);

  // ---------- 9. Speed Challenge routes through setup ----------
  await page.click('button:has-text("Back to Quiz Modes")').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('text=Speed Challenge');
  await page.waitForTimeout(400);
  const speedSetup = await page.isVisible('text=Speed Challenge') && await page.isVisible('text=Choose Difficulty');
  const speedRandomLocked = await page.textContent('body');
  log('Speed Challenge opens same setup flow', speedSetup,
    speedRandomLocked.includes('always uses randomized order') ? 'order forced randomized' : '');

} catch (e) {
  console.log('FATAL:', e.message);
  results.push({ step: 'fatal', ok: false });
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
