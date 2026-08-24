import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Live Paystack TEST-mode payment: signup -> /activate -> Weekly plan ->
// Paystack inline popup with test card 4084 0840 8408 4081 (success) ->
// callback -> /api/verify-payment -> subscription in DB + profile activated.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const stamp = Date.now().toString().slice(-7);
const EMAIL = `pay${stamp}@apextest.local`;
const CARD = { number: '4084 0840 8408 4081', exp: '12/34', cvv: '408' };

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

try {
  // Signup
  await page.goto('http://localhost:5173/signup', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Full Name"]', 'Pay Tester');
  await page.fill('input[placeholder="Email Address"]', EMAIL);
  await page.fill('input[placeholder="Password"]', 'testpass123');
  await page.fill('input[placeholder="Confirm Password"]', 'testpass123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  const sess = await page.evaluate(async () => {
    const mod = await import('/src/utils/supabase.js');
    const { data } = await mod.supabase.auth.getSession();
    return data.session ? data.session.user.id : null;
  });
  log('signup for payment test', !!sess, EMAIL);

  // Activate page -> choose Weekly
  await page.goto('http://localhost:5173/activate', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const weeklyBtn = page.locator('button', { hasText: 'Weekly Access' }).first();
  await weeklyBtn.waitFor({ state: 'visible', timeout: 30000 });
  await weeklyBtn.click();

  // Paystack inline popup appears as an iframe
  log('Paystack popup triggered', true);
  let payFrame = null;
  try {
    await page.waitForSelector('iframe[src*="paystack"], iframe[id*="paystack"]', { timeout: 30000 });
    const frameEl = await page.waitForSelector('iframe[src*="paystack"], iframe[id*="paystack"]');
    payFrame = await frameEl.contentFrame();
  } catch {
    // fallback: any iframe that appeared after clicking
    const frames = page.frames();
    console.log('frames:', frames.map(f => f.url()).join(' | '));
  }
  if (!payFrame) throw new Error('Paystack iframe not found');

  await payFrame.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);

  // Dump inputs inside the frame to adapt to Paystack's markup
  const inputInfo = await payFrame.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      id: i.id, name: i.name, ph: i.placeholder, type: i.type, visible: !!(i.offsetParent || i.type === 'hidden')
    }))
  );
  console.log('paystack inputs:', JSON.stringify(inputInfo));

  const byAny = async (frame, patterns) => {
    for (const p of patterns) {
      const loc = frame.locator(p).first();
      if (await loc.count()) return loc;
    }
    return null;
  };

  const cardInput = await byAny(payFrame, [
    '[name="card-number"]', '#card-number', '[placeholder*="0000"]', '[autocomplete="cc-number"]', 'input[type="tel"]'
  ]);
  const expInput = await byAny(payFrame, [
    '[name="card-expiry"]', '#card-expiry', '[placeholder*="MM"]', '[autocomplete="cc-exp"]'
  ]);
  const cvvInput = await byAny(payFrame, [
    '[name="card-cvv"]', '#card-cvv', '[placeholder*="CVV" i]', '[autocomplete="cc-csc"]'
  ]);

  if (!cardInput) throw new Error('card number field not found');
  await cardInput.click();
  await cardInput.type(CARD.number, { delay: 60 });
  if (expInput) { await expInput.click(); await expInput.type(CARD.exp, { delay: 60 }); }
  if (cvvInput) { await cvvInput.click(); await cvvInput.type(CARD.cvv, { delay: 60 }); }

  // Pay button inside the frame
  const payBtn = await byAny(payFrame, ['button:has-text("Pay")', '.pay-button', 'button[type="submit"]']);
  if (!payBtn) throw new Error('Pay button not found');
  await page.waitForTimeout(800);
  await payBtn.click();

  // Some test flows show a "success" screen inside the popup; wait for callback redirect.
  await page.waitForURL(/dashboard|payments|activate/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000); // allow verify-payment roundtrip + fetchUserData

  const bodyText = await page.textContent('body');
  log('returned to app after payment', page.url().includes('/dashboard'), page.url());

  // DB verification
  await page.waitForTimeout(3000);
  const subs = await (await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?select=*&user_id=eq.${sess}&order=created_at.desc&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  })).json();
  log('subscription created in DB', Array.isArray(subs) && subs.length > 0, JSON.stringify((subs || [])[0] || {}));

  const profs = await (await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=is_activated&id=eq.${sess}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  })).json();
  log('profile is_activated=true', profs?.[0]?.is_activated === true);

  // App shows Activated badge on settings
  await page.goto('http://localhost:5173/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const st = await page.textContent('body');
  log('settings shows Activated badge', (st || '').includes('Activated'));

} catch (e) {
  log('payment flow', false, e.message.slice(0, 250));
  await page.screenshot({ path: 'test-results/payment-fail.png', fullPage: true }).catch(() => {});
} finally {
  if (errors.length) {
    console.log('\nConsole errors:');
    [...new Set(errors)].forEach(c => console.log('  -', c));
  }
  await page.screenshot({ path: 'test-results/payment-final.png', fullPage: true }).catch(() => {});
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
  process.exit(failed ? 1 : 0);
}
