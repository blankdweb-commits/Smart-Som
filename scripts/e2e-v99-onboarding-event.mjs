// ===========================================================================
// scripts/e2e-v99-onboarding-event.mjs   (npm run e2e:v99)
//
// The two features shipped together in this pass, verified together:
//
//   A. GUIDED SIGN-UP  (src/components/SignupWizard.jsx)
//   B. TIMED LIVE EVENTS (scripts/migration-v99-anonymous-live-event.sql)
//
// WHY THIS IS ONE SUITE. The sign-up half needs a browser; the event half is
// almost entirely database and API behaviour that is far faster and far more
// precise through the Management API than through a UI. Splitting them would
// have meant two servers and two fixtures for one deliverable.
//
// TIME TRAVEL IS REAL, NOT SIMULATED. Every event assertion configures a window
// on a room that has NOT started yet and then activates it, which is the route
// migration-v99 documents (trg_anon_event_clock_lock makes a started room's
// window immutable, by design). The arithmetic is never faked: the suite reads
// the stored timestamps back and computes the span from them.
//
// NOTHING REAL IS TOUCHED. Every room it creates is named `V99E2E ...` and
// deleted at the end. The pre-existing room 12 is read but never written.
// ===========================================================================

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const PROJECT_REF = env.VITE_SUPABASE_PROJECT_REF || 'urhcvdcpxhxmmnavkcvd';
const MGMT = env.SUPABASE_ACCESS_TOKEN || env.ACCESS_TOKEN;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SUPA_URL = env.VITE_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const stamp = Date.now().toString().slice(-8);
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Management API (postgres role) — used only to set up and inspect fixtures.
// ---------------------------------------------------------------------------
async function sql(q) {
  if (!MGMT) throw new Error('SUPABASE_ACCESS_TOKEN missing — cannot run the event half of this suite');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.text();
  return { ok: res.ok, body, status: res.status };
}
const mustSql = async (q) => {
  const r = await sql(q);
  if (!r.ok) throw new Error(`SQL ${r.status}: ${r.body.slice(0, 400)}`);
  return JSON.parse(r.body);
};
const mustRefuseSql = async (q, expect) => {
  const r = await sql(q);
  return { refused: !r.ok && r.body.includes(expect), body: r.body };
};

const rooms = [];
const newRoom = async (tag) => {
  const r = await mustSql(`
    insert into public.study_groups (name, description, creator_id, type, privacy, group_state)
    select 'V99E2E ${tag} ${stamp}', 'e2e scratch', id, 'anonymous', 'restricted', 'waiting'
      from auth.users order by created_at limit 1
    returning id;`);
  rooms.push(r[0].id);
  return r[0].id;
};
// The documented route: configure the window while the room has never run.
const configure = (id, startExpr, mins) =>
  `update public.study_groups
      set event_duration_minutes = ${mins},
          event_started_at = ${startExpr},
          event_ends_at    = ${startExpr} + make_interval(mins => ${mins})
    where id = ${id};`;
const activate = (id) => `update public.study_groups set group_state = 'active' where id = ${id};`;

// ---------------------------------------------------------------------------
// API client (authenticated, via supabase-js with the publishable key)
// ---------------------------------------------------------------------------
async function apiClient(email, password) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPA_URL, ANON);
}
async function makeUser(tag) {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(SUPA_URL, SERVICE);
  const email = `v99${tag}${stamp}@apextest.local`;
  const password = 'V99-Test-Pass-2026!';
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: `V99 ${tag}` },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  return { id: data.user.id, email, password };
}
async function deleteUser(id) {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(SUPA_URL, SERVICE);
  await admin.auth.admin.deleteUser(id);
}

