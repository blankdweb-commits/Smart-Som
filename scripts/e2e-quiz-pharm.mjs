import { chromium } from 'playwright';

// Verifies the Pharmacology bank is merged into the live non-Uselu quiz pools
// by sampling subject badges across real sessions (clinical + quick).
// Uselu sessions must contain ZERO pharmacology (excluded by design).
//
// NOTE: Batch-create is now server-authoritative (auth + per-course quota +
// 30-min cooldown + progressive difficulty locks). A fresh FREE user can run
// exactly one round per course within the 30-min cooldown and only at the
// Easy difficulty, so this runs ONE clinical + ONE uselu round of 10. For
// more rounds / higher difficulty, provision a premium or quota-reset account.
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', err => console.log('PAGEERROR:', err.message));

// Fresh signup so the user is authenticated (batch-create 401s otherwise).
const stamp = Date.now().toString().slice(-8);
const u = { name: `Pharm ${stamp}`, email: `pharm${stamp}@apextest.local`, password: 'testpass123' };
await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
await page.fill('input[placeholder="Full Name"]', u.name);
await page.fill('input[placeholder="Email Address"]', u.email);
await page.fill('input[placeholder="Password"]', u.password);
await page.fill('input[placeholder="Confirm Password"]', u.password);
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);

const subjectsSeen = new Set();
let useluPharmCount = 0;

const readSubject = async () => {
  return page.evaluate(() => {
    const badge = document.querySelector('.flex-wrap span');
    return badge ? badge.textContent.trim() : null;
  });
};

const answerOne = async () => {
  await page.locator('button:has(span.flex-1.font-bold)').first().click();
  await page.waitForTimeout(250);
  await page.click('button:has-text("Confirm Answer")');
  await page.waitForTimeout(500);
};

const runSession = async (cardText, questionsToSample) => {
  await page.goto(`${BASE}/quiz`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('text=Clinical Challenge', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.click(`text=${cardText}`);
  await page.waitForTimeout(500);
  await page.click('button:has-text("Easy")');
  await page.waitForTimeout(250);
  await page.click('button:has-text("Continue")');
  await page.waitForTimeout(600);
  await page.click('button:has-text("Continue")'); // straight to review (defaults kept)
  await page.waitForTimeout(600);
  await page.click('button:has-text("Start Quiz")');
  await page.waitForTimeout(900);

  for (let i = 0; i < questionsToSample; i++) {
    const s = await readSubject();
    if (s) subjectsSeen.add(s);
    if (cardText === 'Uselu Test Questions' && s === 'Pharmacology') useluPharmCount++;
    await answerOne();
    const isLast = await page.isVisible('button:has-text("View Results")');
    if (i === questionsToSample - 1 || isLast) break;
    await page.click('button:has-text("Next Question")');
    await page.waitForTimeout(600);
  }

  // Exit
  await page.click('button[aria-label="Exit quiz"]');
  await page.waitForTimeout(300);
  const exitBtn = page.locator('button:has-text("Exit for now")');
  if (await exitBtn.isVisible().catch(() => false)) {
    await exitBtn.click();
  }
  await page.waitForTimeout(600);
};

try {
  await runSession('Clinical Challenge', 10);
  await runSession('Uselu Test Questions', 10);

  console.log('Subjects observed in Clinical pool sessions:', [...subjectsSeen].join(', '));
  const richardBanksSeen = {
    pharmacology: [...subjectsSeen].some(s => /pharmacology/i.test(s)),
    musculoskeletal: [...subjectsSeen].some(s => /musculoskeletal/i.test(s)),
    neurological: [...subjectsSeen].some(s => /neurological/i.test(s))
  };
  console.log('Richard banks seen in live sessions:', JSON.stringify(richardBanksSeen));
  console.log('Pharmacology leaked into Uselu sessions:', useluPharmCount, '(must be 0)');

  const pass = richardBanksSeen.pharmacology && richardBanksSeen.musculoskeletal &&
    richardBanksSeen.neurological && useluPharmCount === 0;
  console.log(pass ? '\nPASS: Richard banks (pharm/msk/neuro) merged into non-Uselu pools only' : '\nFAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.log('FATAL:', e.message);
  await browser.close();
  process.exit(1);
}
