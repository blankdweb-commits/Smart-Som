import { createBrowser, loadEnv, createLogger, loginFlow, waitForText, exit } from './e2e-utils.mjs';

// E2E: per-course free-user quota + 1h cooldown using the provided free account.
//   - login with the free user
//   - confirm free (no premium)
//   - for EACH course: read quota status via API, start a round, confirm the
//     server charges exactly 10 questions + starts a 1h cooldown, and that a
//     second immediate round is BLOCKED (allowed:false)
const BASE = 'http://localhost:5173';
const EMAIL = 'blankdweb@mark.com';
const PASS = 'markrun';

const logger = createLogger();
const log = logger.log;
const browser = await createBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', e => console.log('PAGEERROR:', e.message));

const waitBody = async (re, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = (await page.textContent('body').catch(() => '')) || '';
    if (typeof re === 'string' ? body.includes(re) : re.test(body)) return true;
    await page.waitForTimeout(450);
  }
  return false;
};
const btn = (t) => page.locator('button', { hasText: t }).first();

// Call the quota API directly (via Vite proxy → serve-api on :3001) with the
// session JWT to get server-authoritative status.
async function apiQuotaStatus(sessionToken) {
  const res = await page.request.get(`${BASE}/api/quota/course-status`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function apiConsume(sessionToken, courseKey) {
  const res = await page.request.post(`${BASE}/api/quota/course-consume`, {
    headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    data: { course_key: courseKey, count: 10 }
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

const COURSES = [
  { label: 'Clinical Challenge', courseKey: 'clinical-challenge:both' },
  { label: 'Quick Quiz', courseKey: 'quick-quiz:both' },
  { label: 'Uselu Test Questions', courseKey: 'uselu-test' },
  { label: 'Fix My Weak Areas', courseKey: 'weakness-challenge' },
  { label: 'Nursing 200-Level', courseKey: 'nursing-200:Medical-Surgical Nursing' },
  { label: 'Midwifery 200-Level', courseKey: 'midwifery-200:Midwifery' }
];

try {
  // ---------- 1. Login as the free user ----------
  await loginFlow(page, BASE, EMAIL, PASS);
  const landed = /dashboard/i.test(page.url()) || await waitBody('Dashboard', 15000);
  log('free user logged in', landed, `url=${page.url()}`);

  // Grab the session token from localStorage
  const token = await page.evaluate(() => {
    try {
      const sk = (key) => localStorage.getItem(`sb-${key}-auth-token`);
      const lsKey = Object.keys(localStorage).find(k => k.includes('auth-token'));
      const raw = lsKey ? localStorage.getItem(lsKey) : null;
      let token = null;
      try { token = raw && JSON.parse(raw).access_token; } catch {}
      return token;
    } catch { return null; }
  });
  log('session token available', !!token, token ? token.slice(0, 20) + '…' : 'NONE');

  // Confirm this is a FREE user via the consume API returning premium:false
  const probeKey = 'clinical-challenge:both';
  const probe = await apiConsume(token, probeKey);
  log('quota API reachable (JSON, not HTML)', probe.status !== 200 || !!probe.body,
    `status=${probe.status}`);

  // If the API is HTML (not deployed correctly), abort with clear message.
  if (probe.status === 200 && typeof probe.body === 'string') {
    log('API returned SPA HTML — deployment routing broken (expected JSON)', false);
    exit(browser, logger.results);
    throw new Error('abort');
  }
  log('free (non-premium) server verdict in consume response', probe.body && probe.body.premium === false,
    JSON.stringify(probe.body).slice(0, 200));

  // ---------- 2. Per-course quota + cooldown ----------
  for (const course of COURSES) {
    console.log(`\n--- ${course.label} (${course.courseKey}) ---`);
    const key = course.courseKey;

    // (a) current server status BEFORE
    const before = await apiQuotaStatus(token);
    const beforeKey = before.body?.subjects?.[key];
    log(`[${course.label}] status endpoint returns JSON`, before.status === 200 && !!before.body,
      JSON.stringify(beforeKey || {}).slice(0, 160));

    // (b) try to consume a round now
    const first = await apiConsume(token, key);
    const fb = first.body || {};
    console.log('  consume#1 →', JSON.stringify(fb).slice(0, 220));

    if (beforeKey && beforeKey.is_ready === false) {
      // Already on cooldown — the FIRST consume should be blocked
      log(`[${course.label}] round blocked because already on cooldown`, fb.allowed === false,
        `allowed=${fb.allowed}`);
      log(`[${course.label}] cooldown_remaining_seconds present`, typeof fb.cooldown_remaining_seconds === 'number');
    } else {
      // Fresh round — consume should SUCCEED and charge 10 + start cooldown
      log(`[${course.label}] first round allowed`, fb.allowed === true, `allowed=${fb.allowed}`);

      // Server must charge exactly 10 questions (free clamp)
      const q = typeof fb.questions_used === 'number' ? Math.min(Number(fb.questions_used) || 0, 9999) : null;
      log(`[${course.label}] round charged 10 questions`, q === 10, `questions_used=${q}`);

      // 1h cooldown window must be set
      const cd = fb.cooldown_remaining_seconds;
      log(`[${course.label}] 1h cooldown started`, typeof cd === 'number' && cd > 0 && cd <= 3600,
        `cooldown_remaining_seconds=${cd}`);
      log(`[${course.label}] is_ready=false after round`, fb.is_ready === false, `is_ready=${fb.is_ready}`);

      // (c) IMMEDIATE second start must be BLOCKED
      const second = await apiConsume(token, key);
      const sb = second.body || {};
      console.log('  consume#2 →', JSON.stringify(sb).slice(0, 220));
      log(`[${course.label}] immediate second round BLOCKED`, sb.allowed === false,
        `allowed=${sb.allowed}`);
      log(`[${course.label}] cooldown_remaining_seconds on block`, typeof sb.cooldown_remaining_seconds === 'number' &&
        sb.cooldown_remaining_seconds > 0, `cd=${sb.cooldown_remaining_seconds}`);
    }
  }

  // ---------- 3. Verify per-course isolation (status map keyed correctly) ----------
  const after = await apiQuotaStatus(token);
  const subj = after.body?.subjects || {};
  const keys = Object.keys(subj);
  log('status map exposes per-course keys', keys.length > 0, `${keys.length} keys`);
  log('clinical-challenge present in map', !!subj['clinical-challenge:both']);
  log('quick-quiz present in map', !!subj['quick-quiz:both']);

  exit(browser, logger.results);
} catch (err) {
  if (err.message !== 'abort') console.error('ERR:', err);
  exit(browser, logger.results);
}