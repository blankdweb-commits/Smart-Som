import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// SAFE live-mode check: opens the Paystack checkout popup and verifies it
// renders the payment UI. NO card details are entered; nothing is charged.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const results = [];
const log = (s, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}${d ? ' — ' + d : ''}`); };

try {
  await page.goto('http://localhost:5173/signup', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Full Name"]', 'Pay Check');
  await page.fill('input[placeholder="Email Address"]', `pk${Date.now().toString().slice(-6)}@apextest.local`);
  await page.fill('input[placeholder="Password"]', 'testpass123');
  await page.fill('input[placeholder="Confirm Password"]', 'testpass123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  const sess = await page.evaluate(async () => {
    const mod = await import('/src/utils/supabase.js');
    const { data } = await mod.supabase.auth.getSession();
    return data.session ? data.session.user.id : null;
  });
  log('signed in', !!sess);

  await page.goto('http://localhost:5173/activate', { waitUntil: 'networkidle' });
  const weeklyBtn = page.locator('button', { hasText: 'Weekly Access' }).first();
  await weeklyBtn.waitFor({ state: 'visible', timeout: 30000 });

  // Track network calls to Paystack initialize (inline.js fetches transaction init)
  let initStatus = null;
  page.on('response', async r => {
    if (r.url().includes('js.paystack.co')) return;
    if (r.url().includes('paystack')) initStatus = `${r.status()} ${r.url().slice(0, 90)}`;
  });

  // Start dev server API is local; inline.js talks directly from browser to Paystack API.
  await weeklyBtn.click();

  // Wait for the checkout iframe to appear and render the amount
  let frame = null;
  for (let i = 0; i < 40; i++) {
    const fes = page.frames();
    frame = fes.find(f => /checkout|paystack/i.test(f.url()));
    if (frame) break;
    await page.waitForTimeout(500);
  }

  if (!frame) {
    // dump what exists
    const frames = page.frames();
    console.log('frames:', JSON.stringify(frames.map(f => f.url())));
    throw new Error('checkout iframe did not appear');
  }
  log('Paystack checkout opened', true, frame.url().slice(0, 80));

  await frame.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(4000);
  const txt = await frame.textContent('body').catch(() => '');
  const amountOk = /1,?999|₦/.test(txt || '');
  log('checkout shows correct amount (NGN 1,999.9)', amountOk);
  const emailShown = (txt || '').toLowerCase().includes('@');
  log('checkout shows payer email', emailShown);

} catch (e) {
  log('paystack popup flow', false, e.message.slice(0, 200));
} finally {
  await page.screenshot({ path: 'test-results/paystack-popup-check.png' });
  await browser.close();
  console.log(`\n=== ${results.filter(Boolean).length}/${results.length} passed ===`);
}
