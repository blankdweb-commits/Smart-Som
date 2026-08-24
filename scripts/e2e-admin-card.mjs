import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Admin creates a question via /admin/questions -> must persist as a GLOBAL card (user_id IS NULL)
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const stamp = Date.now().toString().slice(-6);
const QUESTION = `E2E admin global card ${stamp}: primary survey initial step?`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let ok = false;

try {
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Email Address"]', 'admin@apexscholars.com');
  await page.fill('input[placeholder="Password"]', 'changeme123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  await page.goto('http://localhost:5173/admin/questions', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // open the form modal (wait for lazy page + bank to finish rendering)
  const newBtn = page.locator('button', { hasText: 'New Question' }).first();
  await newBtn.waitFor({ state: 'visible', timeout: 30000 });
  await newBtn.click();
  await page.waitForTimeout(600);

  await page.fill('input[placeholder="e.g., Anatomy"]', 'E2E Subject');
  await page.fill('input[placeholder="e.g., Cardiac Cycle"]', 'E2E Topic');
  await page.fill('textarea[placeholder="Front of card..."]', QUESTION);
  await page.fill('textarea[placeholder="Key answer..."]', 'Check scene safety.');
  const submitBtn = page.locator('form button[type="submit"]').last();
  await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
  await submitBtn.click();
  await page.waitForTimeout(3000);
  console.log('  (modal still open after submit:', await page.locator('textarea[placeholder="Front of card..."]').count() > 0, ')');

  // Verify in DB: global card => user_id is null
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/custom_flashcards?select=id,question,user_id&question=eq.${encodeURIComponent(QUESTION)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  })).json();

  ok = (rows || []).length === 1 && rows[0].user_id === null;
  console.log(`${ok ? 'PASS' : 'FAIL'}  admin card persisted as GLOBAL (user_id null)`, JSON.stringify(rows[0] || {}));

  // And visible to an anonymous reader via the client query path
  const anon = await (await fetch(`${SUPABASE_URL}/rest/v1/custom_flashcards?select=id&question=eq.${encodeURIComponent(QUESTION)}`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY }
  })).json();
  const anonOk = (anon || []).length === 1;
  console.log(`${anonOk ? 'PASS' : 'FAIL'}  global card readable anonymously`);
  ok = ok && anonOk;

} catch (e) {
  console.log('FAIL  admin flow —', e.message.slice(0, 200));
} finally {
  await page.screenshot({ path: 'test-results/e2e-admin-card.png' });
  await browser.close();
  process.exit(ok ? 0 : 1);
}
