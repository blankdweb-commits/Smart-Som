import { createBrowser, signupFlow } from './e2e-utils.mjs';

const BASE = 'http://localhost:5173';
const stamp = Date.now().toString().slice(-9);
const EMAIL = `rc${stamp}@apextest.local`;
const PASS = 'quota test 123';

const browser = await createBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
page.on('response', async (r) => {
  if (r.url().includes('/api/')) {
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch {}
    console.log(`RESP ${r.request().method()} ${r.url().replace(BASE, '')} -> ${r.status()} ${body}`);
  }
});

const waitBody = async (re, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    if (typeof re === 'string' ? body.includes(re) : re.test(body)) return { ok: true, body };
    await page.waitForTimeout(450);
  }
  return { ok: false, body: (await page.textContent('body').catch(() => '')) || '' };
};
const btn = (t) => page.locator('button', { hasText: t }).first();

await signupFlow(page, BASE, 'Repro Tester', EMAIL, PASS);
const a = await waitBody('Institutional Access', 30000);
console.log('activate:', a.ok, page.url());
await btn('Continue as Free').click();
await page.waitForTimeout(1500);
console.log('after free: url=', page.url());
await page.goto(`${BASE}/quiz`, { waitUntil: 'networkidle' }).catch(() => {});
await waitBody('Clinical Challenge', 20000);

await btn('Clinical Challenge').click();
await waitBody('Choose Difficulty', 15000);
await btn('Hard').click();
await btn('Continue').click();
await waitBody('Customize Your Session', 15000);
await waitBody('Free plan: 10 questions per round', 10000);
await btn('Continue').click();
await waitBody('Review Your Session', 15000);
console.log('--- clicking Start Quiz ---');
await btn('Start Quiz').click();
const p = await waitBody(/Question \d+ of 10/, 15000);
console.log('player visible:', p.ok);
const m = await waitBody('not ready yet', 8000).catch(() => ({ ok: false }));
const u = await waitBody('Quota service unreachable', 8000).catch(() => ({ ok: false }));
console.log('cooldown modal visible:', m.ok, '| unavailable modal visible:', u.ok);
if (!p.ok && !m.ok && !u.ok) console.log('body head:', p.body.replace(/\s+/g, ' ').slice(0, 500));

await browser.close();
process.exit(0);