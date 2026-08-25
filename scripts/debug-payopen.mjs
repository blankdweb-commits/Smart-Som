import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message.slice(0, 400)));
page.on('requestfailed', r => logs.push(`REQFAILED: ${r.url().slice(0, 100)} :: ${r.failure()?.errorText}`));

await page.goto('http://localhost:5173/signup', { waitUntil: 'networkidle' });
await page.fill('input[placeholder="Full Name"]', 'Pk');
await page.fill('input[placeholder="Email Address"]', `pkx${Date.now().toString().slice(-6)}@apextest.local`);
await page.fill('input[placeholder="Password"]', 'testpass123');
await page.fill('input[placeholder="Confirm Password"]', 'testpass123');
await page.click('button[type="submit"]');
await page.waitForTimeout(3500);

await page.goto('http://localhost:5173/activate', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Check script tag + global
const state = await page.evaluate(() => ({
  hasPaystackPop: typeof window.PaystackPop,
  scriptTags: Array.from(document.querySelectorAll('script')).map(s => s.src).filter(Boolean),
}));
console.log('PaystackPop:', state.hasPaystackPop);
console.log('scripts:', JSON.stringify(state.scriptTags.filter(s => s.includes('paystack'))));

const weeklyBtn = page.locator('button', { hasText: 'Weekly Access' }).first();
await weeklyBtn.waitFor({ state: 'visible', timeout: 30000 });

// Listen for any new windows/frames during click
page.context().on('page', p => logs.push('POPUP PAGE: ' + p.url()));
await weeklyBtn.click();
await page.waitForTimeout(8000);

const body = await page.textContent('body');
console.log('error banner shown:', /sign in first|verification failed|Invalid/i.test(body));
console.log('iframes:', await page.locator('iframe').count());
console.log('--- logs ---');
logs.forEach(l => console.log(l));
await page.screenshot({ path: 'test-results/debug-payclick.png' });
await browser.close();
