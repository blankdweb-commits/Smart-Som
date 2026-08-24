import { chromium } from 'playwright';

const ROUTES = ['/', '/dashboard', '/flashcards', '/quiz', '/exams', '/papers', '/activate', '/payments', '/settings', '/community', '/pronunciation', '/admin/finance', '/admin/questions'];

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(`[${page.url()}] ${msg.text()}`); });
page.on('pageerror', err => errors.push(`[${page.url()}] PAGEERROR: ${err.message}`));

for (const route of ROUTES) {
  await page.goto(`http://localhost:5173${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => errors.push(`[${route}] GOTO FAIL: ${e.message}`));
  await page.waitForTimeout(800);
}

console.log(errors.length === 0 ? 'NO CONSOLE/PAGE ERRORS ACROSS ALL ROUTES' : `ERRORS (${errors.length}):\n` + errors.join('\n'));
await browser.close();
