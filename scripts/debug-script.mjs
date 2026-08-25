import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error') logs.push('[err] ' + m.text().slice(0, 200)); });
page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message.slice(0, 300)));
page.on('requestfailed', r => logs.push(`REQFAILED ${r.url().slice(0, 80)} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.url().includes('paystack.co')) logs.push(`RES ${r.status()} ${r.url().slice(0, 60)}`); });

await page.goto('http://localhost:5173/activate', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    scripts: Array.from(document.querySelectorAll('script')).map(s => s.src).filter(s => s.includes('paystack')),
    pop: typeof window.PaystackPop
  }));
  console.log(`${i}s paystack-scripts=${st.scripts.length} PaystackPop=${st.pop}`);
}
logs.forEach(l => console.log(l));
await browser.close();
