import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

export const loadEnv = () => {
  const env = {};
  const p = path.join(process.cwd(), '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[2]) env[m[1]] = m[2];
    }
  }
  // Inline environment (npm script invocation) overrides the .env file.
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
};

// The app renders 3D WebGL backgrounds; headless Chromium needs software GL
// or the <body> renders empty and selectors never resolve.
export const createBrowser = () =>
  chromium.launch({ args: ['--disable-gpu', '--use-gl=swiftshader'] });

export const createLogger = () => {
  const results = [];
  return {
    results,
    log(step, ok, detail = '') {
      results.push({ step, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
    }
  };
};

export async function signupFlow(page, base, name, email, password) {
  await page.goto(`${base}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Full Name"]', name);
  await page.fill('input[placeholder="Email Address"]', email);
  await page.fill('input[placeholder="Password"]', password);
  await page.fill('input[placeholder="Confirm Password"]', password);
  await page.click('button[type="submit"]');

  await page.waitForTimeout(3000);
  const urlNow = page.url();
  const bodyText = await page.textContent('body').catch(() => '');
  const needsSignIn = urlNow.includes('/signup') && /account created/i.test(bodyText);
  if (needsSignIn) {
    await page.fill('input[placeholder="Email Address"]', email);
    await page.fill('input[placeholder="Password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  return { urlNow, needsSignIn };
}

export async function loginFlow(page, base, email, password) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Email Address"]', email);
  await page.fill('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
}

// Interval-polling text wait. rAF-based polling is unreliable here because the
// app's WebGL background starves the frame budget under software GL.
export const waitForText = (page, text, timeout = 20000) =>
  page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    text,
    { timeout, polling: 500 }
  );

export const exit = (browser, results, shotName) => {
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  browser.close();
  process.exit(failed.length ? 1 : 0);
};