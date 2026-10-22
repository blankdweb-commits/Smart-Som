// TEMP QA probe: proves the Warhall header Back button walks one screen up
// (picker -> hub, bots -> picker) instead of leaving /rumble.
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const BASE = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const rand = () => Math.random().toString(36).slice(2, 7);
const PASSWORD = 'ApexTest!2345';
const email = `rumbleback${stamp}${rand()}@apextest.local`;

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const ok = (name, detail = '') => { results.push({ name, pass: true }); console.log(`PASS  ${name}${detail ? `  [${detail}]` : ''}`); };
const fail = (name, err) => { results.push({ name, pass: false }); console.log(`FAIL  ${name}  ${err}`); };

let userId = null;
const browser = await chromium.launch({ args: ['--disable-gpu', '--use-gl=swiftshader'] });
try {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.message}`);
  userId = data.user.id;
  const { error: upErr } = await admin.from('profiles').update({ is_activated: true }).eq('id', userId);
  if (upErr) throw new Error(`activate: ${upErr.message}`);

  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[aria-label="Email address"]', { timeout: 30000 });
    await page.fill('input[aria-label="Email address"]', email);
    await page.fill('input[aria-label="Password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);
    if (page.url().includes('/login')) throw new Error('sign-in did not leave /login');
    ok('signs in');
  } catch (err) { fail('signs in', err.message); throw err; }

  const headerBack = () => page.locator('button:has(svg)').filter({ hasText: /^(Back|War Hall|Arena|Home)$/ }).first();
  const hubTitle = () => page.getByRole('heading', { name: 'SC War Hall' }).first();

  try {
    await page.goto(`${BASE}/rumble`, { waitUntil: 'domcontentloaded' });
    await hubTitle().waitFor({ timeout: 25000 });
    ok('the hub renders', 'SC War Hall');
  } catch (err) { fail('the hub renders', err.message); throw err; }

  try {
    await page.getByRole('button', { name: /^1v1/ }).first().click();
    await page.getByRole('heading', { name: '1v1 Arena' }).waitFor({ timeout: 20000 });
    const label = (await headerBack().innerText()).trim();
    if (label !== 'War Hall') throw new Error(`header button says "${label}", expected "War Hall"`);
    ok('the picker shows a War Hall back button', label);
  } catch (err) { fail('the picker shows a War Hall back button', err.message); throw err; }

  try {
    await headerBack().click();
    await hubTitle().waitFor({ timeout: 15000 });
    if (!page.url().endsWith('/rumble')) throw new Error(`left /rumble: ${page.url()}`);
    ok('back returns to the hub without leaving the page', page.url());
  } catch (err) { fail('back returns to the hub without leaving the page', err.message); throw err; }

  try {
    await page.getByRole('button', { name: /^1v1/ }).first().click();
    await page.getByRole('heading', { name: '1v1 Arena' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: /Practise vs a Bot/i }).first().click();
    await page.getByRole('heading', { name: /Practise vs a bot/i }).waitFor({ timeout: 20000 });
    const label = (await headerBack().innerText()).trim();
    if (label !== 'Arena') throw new Error(`header button says "${label}", expected "Arena"`);
    await headerBack().click();
    await page.getByRole('heading', { name: '1v1 Arena' }).waitFor({ timeout: 15000 });
    ok('back from the bot picker returns to the Arena');
  } catch (err) { fail('back from the bot picker returns to the Arena', err.message); }

  try {
    await page.screenshot({ path: path.join(ROOT, 'scripts', '_qa-rumble-back.png') });
    ok('screenshot written');
  } catch (err) { fail('screenshot written', err.message); }
} catch (err) {
  console.error('ABORT', err.message);
} finally {
  await browser.close();
  if (userId) await admin.auth.admin.deleteUser(userId);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
