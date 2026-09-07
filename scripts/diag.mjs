import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
try { await p.goto('http://localhost:5173/signup', { timeout: 20000 }); } catch (e) { errs.push('GOTO: ' + e.message); }
await p.waitForTimeout(9000);
const title = await p.title().catch(() => 'ERR');
const body = (await p.textContent('body').catch(() => '')) || '';
console.log('TITLE:', JSON.stringify(title));
console.log('URL:', p.url());
console.log('BODY(300):', JSON.stringify(body.replace(/\s+/g, ' ').slice(0, 300)));
console.log('--- ERRORS ---');
(errs.slice(0, 15)).forEach(e => console.log(e));
await b.close();
process.exit(0);