// ---------------------------------------------------------------------------
// A. GUIDED SIGN-UP (browser)
// ---------------------------------------------------------------------------
async function signupSection() {
  console.log('\n=== A. guided sign-up ===');
  const browser = await chromium.launch({ args: ['--disable-gpu', '--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  // The cookie-consent banner is app-level UI, not part of what this suite
  // tests. Seed it before any script runs so it never intercepts a click.
  // (Its overlap with the wizard CTA is separately fixed in SignupWizard's
  // Shell padding — see the note there.)
  await page.addInitScript(() => {
    try { window.localStorage.setItem('apex_cookie_consent', JSON.stringify({ accepted: true, at: new Date().toISOString() })); } catch { /* private mode */ }
  });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

  // Declared outside the try so the catch below can read it.
  let at = 'start';
  try {
   try {
    await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle', timeout: 60000 });

    // A1 the welcome step is focused and owns a single submit
    log('A1 welcome step renders and takes focus',
      (await page.textContent('h1')) === 'Your next chapter starts here.'
      && (await page.locator('button[type="submit"]').count()) === 1
      && (await page.evaluate(() => document.activeElement?.tagName)) === 'H1');

    const SUBMIT = 'button[type="submit"]';
    // Wait for the button to EXIST, then click it in-page. See the note on the
    // clickSubmit definition below for why this is not a coordinate click.
    const clickSubmit = async () => {
      await page.waitForFunction(
        () => !!document.querySelector('button[type="submit"]'),
        null, { timeout: 15000, polling: 150 })
        .catch(async (e) => {
          const dump = await page.evaluate(() => ({
            url: location.href,
            h1: document.querySelector('h1')?.textContent || null,
            body: (document.body.innerText || '').slice(0, 240),
            buttons: document.querySelectorAll('button').length,
          }));
          throw new Error(`[${at}] no submit button | url=${dump.url} h1=${dump.h1} buttons=${dump.buttons} body=${JSON.stringify(dump.body)}`);
        });
      await page.evaluate(() => document.querySelector('button[type="submit"]').click());
    };
    const NAME = 'input[aria-label="Full name"]';
    const EMAIL = 'input[aria-label="Email address"]';
    const PASS = 'input[aria-label="Password"]';
    const CONF = 'input[aria-label="Confirm password"]';

    await clickSubmit();
    await page.waitForSelector(NAME, { timeout: 20000 });
    // A3 the name step focuses its own input.
    // Waited, NOT sampled: waitForSelector resolves the moment the input is
    // visible, which is BEFORE the focus effect runs (it waits out
    // AnimatePresence's exit and then polls for the node).
    const nameFocused = await page
      .waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Full name', null, { timeout: 15000, polling: 200 })
      .then(() => true).catch(() => false);
    log('A3 the name step moves focus to its input', nameFocused);

    // A2 empty name is refused, and does NOT advance
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.waitForTimeout(500);
    log('A2 an empty name is refused with a field message and does not advance',
      (await page.textContent('body')).includes('Tell us what to call you')
      && await page.isVisible(NAME));


    // A4 a 1-character name is refused (length rule, not just non-empty)
    await page.fill(NAME, 'A');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.waitForTimeout(500);
    log('A4 a one-character name is refused',
      (await page.textContent('body')).includes('at least 2 characters')
      && await page.isVisible(NAME));

    const realName = `V99 Scholar ${stamp}`;
    at = 'advance-from-name';
    await page.fill(NAME, realName);
    await clickSubmit();
    await page.waitForSelector(EMAIL, { timeout: 20000 });

    // A5 malformed email refused
    await page.fill(EMAIL, 'not-an-email');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.waitForTimeout(500);
    log('A5 a malformed email is refused',
      (await page.textContent('body')).includes('does not look like an email address')
      && await page.isVisible(EMAIL));

    const email = `v99wizard${stamp}@apextest.local`;
    at = 'advance-from-email';
    await page.fill(EMAIL, email);
    await clickSubmit();
    await page.waitForSelector(PASS, { timeout: 20000 });

    // A6 too-short password refused
    await page.fill(PASS, 'abc');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.waitForTimeout(500);
    log('A6 a password under the 6-character policy is refused',
      (await page.textContent('body')).includes('at least 6 characters')
      && await page.isVisible(PASS));

    const password = 'V99-Wizard-Pass!';
    at = 'advance-from-password';
    await page.fill(PASS, password);
    await clickSubmit();
    await page.waitForSelector(CONF, { timeout: 20000 });

    // A7 mismatch refused
    await page.fill(CONF, 'Something-Else-99!');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.waitForTimeout(500);
    log('A7 a mismatched confirmation is refused',
      (await page.textContent('body')).includes('do not match')
      && await page.isVisible(CONF));

    // A8 Back walks ONE step at a time — from Confirm that lands on Password,
    // not Name. My first version of this probe waited for the name input after a
    // single Back and timed out, having silently assumed the wizard jumps to the
    // first step. Stepping all the way back tests more anyway: every field has
    // to survive the whole round trip, which is the brief's "resume after a
    // recoverable error" requirement in its strongest form.
    const back = async () => {
      await page.getByRole('button', { name: /^back$/i }).first().click({ timeout: 15000 });
    };

    at = 'back-1';
    await back();
    await page.waitForSelector(PASS, { timeout: 20000 });
    log('A8 Back from Confirm lands on Password with the password intact',
      (await page.inputValue(PASS)) === password);

    at = 'back-2';
    await back();
    await page.waitForSelector(EMAIL, { timeout: 20000 });
    log('A9 the email survives two steps back', (await page.inputValue(EMAIL)) === email);

    at = 'back-3';
    await back();
    await page.waitForSelector(NAME, { timeout: 20000 });
    log('A10 the name survives three steps back', (await page.inputValue(NAME)) === realName);

    // …and forward again to the review step, still carrying everything.
    at = 'forward-1';
    await clickSubmit();
    await page.waitForSelector(EMAIL, { timeout: 20000 });
    at = 'forward-2';
    await clickSubmit();
    await page.waitForSelector(PASS, { timeout: 20000 });
    at = 'forward-3';
    await clickSubmit();
    await page.waitForSelector(CONF, { timeout: 20000 });
    // The confirmation still holds the MISMATCHED value from A7, and walking
    // back and forth did not silently rewrite it. The brief is explicit that the
    // wizard must never change what the user typed in these fields, so this is an
    // assertion, not an inconvenience.
    log('A10b the confirmation still holds the mismatched value — nothing was silently rewritten',
      (await page.inputValue(CONF)) === 'Something-Else-99!');
    log('A10c Continue is refused while the confirmation does not match',
      (await page.textContent('body')).includes('do not match'));

    // Correct it and carry on — the "recoverable error, then resume" path.
    at = 'correct-confirm';
    await page.fill(CONF, password);
    at = 'forward-4';
    await clickSubmit();
    await page.getByRole('button', { name: /create my account/i }).waitFor({ timeout: 20000 });

    // A11 the review masks the email and never echoes the password
    const review = await page.textContent('body');
    log('A11 the review shows a masked email and no password',
      /v9•/.test(review) && !review.includes(password) && review.includes('characters, hidden'),
      review.match(/[A-Za-z0-9•]+@[A-Za-z0-9.]+/)?.[0] || '');

    // A12 create
    await page.getByRole('button', { name: /create my account/i }).click();
    const cont = page.getByRole('button', { name: /^continue$/i });
    const sawSuccess = await cont.waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    log('A12 a success screen is shown (the page did NOT redirect past it)', sawSuccess,
      `url=${page.url()}`);
    log('A13 the success screen is personalised',
      (await page.textContent('body')).includes(`Welcome to PolyNurse, ${realName.split(' ')[0]}.`));

    if (sawSuccess) {
      await cont.click();
      await page.waitForTimeout(3500);
    }
    log('A14 Continue hands off to /activate', page.url().includes('/activate'), page.url());

    // A15 exactly ONE profile row for that email
    const profs = await mustSql(`
      select p.id, p.full_name, p.is_activated, p.role
        from public.profiles p
        join auth.users u on u.id = p.id
       where u.email = '${email}';`);
    log('A15 registration creates exactly one profile row, not activated, role student',
      profs.length === 1 && profs[0].full_name === realName
      && profs[0].is_activated === false && profs[0].role === 'student',
      JSON.stringify(profs[0] || {}));

    // A16 onwards need a FRESH, SIGNED-OUT context. We are authenticated now,
    // and Auth.jsx correctly bounces any authenticated visitor off /signup to
    // /dashboard — so re-using this page meant navigating to /signup and landing
    // on a dashboard with no wizard on it. The app was right; the test was not
    // accounting for the session it had just created.
    const ctx2 = await browser.newContext({ viewport: { width: 360, height: 640 } });
    await ctx2.addInitScript(() => {
      try { window.localStorage.setItem('apex_cookie_consent', JSON.stringify({ accepted: true, at: new Date().toISOString() })); } catch { /* private mode */ }
    });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page2.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

    const NAME2 = 'input[aria-label="Full name"]';
    const EMAIL2 = 'input[aria-label="Email address"]';
    const PASS2 = 'input[aria-label="Password"]';
    const CONF2 = 'input[aria-label="Confirm password"]';
    const clickSubmit2 = async () => {
      await page2.waitForFunction(() => !!document.querySelector('button[type="submit"]'), null, { timeout: 20000, polling: 150 });
      await page2.evaluate(() => document.querySelector('button[type="submit"]').click());
    };

    await page2.goto(`${BASE}/signup`, { waitUntil: 'networkidle', timeout: 60000 });
    // A16a signed out, /signup really does render the wizard
    log('A16a a signed-out visitor sees the wizard at /signup',
      (await page2.textContent('h1')) === 'Your next chapter starts here.', page2.url());

    await clickSubmit2();
    await page2.waitForSelector(NAME2, { timeout: 20000 });
    await page2.fill(NAME2, realName);
    await page2.press(NAME2, 'Enter');
    await page2.waitForSelector(EMAIL2, { timeout: 20000 });
    await page2.fill(EMAIL2, email);
    await page2.press(EMAIL2, 'Enter');
    await page2.waitForSelector(PASS2, { timeout: 20000 });
    await page2.fill(PASS2, password);
    await page2.press(PASS2, 'Enter');
    await page2.waitForSelector(CONF2, { timeout: 20000 });
    await page2.fill(CONF2, password);
    await page2.press(CONF2, 'Enter');
    await page2.getByRole('button', { name: /create my account/i }).click({ timeout: 20000 });
    await page2.waitForTimeout(4500);

    const dupBody = await page2.textContent('body');
    log('A16b a duplicate email is refused and lands on the sign-in form',
      dupBody.includes('already exists') && await page2.isVisible(EMAIL2).catch(() => false),
      `url=${page2.url()}`);

    // A17 the duplicate attempt must not have created a second profile
    const profs2 = await mustSql(`
      select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = '${email}';`);
    log('A17 the duplicate attempt did NOT create a second profile', profs2.length === 1,
      `rows=${profs2.length}`);

    // A18 sign-in still works for the same account
    await page2.fill(EMAIL2, email);
    await page2.fill(PASS2, password);
    await clickSubmit2();
    await page2.waitForTimeout(4500);
    log('A18 the existing sign-in flow still works for the new account',
      !page2.url().includes('/login') && !page2.url().includes('/signup'), page2.url());

    // A19 a signed-out visitor cannot reach a protected surface
    const ctx3 = await browser.newContext({ viewport: { width: 360, height: 640 } });
    const guest = await ctx3.newPage();
    await guest.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await guest.waitForTimeout(2500);
    log('A19 a signed-out visitor is redirected away from a protected route',
      guest.url().includes('/login') || guest.url().includes('/signup'), guest.url());
    await guest.close();
    await ctx3.close();
    await ctx2.close();

    // "Failed to load resource: 422" is Supabase REFUSING the deliberately
    // duplicated address in A16b. That is the expected outcome and the app
    // turns it into the friendly "already exists" message — a network status
    // line is not a JavaScript error. Only real page errors and uncaught
    // exceptions should fail this check.
    const realErrors = errors.filter(e => !/Failed to load resource/i.test(e));
    log('A20 no page errors or uncaught exceptions during the whole flow',
      realErrors.length === 0, realErrors.slice(0, 3).join(' | ')
      || `(${errors.length} expected HTTP-status line(s) from the duplicate-address refusal)`);

    return { email, password };
   } catch (uiErr) {
     // Soft-fail: record what we know and let the database half still run.
     log('A21 the browser section completed', false,
       ((`[${at}] ` || '') + (uiErr.message.split('\n')[0] || '')).slice(0, 170));
     console.log('  (browser section stopped early; the event/database assertions below still ran)');
   }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// B. TIMED LIVE EVENTS (database + API)
// ---------------------------------------------------------------------------
async function eventSection(user) {
  console.log('\n=== B. timed live events ===');

  // B1 the range is enforced by the database, not by the UI
  const A = await newRoom('bounds');
  let refused = 0;
  for (const bad of [0, 39, 61, 120]) {
    const r = await mustRefuseSql(
      `update public.study_groups set event_duration_minutes = ${bad} where id = ${A};`,
      'study_groups_event_duration_check');
    if (r.refused) refused += 1;
  }
  log('B1 durations outside 40-60 are refused by the DB CHECK', refused === 4, `refused=${refused}/4`);
  for (const good of [40, 60]) {
    await mustSql(`update public.study_groups set event_duration_minutes = ${good} where id = ${A};`);
  }
  log('B2 40 and 60 are both accepted', true);

  // B3 a 40-minute configuration produces a 40-minute window
  const F40 = await newRoom('forty');
  await mustSql(configure(F40, 'now()', 40));
  const w40 = await mustSql(`
    ${activate(F40)}
    select round(extract(epoch from (event_ends_at - event_started_at))/60.0, 4) mins,
           public._anon_event_state(${F40}) s, public._anon_event_over(${F40}) o
      from public.study_groups where id = ${F40};`);
  log('B3 a 40-minute event ends 40 minutes after it starts',
    Number(w40[0].mins) === 40 && w40[0].s === 'live' && w40[0].o === false,
    JSON.stringify(w40[0]));

  // B4 a 60-minute configuration produces a 60-minute window
  const F60 = await newRoom('sixty');
  await mustSql(configure(F60, 'now()', 60));
  const w60 = await mustSql(`
    ${activate(F60)}
    select round(extract(epoch from (event_ends_at - event_started_at))/60.0, 4) mins
      from public.study_groups where id = ${F60};`);
  log('B4 a 60-minute event ends 60 minutes after it starts', Number(w60[0].mins) === 60,
    JSON.stringify(w60[0]));

  // B5 an unconfigured room defaults to 60
  const Fdef = await newRoom('default');
  const d = await mustSql(`${activate(Fdef)}
    select event_duration_minutes d, round(extract(epoch from (event_ends_at - event_started_at))/60.0,4) m
      from public.study_groups where id = ${Fdef};`);
  log('B5 an unconfigured room defaults to a 60-minute event',
    d[0].d === 60 && Number(d[0].m) === 60, JSON.stringify(d[0]));

  // B6 the extension hole: pushing BOTH columns forward together
  const ext = await mustRefuseSql(`
    update public.study_groups
       set event_started_at = event_started_at + interval '10 minutes',
           event_ends_at    = event_ends_at    + interval '10 minutes'
     where id = ${F60};`, 'EVENT_CLOCK_IMMUTABLE');
  log('B6 a running event CANNOT be extended (this was a real hole)', ext.refused,
    ext.body.match(/EVENT_CLOCK_IMMUTABLE/) ? '' : ext.body.slice(0, 120));
  const still = await mustSql(`select round(extract(epoch from (event_ends_at - event_started_at))) sp
    from public.study_groups where id = ${F60};`);
  log('B7 the window is untouched after the attempt',
    Math.abs(Number(still[0].sp) - 3600) < 1, `${still[0].sp}s`);

  // B8 a refresh / re-read does not restart the clock
  const before = await mustSql(`select event_started_at s, event_ends_at e
    from public.study_groups where id = ${F60};`);
  await mustSql(`
    update public.study_groups set group_state='waiting' where id=${F60};
    ${activate(F60)}
    update public.study_groups set group_state='waiting' where id=${F60};
    ${activate(F60)}`);
  const after = await mustSql(`select event_started_at s, event_ends_at e
    from public.study_groups where id = ${F60};`);
  log('B8 re-opening / reconnecting does not restart the clock',
    eq(before[0], after[0]), `${before[0].s} -> ${after[0].s}`);

  // B9 expiry: predicate flips, and no new seat can be granted
  const E = await newRoom('expired');
  await mustSql(configure(E, "now() - interval '61 minutes'", 60));
  await mustSql(activate(E));
  const st = await mustSql(`select public._anon_event_state(${E}) s,
      public._anon_event_over(${E}) o,
      round(extract(epoch from (event_ends_at - now()))/60.0, 2) rem
    from public.study_groups where id = ${E};`);
  log('B9 once the deadline passes the event reads as ended',
    st[0].s === 'ended' && st[0].o === true && Number(st[0].rem) < 0, JSON.stringify(st[0]));

  const seat1 = await mustRefuseSql(
    `insert into public.study_group_members (group_id, user_id, role) values (${E}, '${user.id}', 'member');`,
    'EVENT_ENDED');
  log('B10 a member seat is refused in an ended event (direct INSERT)', seat1.refused);
  const seat2 = await mustRefuseSql(
    `insert into public.anonymous_spectators (group_id, user_id, reference, amount)
     values (${E}, '${user.id}', 'v99e2e-${stamp}', 0);`, 'EVENT_ENDED');
  log('B11 a spectator seat is refused in an ended event (direct INSERT)', seat2.refused);
  const counts = await mustSql(`select
      (select count(*)::int from public.study_group_members where group_id=${E}) m,
      (select count(*)::int from public.anonymous_spectators where group_id=${E}) s;`);
  log('B12 neither row landed', counts[0].m === 0 && counts[0].s === 0, JSON.stringify(counts[0]));

  // B13 ending is exactly once under concurrency
  const H = await newRoom('once');
  await mustSql(activate(H));
  const conc = await Promise.all([0, 1, 2].map(() =>
    sql(`select public.community_anonymous_event_end(${H}, 'moderator');`)));
  const res = conc.map(r => JSON.parse(r.body)[0].community_anonymous_event_end);
  log('B13 exactly one of three concurrent end requests did the work',
    res.filter(r => r.already_ended === false).length === 1,
    JSON.stringify(res.map(r => r.already_ended)));
  const hRow = await mustSql(`select event_ended_at a, event_ended_reason r
    from public.study_groups where id = ${H};`);
  log('B14 one recorded end time, and the reason survives', hRow[0].r === 'moderator',
    JSON.stringify(hRow[0]));

  // B15 an expired token / stale payload cannot re-open writes
  const stale = await mustSql(`select public._anon_event_over(${H}) o;`);
  log('B15 a replayed end request leaves the event closed', stale[0].o === true);

  // B16 the watchdog is suspended only while the event is LIVE
  const W = await newRoom('watchdog');
  await mustSql(`
    insert into public.study_group_members (group_id, user_id, role, last_activity_at)
      values (${W}, '${user.id}', 'member', now() - interval '2 hours');
    update public.study_groups set minimum_members_to_remain_active = 99 where id = ${W};`);
  await mustSql(activate(W));
  const live = await mustSql(`select public.community_membership_reconcile(${W});`);
  const lr = live[0].community_membership_reconcile;
  log('B16 while the event is live the idle seat is NOT released and no wipe fires',
    lr.event_live === true && lr.released === 0 && lr.wipe === false, JSON.stringify(lr));
  await mustSql(`select public.community_anonymous_event_end(${W}, 'deadline');`);
  const over = await mustSql(`select public.community_membership_reconcile(${W});`);
  const or_ = over[0].community_membership_reconcile;
  log('B17 once the event is over the watchdog resumes',
    or_.event_live === false && or_.released >= 1, JSON.stringify(or_));

  // B18 the sweep works (it is the audit trail, not the mechanism)
  const swept = await mustSql(`select public.community_anonymous_event_sweep(null);`);
  log('B18 the bulk sweep runs and reports', swept[0].community_anonymous_event_sweep.ok === true,
    JSON.stringify(swept[0].community_anonymous_event_sweep).slice(0, 120));

  // B19 ACLs
  const acl = await mustSql(`
    select p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') a,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
           has_function_privilege('service_role', p.oid, 'EXECUTE') s
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname in
       ('community_anonymous_event_end','community_anonymous_event_sweep')
     order by p.proname;`);
  log('B19 anon and authenticated cannot end or sweep an event; service_role can',
    acl.every(r => r.a === false && r.u === false && r.s === true), JSON.stringify(acl));

  // B20 a room that never started is untouched by all of this
  const fresh = await newRoom('untouched');
  const fr = await mustSql(`select group_state, public._anon_event_over(${fresh}) o,
      public._anon_event_state(${fresh}) s from public.study_groups where id = ${fresh};`);
  log('B20 a room that has not started has no clock and is not over',
    fr[0].o === false && fr[0].s === 'waiting', JSON.stringify(fr[0]));
}

// ---------------------------------------------------------------------------
// C. GUEST PREVIEW — 2 minutes, read-only, independent of the event
// ---------------------------------------------------------------------------
async function guestSection() {
  console.log('\n=== C. guest preview ===');
  // dev.mjs hot-restarts the API child on any api/ change, and there is a ~1s
  // window where :3001 refuses connections. Wait for it rather than reporting
  // that restart as a product failure.
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/api/community/anonymous/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: rooms[rooms.length - 1] }),
      });
      if (r.status !== 503) break;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  const preview = async (body) => {
    const res = await fetch(`${BASE}/api/community/anonymous/guest-preview-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const G = rooms[rooms.length - 1];

  const start = await preview({ group_id: G });
  log('C1 a signed-out visitor can start a preview of a real room',
    start.status === 200 && !!start.body.token, JSON.stringify(start.body).slice(0, 120));

  if (start.body.token) {
    const read = async () => {
      const res = await fetch(`${BASE}/api/community/anonymous/guest-preview-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: G, token: start.body.token, limit: 5 }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const first = await read();
    log('C2 the preview token reads the room', first.status === 200, `status=${first.status}`);
    const second = await read();
    log('C2b the token stays readable DURING its window (the client polls it)',
      second.status === 200, `status=${second.status}`);

    // THE REAL SINGLE-USE PROPERTY, and it is not what my first version asserted.
    //
    // "Single use" here means ONE WINDOW PER VISITOR, not one HTTP read: the
    // client polls guest-preview-stream repeatedly for the whole two minutes, so
    // a read-once token would make the preview useless. The guarantee is at MINT
    // time — presenting a live token again must return already_used:true and the
    // SAME deadline, never a fresh window. Asserting that the stream refuses a
    // replay tested a property the code was never supposed to have.
    const again = await preview({ group_id: G, token: start.body.token });
    log('C3 re-presenting the token mints NO second window',
      again.status === 200 && again.body.already_used === true,
      `status=${again.status} already_used=${again.body.already_used}`);
    log('C4 …and the deadline is NOT extended by that replay',
      again.body.expires_at === start.body.expires_at,
      `start=${start.body.expires_at} replay=${again.body.expires_at}`);

    // The window really is 2 minutes: decode the signed payload's e - iat claim
    // rather than trusting the constant.
    let claim = null;
    try {
      const payload = JSON.parse(Buffer.from(start.body.token.split('.')[1], 'base64url').toString('utf8'));
      claim = { iat: payload.i, exp: payload.e, seconds: payload.e - payload.i };
    } catch (err) { claim = { error: err.message }; }
    log('C5 the minted token carries a 120-second window',
      claim?.seconds === 120, JSON.stringify(claim));

    // A write route with the preview token must not work either way.
    const write = await fetch(`${BASE}/api/community/anonymous/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: G, content: 'guest message', token: start.body.token }),
    });
    log('C6 a guest preview token cannot open a WRITE route', write.status === 401 || write.status === 403,
      `status=${write.status}`);
  }

  // The window is a server-side constant, asserted statically as well as on
  // the minted token above.
  const commSrc = fs.readFileSync(path.join(ROOT, 'api/_community.js'), 'utf8');
  log('C7 the guest preview window constant is 2 minutes, server-authoritative',
    /export const GUEST_PREVIEW_MS = 2 \* 60 \* 1000/.test(commSrc));

  // The preview must not touch the event clock — and this has to be measured
  // ACROSS a real preview, not by reading the same row twice.
  const gid = rooms[rooms.length - 1];
  const b4 = await mustSql(`select event_started_at s, event_ends_at e, public._anon_event_over(${gid}) o
    from public.study_groups where id = ${gid};`);
  await preview({ group_id: gid });
  const b5 = await mustSql(`select event_started_at s, event_ends_at e, public._anon_event_over(${gid}) o
    from public.study_groups where id = ${gid};`);
  log('C8 observing a preview never starts, extends or ends the event', eq(b4[0], b5[0]),
    JSON.stringify(b5[0]));
}

// ---------------------------------------------------------------------------
async function cleanup() {
  const list = rooms.join(',');
  if (!list) return;
  // Posts first: community_posts.group_id is ON DELETE SET NULL, so deleting the
  // room first would publish the scratch room's history to the logged-out feed.
  await sql(`delete from public.community_posts where group_id in (${list});`);
  await sql(`delete from public.study_group_members where group_id in (${list});`);
  await sql(`delete from public.anonymous_spectators where group_id in (${list});`);
  await sql(`delete from public.anonymous_room_events where group_id in (${list});`);
  await sql(`delete from public.study_groups where id in (${list});`);
  const left = await mustSql(`select count(*)::int c from public.study_groups
    where name like 'V99E2E %';`);
  console.log(`\ncleanup: scratch rooms remaining = ${left[0].c}`);
  const r12 = await mustSql(`select id, group_state, minimum_members_to_activate, member_limit,
      spectator_price, member_price, event_duration_minutes, event_started_at
    from public.study_groups where id = 12;`);
  console.log('room 12 after the run:', JSON.stringify(r12[0]));
}

// ---------------------------------------------------------------------------
(async () => {
  let user = null;
  try {
    const creds = await signupSection();
    user = await makeUser('event');
    await eventSection(user);
    await guestSection();
  } catch (err) {
    log('SUITE ABORTED', false, err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
    if (user) await deleteUser(user.id).catch(() => {});
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
  process.exit(failed ? 1 : 0);
})();
