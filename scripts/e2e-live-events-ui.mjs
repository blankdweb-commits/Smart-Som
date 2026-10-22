// ============================================================================
// scripts/e2e-live-events-ui.mjs
//
// BROWSER QA for the Anonymous Live Events surfaces (LE-V).
//
// The API suite (scripts/e2e-live-events.mjs) proves the CONTRACT against the
// live database through the real router. It cannot prove that a person can
// actually walk the flow. This suite drives the real app in a real browser at
// a 360x640 phone viewport and walks the whole round trip:
//
//   admin console : create a draft -> publish (schedule) -> start (go live)
//                   -> the member's discovery page -> close
//   participant   : the discovery page hides a draft -> shows it Upcoming ->
//                   shows it Live Now -> join -> chat -> react -> the room
//                   closes and the composer is refused
//   cross-session : a message and a reaction written by the MEMBER appear in
//                   the ADMIN's room without a reload (the room converges)
//   authority     : the console is admin-only, and a direct API write after
//                   the close is refused by the SERVER, not by the UI
//
// Two throwaway accounts (service-role created, real browser sign-in) drive
// it, and EVERY row is removed afterwards.
//
// It needs the dev stack: `npm run dev` (Vite on :5173, API on :3001).
// Override the app origin with E2E_BASE_URL.
// ============================================================================
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

// A check that may fail without stopping the run.
const attempt = async (name, fn) => {
  try {
    const detail = await fn();
    log(name, true, typeof detail === 'string' ? detail : '');
    return detail === undefined ? true : detail;
  } catch (err) {
    const msg = String(err?.message || err).split('\n')[0];
    log(name, false, msg);
    return null;
  }
};

// A check that must hold: the run cannot continue without it.
const must = async (name, fn) => {
  try {
    const detail = await fn();
    log(name, true, typeof detail === 'string' ? detail : '');
    return detail === undefined ? true : detail;
  } catch (err) {
    log(name, false, String(err?.message || err).split('\n')[0]);
    throw err;
  }
};

const env = loadEnv();
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

const admin = createClient(URL, SERVICE_KEY);
const stamp = Date.now().toString(36).slice(-6);
const rand = () => Math.random().toString(36).slice(2, 5);
const PASSWORD = 'E2E-Live-Events-UI!1';

const createdUserIds = [];
const createdEventIds = [];
const TITLE = `LE-UI-E2E ${stamp} ${rand()}`;
const DESCRIPTION = 'Browser QA event. Created by e2e-live-events-ui.';
const MESSAGE = `hello from the member ${stamp}`;

const pad2 = (n) => String(n).padStart(2, '0');
const localInputValue = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// The console re-reads its list every 30s. If a read fails, the operator can
// retry it, so the suite retries too instead of waiting out the poll.
const waitForConsoleRow = async (page, title) => {
  const row = page.locator('tbody tr').filter({ hasText: title });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await row.waitFor({ timeout: 10000 });
      return row;
    } catch {
      const retry = page.getByRole('button', { name: /Retry/ });
      if (await retry.count()) {
        await retry.first().click();
        continue;
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
  }
  const body = (await page.locator('body').innerText()).slice(0, 600);
  throw new Error(`the row never appeared. page says: ${body.replace(/\s+/g, ' ')}`);
};

const makeUser = async (role) => {
  const email = `leui${role}${stamp}${rand()}@apextest.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${role}): ${error.message}`);
  createdUserIds.push(data.user.id);
  const { error: upErr } = await admin
    .from('profiles')
    .update({ role, is_activated: true })
    .eq('id', data.user.id);
  if (upErr) throw new Error(`set role ${role}: ${upErr.message}`);
  const { data: prof } = await admin.from('profiles').select('id, role, is_activated').eq('id', data.user.id).maybeSingle();
  if (!prof) throw new Error(`no profiles row for ${data.user.id}`);
  if (prof.role !== role) throw new Error(`role not applied: ${prof.role} != ${role}`);
  return { id: data.user.id, email };
};

const cleanup = async () => {
  // Prefix-based on purpose: a crashed run still leaves its event behind, and
  // the next run must not inherit it.
  const { data: events } = await admin.from('live_events').select('id').like('title', 'LE-UI-E2E %');
  const ids = (events || []).map((e) => e.id);
  for (const id of ids) {
    try {
      const { data: msgs } = await admin.from('live_event_messages').select('id').eq('event_id', id);
      const msgIds = (msgs || []).map((m) => m.id);
      if (msgIds.length) await admin.from('live_event_reactions').delete().in('message_id', msgIds);
      await admin.from('live_event_messages').delete().eq('event_id', id);
      await admin.from('live_events').delete().eq('id', id);
    } catch (err) {
      console.error('cleanup event error', err?.message || err);
    }
  }
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch (err) {
      console.error('cleanup user error', err?.message || err);
    }
  }
};

