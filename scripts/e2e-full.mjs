import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Full E2E v2: signup -> exam CRUD -> quiz difficulty progression -> flashcard session.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const BASE = 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const USER = { name: `Flow Tester ${stamp}`, email: `flow${stamp}@apextest.local`, password: 'testpass123' };

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

async function dbRest(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  });
  return res.json();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160)); });
page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message.slice(0, 160)));

try {
  // ---------- SIGN UP ----------
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Full Name"]', USER.name);
  await page.fill('input[placeholder="Email Address"]', USER.email);
  await page.fill('input[placeholder="Password"]', USER.password);
  await page.fill('input[placeholder="Confirm Password"]', USER.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  const sess = await page.evaluate(async () => {
    const mod = await import('/src/utils/supabase.js');
    const { data } = await mod.supabase.auth.getSession();
    return data.session ? data.session.user.id : null;
  });
  log('signup + session', !!sess, USER.email);

  // ---------- EXAM CRUD ----------
  await page.goto(`${BASE}/exams`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.locator('button', { hasText: 'Schedule' }).first().click();
  await page.waitForTimeout(700);
  await page.fill('input[placeholder="e.g., Medical Surgical Nursing I"]', 'Anatomy & Physiology I');
  await page.fill('input[name="date"]', '2026-12-01');
  await page.fill('input[name="time"]', '09:00');
  await page.fill('input[name="venue"]', 'Clinical Lab 1');

  // Type the topic directly + Enter (dropdown suggestion UX verified separately)
  const topicInput = page.locator('input[placeholder="Add a topic to study..."]');
  if (await topicInput.count()) {
    await topicInput.click();
    await topicInput.fill('Cell theory');
    await page.waitForTimeout(400);
    await topicInput.press('Enter');
    await page.waitForTimeout(400);
    // Also exercise the curriculum auto-add button if present
    const autoBtn = page.locator('button:has-text("Auto-add all")');
    if (await autoBtn.count()) {
      await autoBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  await page.locator('button', { hasText: 'Confirm & Schedule' }).first().click();
  await page.waitForTimeout(2500);

  let bodyText = await page.textContent('body');
  log('exam appears in UI after schedule', (bodyText || '').includes('Anatomy & Physiology I'));

  const examRows = await dbRest('exams', `select=id,title,user_id,topics&user_id=eq.${sess}&order=created_at.desc`);
  const myExam = (examRows || [])[0] || null;
  log('exam persisted in database', !!myExam && myExam.title === 'Anatomy & Physiology I', myExam ? `id=${myExam.id.slice(0, 8)}... topics=${(myExam.topics || []).length}` : 'no row');

  if (myExam) {
    // Expand the card to reveal topics checklist
    await page.locator('h3', { hasText: 'Anatomy & Physiology I' }).first().click();
    await page.waitForTimeout(600);

    // Toggle the first topic chip (inside expanded view)
    const topicChip = page.locator('button', { hasText: 'Cell theory' }).last();
    if (await topicChip.count()) {
      await topicChip.click();
      await page.waitForTimeout(2000);
      const updated = await dbRest('exams', `select=readiness,topics&id=eq.${myExam.id}`);
      const topicsCount = (updated?.[0]?.topics || []).length;
      log('topic toggle persists readiness', (updated?.[0]?.readiness || 0) > 0,
        `readiness=${updated?.[0]?.readiness}% (${topicsCount} topics, 1 completed)`);
    } else {
      log('topic toggle persists readiness', false, 'topic chip not rendered');
    }

    // Delete via ⋮ (MoreVertical) menu -> Delete -> confirm dialog
    // The ⋮ button is the FIRST button inside the exam card.
    const examCard = page.locator('div.relative.group', { hasText: 'Anatomy & Physiology I' }).first();
    await examCard.locator('button').first().click({ force: true });
    await page.waitForTimeout(600);
    page.once('dialog', d => d.accept());
    await page.locator('button', { hasText: 'Delete' }).last().click({ force: true });
    await page.waitForTimeout(2500);
    const after = await dbRest('exams', `select=id&id=eq.${myExam.id}`);
    log('exam deleted from database', (after || []).length === 0);
  }

  // ---------- QUIZ DIFFICULTY PROGRESSION ----------
  await page.goto(`${BASE}/quiz`, { waitUntil: 'networkidle' });
  // wait for the difficulty section specifically
  await page.locator('text=Choose Difficulty').waitFor({ timeout: 20000 });
  bodyText = await page.textContent('body');
  log('difficulty screen renders', true);
  log('Expert locked for new user', (bodyText || '').includes('Complete 3 Hard levels to unlock'));
  log('Master locked for new user', (bodyText || '').includes('Complete 10 Expert levels to unlock'));
  log('Extreme locked for new user', (bodyText || '').includes('Complete 14 Master levels to unlock'));

  const expertDisabled = await page.locator('button:has-text("Expert")').first().isDisabled();
  log('Expert button disabled', expertDisabled === true);

  await page.locator('button:has-text("Easy")').first().click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Quick Quiz' }).first().click();

  // Answer loop: option -> FINAL ANSWER? -> rationale -> Next Challenge / Complete Quiz
  let actionsTaken = 0;
  for (let i = 0; i < 80; i++) {
    if (await page.locator('text=Session Complete').first().isVisible().catch(() => false)) break;

    const finalBtn = page.locator('button:has-text("FINAL ANSWER?")');
    const nextBtn = page.locator('button:has-text("Next Challenge"), button:has-text("Complete Quiz")').first();
    const options = page.locator('[data-testid="quiz-option"]:not([disabled])');

    if (await finalBtn.isVisible().catch(() => false)) {
      await finalBtn.evaluate(el => el.click()); // JS click beats the bounce/entry animation
      actionsTaken++;
      await page.waitForTimeout(450);
    } else if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click({ force: true });
      actionsTaken++;
      await page.waitForTimeout(450);
    } else if ((await options.count()) > 0) {
      await options.first().click({ force: true });
      actionsTaken++;
      await page.waitForTimeout(350);
    } else {
      await page.waitForTimeout(400);
    }
  }
  console.log(`  (quiz actions taken: ${actionsTaken})`);
  await page.waitForTimeout(1200);
  bodyText = await page.textContent('body');
  const quizCompleted = (bodyText || '').includes('Session Complete');
  log('quiz session completed', quizCompleted);

  if (quizCompleted) {
    await page.waitForTimeout(2500); // banner appears after the async result save
    bodyText = await page.textContent('body');
    log('pass/fail banner shown', /Level — (Passed|Not passed)/.test(bodyText || ''));

    await page.waitForTimeout(2500);
    const qr = await dbRest('quiz_results', `select=id,difficulty,score,total,passed&user_id=eq.${sess}`);
    log('quiz_results row saved', (qr || []).length > 0, JSON.stringify((qr || [])[0] || {}));

    const qp = await dbRest('user_quiz_progress', `select=level_key,difficulty,passed&user_id=eq.${sess}`);
    log('user_quiz_progress row saved', (qp || []).length > 0, JSON.stringify((qp || [])[0] || {}));

    const la = await dbRest('learning_analytics', `select=weak_topics&user_id=eq.${sess}`);
    log('learning_analytics row exists', !!la?.[0], `${((la?.[0]?.weak_topics) || []).length} weak topics`);
  }

  // ---------- FLASHCARD SESSION ----------
  await page.goto(`${BASE}/flashcards`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  bodyText = await page.textContent('body');

  // Navigate into a module first — the difficulty strip renders at subject level
  await page.locator('h3', { hasText: 'General Nursing' }).click();
  await page.waitForTimeout(900);
  const levelBtn = page.locator('h3').filter({ hasText: /^Year \d$/ }).first();
  if (await levelBtn.count()) { await levelBtn.click(); await page.waitForTimeout(900); }
  const semBtn = page.locator('h3').filter({ hasText: /^Semester \d$/ }).first();
  if (await semBtn.count()) { await semBtn.click(); await page.waitForTimeout(900); }
  const moduleBtn = page.locator('button', { hasText: 'Enter Module' }).first();
  if (await moduleBtn.count()) { await moduleBtn.click(); await page.waitForTimeout(1000); }

  bodyText = await page.textContent('body');
  const expertChip = page.locator('button:has-text("Expert")').first();
  log('flashcard difficulty strip renders', ((bodyText || '').includes('Expert') || (await expertChip.count()) > 0));
  const chipDisabled = await expertChip.isDisabled().catch(() => null);
  log('Expert chip disabled for new user', chipDisabled === true);

  const studyAll = page.locator('button', { hasText: 'Study All' }).first();
  if (await studyAll.count()) {
    await studyAll.click();
    await page.waitForTimeout(900);

    for (let i = 0; i < 200; i++) {
      if (await page.locator('text=Session Complete!').first().isVisible().catch(() => false)) break;
      const goodBtn = page.locator('button:has-text("Good")').first();
      if (await goodBtn.isVisible().catch(() => false)) {
        await goodBtn.click({ force: true });
        await page.waitForTimeout(300);
      } else {
        await page.waitForTimeout(300);
      }
    }
    await page.waitForTimeout(900);
    bodyText = await page.textContent('body');
    log('flashcard session summary shows stats', (bodyText || '').includes('Session Complete!') && (bodyText || '').includes('Cards Viewed'));
    log('summary links to quiz', (bodyText || '').includes('Continue to Quiz'));

    await page.waitForTimeout(2000);
    const uf = await dbRest('user_flashcards', `select=flashcard_id,reps,review_count,status,mastered&user_id=eq.${sess}`);
    log('SRS progress persisted to user_flashcards', (uf || []).length > 0, `${(uf || []).length} rows`);

    const prof = await dbRest('profiles', `select=cards_studied,streak,last_active_date&id=eq.${sess}`);
    log('profile stats synced (cards_studied/streak)', (prof?.[0]?.cards_studied || 0) > 0, JSON.stringify(prof?.[0] || {}));
  } else {
    log('flashcard study flow', false, '"Study All" not reachable');
  }

} catch (e) {
  log('E2E flow', false, e.message.slice(0, 200));
} finally {
  if (consoleErrors.length) {
    console.log('\nConsole errors:');
    [...new Set(consoleErrors)].forEach(c => console.log('  -', c));
  }
  await page.screenshot({ path: 'test-results/e2e-full-final.png' });
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
  process.exit(failed ? 1 : 0);
}
