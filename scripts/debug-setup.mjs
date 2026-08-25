import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:5173/quiz', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.click('text=Clinical Challenge');
await page.waitForTimeout(500);
await page.click('button:has-text("Hard")');
await page.waitForTimeout(250);
await page.click('button:has-text("Continue")');
await page.waitForTimeout(600);
await page.click('button:has-text("Continue")');
await page.waitForTimeout(1200);
const t = await page.textContent('body');
console.log('has Review Your Session:', t.includes('Review Your Session'));
for (const label of ['Quiz', 'Difficulty', 'Questions', 'Time', 'Question Order', 'Answer Mode']) {
  console.log(`label "${label}":`, t.includes(label));
}
console.log('--- step3 area ---');
const idx = t.indexOf('Review');
console.log(t.slice(Math.max(0, idx - 50), idx + 400));
await browser.close();