const browser = await chromium.launch({ args: ['--disable-gpu', '--use-gl=swiftshader'] });
let exitCode = 0;

try {
  // =====================================================================
  section('P0  preflight: the app, the API and the schema must all answer');

  await must('the app is running', async () => {
    const res = await fetch(BASE, { method: 'GET' });
    if (!res.ok) throw new Error(`${BASE} answered ${res.status}`);
    return BASE;
  });

  await must('the API refuses an anonymous live-events read', async () => {
    const res = await fetch(`${BASE}/api/community/live-events/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return '401 UNAUTHORIZED';
  });

  await must('the service key can read live_events', async () => {
    const res = await fetch(`${URL}/rest/v1/live_events?select=id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) throw new Error(`REST ${res.status} ${res.statusText}`);
    return 'REST 200';
  });

  const adminUser = await makeUser('admin');
  const memberUser = await makeUser('student');

  const adminCtx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const memberCtx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const adminPage = await adminCtx.newPage();
  const memberPage = await memberCtx.newPage();

  const signIn = async (page, email) => {
    let last = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[aria-label="Email address"]', { timeout: 30000 });
      await page.fill('input[aria-label="Email address"]', email);
      await page.fill('input[aria-label="Password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(4000);
      if (!page.url().includes('/login')) return;
      last = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
      await page.waitForTimeout(2000);
    }
    throw new Error(`the sign-in form is still on screen after submitting. page says: ${last}`);
  };

  await must('the admin signs in', () => signIn(adminPage, adminUser.email));
  await must('the member signs in', () => signIn(memberPage, memberUser.email));

  // =====================================================================
  section('P1  the admin console is admin-only');

  await must('the admin reaches the console', async () => {
    await adminPage.goto(`${BASE}/admin/live-events`, { waitUntil: 'domcontentloaded' });
    await adminPage.getByRole('heading', { name: 'Live Events' }).waitFor({ timeout: 20000 });
    await adminPage.getByRole('button', { name: 'Create event' }).first().waitFor({ timeout: 20000 });
    return 'Live Events + Create event';
  });

  await must('the member is refused the console', async () => {
    await memberPage.goto(`${BASE}/admin/live-events`, { waitUntil: 'domcontentloaded' });
    await memberPage.getByRole('heading', { name: 'Admin only' }).waitFor({ timeout: 20000 });
    const create = await memberPage.getByRole('button', { name: 'Create event' }).count();
    if (create > 0) throw new Error('the member can see the Create event button');
    return 'Admin only';
  });

  // =====================================================================
  section('P2  a draft is created, and it is invisible to a member');

  const dialog = adminPage.locator('div[role="dialog"]:not(.hidden)');

  await must('the admin creates a draft', async () => {
    await adminPage.getByRole('button', { name: 'Create event' }).first().click();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    // The form's inputs, in DOM order: title, cover url, starts at, ends at.
    await dialog.locator('input').nth(0).fill(TITLE);
    await dialog.locator('textarea').first().fill(DESCRIPTION);
    await dialog.locator('input[type="datetime-local"]').nth(0).fill(localInputValue(new Date(Date.now() + 60 * 60 * 1000)));
    await dialog.locator('input[type="datetime-local"]').nth(1).fill(localInputValue(new Date(Date.now() + 120 * 60 * 1000)));
    await dialog.getByRole('button', { name: 'Create event' }).click();
    const row = adminPage.locator('tbody tr').filter({ hasText: TITLE });
    await row.waitFor({ timeout: 20000 });
    const status = (await row.locator('td').nth(1).innerText()).trim();
    if (!/draft/i.test(status)) throw new Error(`the row says "${status}", not Draft`);
    return status;
  });

  await must('the draft is hidden from the member', async () => {
    await memberPage.goto(`${BASE}/live-events`, { waitUntil: 'domcontentloaded' });
    await memberPage.getByRole('heading', { name: 'Live Events' }).waitFor({ timeout: 20000 });
    await memberPage.getByText(/Loading live events/).first().waitFor({ state: 'hidden', timeout: 20000 });
    const seen = await memberPage.locator('h3').filter({ hasText: TITLE }).count();
    if (seen > 0) throw new Error('the member can see the draft');
    return 'no draft in the discovery list';
  });

  // =====================================================================
  section('P3  publish (schedule) moves it into Upcoming');

  await must('the admin publishes the event', async () => {
    const row = adminPage.locator('tbody tr').filter({ hasText: TITLE });
    await row.locator('button[title="Edit"]').click();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
    await dialog.getByRole('button', { name: 'Publish (schedule)' }).click();
    await dialog.getByRole('button', { name: 'Start (go live)' }).waitFor({ timeout: 20000 });
    return 'scheduled';
  });

  await must('the member sees it under Upcoming', async () => {
    await memberPage.reload({ waitUntil: 'domcontentloaded' });
    await memberPage.getByText(/Loading live events/).first().waitFor({ state: 'hidden', timeout: 20000 });
    const upcoming = memberPage.locator('section').filter({
      has: memberPage.getByRole('heading', { name: 'Upcoming', exact: true }),
    });
    await upcoming.locator('h3').filter({ hasText: TITLE }).waitFor({ timeout: 20000 });
    return 'Upcoming';
  });

  // =====================================================================
  section('P4  start (go live) moves it into Live Now');

  await must('the admin starts the event', async () => {
    await dialog.getByRole('button', { name: 'Start (go live)' }).click();
    await dialog.getByRole('button', { name: 'Close event' }).waitFor({ timeout: 20000 });
    return 'live';
  });

  const viewHref = await adminPage
    .locator('tbody tr')
    .filter({ hasText: TITLE })
    .locator('a[href^="/live-events/"]')
    .getAttribute('href');
  const eventId = viewHref ? viewHref.split('/').pop() : null;
  if (!eventId) throw new Error('the console row carries no View link to the room');
  createdEventIds.push(eventId);

  await attempt('the admin closes the editor', async () => {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    return 'closed';
  });

  await must('the member sees it under Live Now and can join', async () => {
    await memberPage.reload({ waitUntil: 'domcontentloaded' });
    await memberPage.getByText(/Loading live events/).first().waitFor({ state: 'hidden', timeout: 20000 });
    const live = memberPage.locator('section').filter({
      has: memberPage.getByRole('heading', { name: 'Live Now', exact: true }),
    });
    await live.locator('h3').filter({ hasText: TITLE }).waitFor({ timeout: 20000 });
    await live.getByRole('button', { name: 'Join live event' }).click();
    await memberPage.waitForURL(`**/live-events/${eventId}`, { timeout: 20000 });
    return 'joined';
  });

  // The admin opens the room BEFORE the member writes, so the message and the
  // reaction below have to travel between two sessions.
  await must('the admin opens the room', async () => {
    await adminPage.goto(`${BASE}/live-events/${eventId}`, { waitUntil: 'domcontentloaded' });
    await adminPage.getByRole('heading', { name: TITLE }).waitFor({ timeout: 20000 });
    return eventId;
  });

  await must('the member composer is open while the event is live', async () => {
    const composer = memberPage.getByPlaceholder(/Say something/);
    await composer.waitFor({ timeout: 20000 });
    if (await composer.isDisabled()) throw new Error('the composer is disabled on a live event');
    const send = memberPage.locator('form button[type="submit"]');
    await composer.fill(MESSAGE);
    if (await send.isDisabled()) throw new Error('the Send button stays disabled with a draft');
    return 'composer enabled, Send armed';
  });

  // =====================================================================
  section('P5  the message travels between the two sessions');

  await must('the member sends a message', async () => {
    const composer = memberPage.getByPlaceholder(/Say something/);
    await composer.fill(MESSAGE);
    await memberPage.locator('form button[type="submit"]').click();
    await memberPage.locator('ul[role="log"]').getByText(MESSAGE).waitFor({ timeout: 20000 });
    return 'visible to the sender';
  });

  await must('the admin room shows the message without a reload', async () => {
    await adminPage.locator('ul[role="log"]').getByText(MESSAGE).waitFor({ timeout: 25000 });
    return 'converged';
  });

  // =====================================================================
  section('P6  the reaction travels too, and it toggles off again');

  await must('the member reacts to the message', async () => {
    await memberPage.getByRole('button', { name: /^Add reaction to message/ }).first().click();
    await memberPage.getByRole('button', { name: /^React with/ }).first().click();
    await memberPage.locator('button[aria-label*="reaction, 1"]').first().waitFor({ timeout: 20000 });
    return 'reaction, 1';
  });

  await must('the admin room shows the reaction without a reload', async () => {
    await adminPage.locator('button[aria-label*="reaction, 1"]').first().waitFor({ timeout: 25000 });
    return 'converged';
  });

  await must('the member toggles the reaction off', async () => {
    await memberPage.locator('button[aria-label*="reaction, 1"]').first().click();
    await memberPage.locator('button[aria-label*="reaction, 1"]').first().waitFor({ state: 'hidden', timeout: 20000 });
    return 'removed';
  });

  await must('the admin room sees the reaction removed', async () => {
    await adminPage.locator('button[aria-label*="reaction, 1"]').first().waitFor({ state: 'hidden', timeout: 25000 });
    return 'converged';
  });

  // =====================================================================
  section('P7  the console counts the participant, and the close is terminal');

  await must('the console counts one participant', async () => {
    await adminPage.goto(`${BASE}/admin/live-events`, { waitUntil: 'domcontentloaded' });
    const row = await waitForConsoleRow(adminPage, TITLE);
    const count = (await row.locator('td').nth(3).innerText()).trim();
    if (count !== '1') throw new Error(`the participant count is "${count}", not 1`);
    return '1 participant';
  });

  await must('the admin closes the event', async () => {
    const row = adminPage.locator('tbody tr').filter({ hasText: TITLE });
    adminPage.once('dialog', (d) => d.accept());
    await row.locator('button[title="Close"]').click();
    await row.locator('td').nth(1).getByText(/Closed/).waitFor({ timeout: 20000 });
    const cell = await row.locator('td').nth(1).innerText();
    if (!/read-only/i.test(cell)) throw new Error(`the closed row is not marked read-only: "${cell}"`);
    return 'closed, read-only';
  });

  await must('the closed row is read-only in the editor', async () => {
    const row = adminPage.locator('tbody tr').filter({ hasText: TITLE });
    const edit = row.locator('button[title="Edit"]');
    if (await edit.count() === 0) return 'the edit button is gone';
    if (!(await edit.isDisabled())) throw new Error('a closed event can still be edited');
    return 'the edit button is disabled';
  });

  // =====================================================================
  section('P8  a closed event refuses the writes, on the server');

  await must('the member room shows the closed notice', async () => {
    await memberPage.getByText(/This live event has closed/).first().waitFor({ timeout: 30000 });
    const composer = memberPage.getByPlaceholder(/This event is closed/);
    await composer.waitFor({ timeout: 20000 });
    if (!(await composer.isDisabled())) throw new Error('the composer is still enabled on a closed event');
    const send = memberPage.locator('form button[type="submit"]');
    if (!(await send.isDisabled())) throw new Error('the Send button is still enabled on a closed event');
    return 'composer refused';
  });

  await must('a direct write after the close is refused by the server', async () => {
    const token = await memberPage.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (!key.includes('auth-token')) continue;
        try {
          const parsed = JSON.parse(window.localStorage.getItem(key));
          if (parsed?.access_token) return parsed.access_token;
        } catch {
          /* not the session entry */
        }
      }
      return null;
    });
    if (!token) throw new Error('no access token in the member session');
    const res = await fetch(`${BASE}/api/community/live-events/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ event_id: eventId, content: 'after the close' }),
    });
    const body = await res.json().catch(() => null);
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
    if (body?.error !== 'EVENT_CLOSED') throw new Error(`expected EVENT_CLOSED, got ${body?.error}`);
    return '403 EVENT_CLOSED';
  });

  await must('the closed event is listed under Recently Closed', async () => {
    await memberPage.goto(`${BASE}/live-events`, { waitUntil: 'domcontentloaded' });
    await memberPage.getByText(/Loading live events/).first().waitFor({ state: 'hidden', timeout: 20000 });
    const closed = memberPage.locator('section').filter({
      has: memberPage.getByRole('heading', { name: 'Recently Closed', exact: true }),
    });
    await closed.locator('h3').filter({ hasText: TITLE }).waitFor({ timeout: 20000 });
    const card = closed.locator('li').filter({ hasText: TITLE });
    const read = card.getByRole('button', { name: /Event closed/ });
    await read.waitFor({ timeout: 10000 });
    if (!(await read.isDisabled())) throw new Error('the Read button is not read-only');
    return 'Recently Closed, read-only';
  });

  // =====================================================================
  section('P9  cleanup leaves nothing behind');

  await must('the throwaway event and messages are gone', async () => {
    await cleanup();
    const { data: events } = await admin.from('live_events').select('id').like('title', 'LE-UI-E2E %');
    if ((events || []).length) throw new Error(`${events.length} event(s) survived`);
    return '0 events';
  });

  await must('the throwaway accounts are gone', async () => {
    for (const id of createdUserIds) {
      const { data } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
      if (data) throw new Error(`the profile ${id} survived`);
    }
    return '0 profiles';
  });
} catch (err) {
  console.error('\nFATAL:', err?.message || err);
  exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (err) {
    console.error('cleanup error', err?.message || err);
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
if (failed.length) exitCode = 1;
process.exit(exitCode);
