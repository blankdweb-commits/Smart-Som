import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// E2E: signup -> create post -> REPLY to it (DB verified) ->
// Speed Challenge: bottom nav hidden + question review after wrong answer.
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) process.env[m[1]] ??= m[2];
}

const BASE = 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const TEST_USER = {
  name: `Test Scholar ${stamp}`,
  email: `scholar${stamp}@apextest.local`,
  password: 'testpass123'
};

let passed = 0, failed = 0;
const log = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  ok ? passed++ : failed++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile viewport
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

try {
  // ---------- 1. SIGNUP via /signup page ----------
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.fill('input[placeholder="Full Name"]', TEST_USER.name);
  await page.selectOption('select', { index: 2 }).catch(() => {});
  await page.fill('input[placeholder="Email Address"]', TEST_USER.email);
  await page.fill('input[placeholder="Password"]', TEST_USER.password);
  await page.fill('input[placeholder="Confirm Password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  const urlNow = page.url();
  const bodyText = await page.textContent('body');
  if (urlNow.includes('/signup') && /account created/i.test(bodyText || '')) {
    await page.fill('input[placeholder="Email Address"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  log('signup completed', !page.url().includes('/signup'), TEST_USER.email);

  // ---------- 2. CREATE POST ----------
  await page.goto(`${BASE}/community`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const postText = `Reply-test post ${stamp}`;
  await page.locator('textarea').first().fill(postText);
  await page.locator('button', { hasText: /^Post$/ }).first().click();
  let postAppeared = true;
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), postText, { timeout: 15000 });
  } catch { postAppeared = false; }
  log('post created', postAppeared);

  // ---------- 3. REPLY TO THE POST ----------
  const card = page.locator('div.rounded-\\[2rem\\]', { hasText: postText }).last();
  const replyToggle = card.locator('button', { hasText: /Repl/ }).first();
  await replyToggle.click();
  await page.waitForTimeout(1200);

  const replyInput = card.locator('input[placeholder="Write a reply..."]');
  log('reply input visible', await replyInput.count() === 1);
  await replyInput.fill(`Test reply ${stamp} — great question!`);
  // Send button = round medical-600 button next to input
  await card.locator('button.w-9.h-9').click();
  await page.waitForTimeout(2500);

  const replyShown = (await page.textContent('body') || '').includes(`Test reply ${stamp}`);
  log('reply renders in drawer after posting', replyShown);

  const dbCheck = await page.evaluate(async (content) => {
    const mod = await import('/src/utils/supabase.js');
    const { data, error } = await mod.supabase
      .from('community_comments')
      .select('id, content')
      .eq('content', content);
    return { rows: data || [], error: error?.message };
  }, `Test reply ${stamp} — great question!`);
  log('reply persisted in database', dbCheck.rows.length === 1,
      dbCheck.error ? `db error: ${dbCheck.error}` : `id=${dbCheck.rows[0]?.id}`);

  // ---------- 4. SPEED CHALLENGE — nav hidden + review on wrong ----------
  await page.goto(`${BASE}/quiz`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Speed Challenge', { timeout: 30000 });
  await page.click('text=Speed Challenge');
  await page.waitForSelector('text=Choose Difficulty', { timeout: 10000 });
  await page.click('button:has-text("Easy")');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Customize Your Session', { timeout: 10000 });
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Review Your Session', { timeout: 10000 });
  await page.click('button:has-text("Start Quiz")');
  await page.waitForTimeout(3500); // start sound + fullscreen attempt

  const navVisibleDuring = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (!nav) return false;
    const style = getComputedStyle(nav);
    return style.display !== 'none' && nav.offsetParent !== null;
  });
  log('bottom nav hidden during speed quiz', !navVisibleDuring);

  log('speed quiz fullscreen header renders', (await page.locator('text=SPEED MODE').count()) >= 1);

  // Deliberately answer wrong: tap each option until the review overlay fires.
  let reviewShown = false;
  for (let i = 0; i < 6 && !reviewShown; i++) {
    const opt = page.locator('[data-testid="quiz-option"]').nth(i);
    if (!(await opt.isVisible().catch(() => false))) break;
    await opt.click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("FINAL ANSWER?")').click();
    await page.waitForTimeout(900);
    const learningOpp = await page.locator('text=Learning Opportunity').count();
    const mastery = await page.locator('text=Mastery Confirmed').count();
    if (learningOpp > 0) { reviewShown = true; break; }
    if (mastery > 0) {
      // correct guess — speed mode skips rationale now; continue to next Q
      const advanced = await page.evaluate(() => document.body.innerText.includes('Question 2 of'));
      if (!advanced) {
        // If no auto-advance happened, click Next Challenge if present
        const nextBtn = page.locator('button:has-text("Next Challenge")');
        if (await nextBtn.count() > 0) await nextBtn.click();
        await page.waitForTimeout(700);
      }
    }
  }
  log('wrong answer triggers question review overlay', reviewShown);

  if (reviewShown) {
    log('review shows Correct Answer section', (await page.locator('text=Correct Answer').count()) >= 1);
    log('review shows Conceptual Misalignment', (await page.locator('text=Conceptual Misalignment').count()) >= 1);
    log('review shows Clinical Mentor Note', (await page.locator('text=Clinical Mentor Note').count()) >= 1);
    log('review shows One-life rule note', (await page.locator('text=One-life rule').count()) >= 1);
    log('next-button reads View Run Results', (await page.locator('button:has-text("View Run Results")').count()) >= 1);

    await page.click('button:has-text("View Run Results")');
    await page.waitForTimeout(1200);
    log('run ends at results screen', (await page.locator('text=Session Complete').count()) >= 1);
    await page.screenshot({ path: 'test-results/speed-results.png' });
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (consoleErrors.length) {
    console.log('\nConsole errors captured:');
    consoleErrors.forEach(c => console.log('  -', c.slice(0, 200)));
  }
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
} catch (e) {
  console.log('FATAL:', e.message);
  await page.screenshot({ path: 'test-results/reply-speed-fatal.png' }).catch(() => {});
  await browser.close();
  process.exit(1);
}
