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

// Selectors for the auth form.
//
// These used to key on the placeholder TEXT ("Email Address", "Password", ...).
// That is display copy, and it is now exemplar copy ("e.g. amaka@gmail.com",
// "Your password") - so a copy change silently broke every browser suite. The
// inputs carry stable aria-labels; use those instead. Page.getByLabel would also
// work but the CSS form is cheaper and needs no accessible-name computation.
//
// THESE FOUR LABELS ARE A CONTRACT WITH src/components/SignupWizard.jsx. They
// have survived two rounds of copy rewrites precisely because they are not
// copy. Do not "tidy" them without updating every suite at the same time.
export const AUTH_EMAIL = 'input[aria-label="Email address"]';
export const AUTH_PASSWORD = 'input[aria-label="Password"]';
export const AUTH_NAME = 'input[aria-label="Full name"]';
export const AUTH_CONFIRM = 'input[aria-label="Confirm password"]';

// The wizard's primary action. There is exactly ONE submit button on screen at
// a time: the welcome and review steps own their own, and only the four field
// steps render the footer Continue. `button[type="submit"]` is therefore
// unambiguous, but naming it makes the intent readable at the call site.
export const WIZARD_SUBMIT = 'button[type="submit"]';

// Walks the guided registration flow to the review step, without submitting.
//
// WHY THIS IS A HELPER AND NOT FOUR page.fill() CALLS: sign-up is now a
// one-task-per-step wizard (src/components/SignupWizard.jsx), and each field
// exists in the DOM for exactly one step. page.fill() resolves against
// `document`, so a single call per field would work only while every input was
// mounted at once — the wizard deliberately unmounts them, which is also what
// makes its focus management and reduced-motion handling work. Suites call this
// instead of hand-rolling the walk.
//
// Every step awaits the input actually being present, so a regression that
// drops or reorders a step fails here with a clear timeout instead of silently
// filling the wrong field.
//
// Stops ON the review step. The caller decides whether to submit.
export async function walkSignupWizard(page, { name, email, password } = {}) {
  const values = {
    name: name ?? 'Wizard Scholar',
    email: email ?? 'wizard@invalid.local',
    password: password ?? 'wizard-placeholder',
  };

  // Step 1 of the flow is the welcome screen; it has no field, only the CTA.
  await page.waitForSelector(WIZARD_SUBMIT, { timeout: 20000 });
  await page.click(WIZARD_SUBMIT);

  await page.waitForSelector(AUTH_NAME, { timeout: 20000 });
  await page.fill(AUTH_NAME, values.name);
  await page.click(WIZARD_SUBMIT);

  await page.waitForSelector(AUTH_EMAIL, { timeout: 20000 });
  await page.fill(AUTH_EMAIL, values.email);
  await page.click(WIZARD_SUBMIT);

  await page.waitForSelector(AUTH_PASSWORD, { timeout: 20000 });
  await page.fill(AUTH_PASSWORD, values.password);
  await page.click(WIZARD_SUBMIT);

  await page.waitForSelector(AUTH_CONFIRM, { timeout: 20000 });
  await page.fill(AUTH_CONFIRM, values.password);
  await page.click(WIZARD_SUBMIT);

  // The review step. Named rather than positional because the review step also
  // renders one "Edit" button per row.
  await page.getByRole('button', { name: /create my account/i }).waitFor({ timeout: 20000 });
  return values;
}

export async function signupFlow(page, base, name, email, password) {
  await page.goto(`${base}/signup`, { waitUntil: 'networkidle' });
  await walkSignupWizard(page, { name, email, password });
  await page.getByRole('button', { name: /create my account/i }).click();

  // On success the wizard shows a confirmation screen with a single Continue
  // action; that is what hands off to /activate. Email confirmation is OFF on
  // this project, so signUp returns a live session and that screen always
  // appears. If it somehow does not, the fallback below signs in instead.
  const continued = await page
    .getByRole('button', { name: /^continue$/i })
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  if (continued) {
    await page.getByRole('button', { name: /^continue$/i }).click();
  }

  await page.waitForTimeout(3000);
  const urlNow = page.url();
  const bodyText = await page.textContent('body').catch(() => '');

  // "account created" was the old single-page success copy. The wizard does not
  // use it, so this now tests for the thing that actually matters: are we still
  // sitting on /signup with a sign-in form in front of us?
  const needsSignIn = urlNow.includes('/signup')
    && (/account created/i.test(bodyText)
      || /check your email/i.test(bodyText)
      || await page.isVisible(AUTH_EMAIL).catch(() => false));
  if (needsSignIn) {
    await page.fill(AUTH_EMAIL, email);
    await page.fill(AUTH_PASSWORD, password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  return { urlNow, needsSignIn };
}

export async function loginFlow(page, base, email, password) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill(AUTH_EMAIL, email);
  await page.fill(AUTH_PASSWORD, password);
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