// scripts/e2e-community-ephemeral.mjs
//
// E2E: the post-reset single general feed + ephemeral lifecycle (server-driven).
//   1. A fresh signup lands on /community with ONE unified feed — the legacy
//      section tabs (Pharmacology, Exam Discussions, …) are gone.
//   2. A new post renders with the LIVE (active) badge because last_interaction
//      is fresh.
//   3. Injected time: after created_at/last_interaction_at are backdated past
//      the 110s cold window the SAME post must badge EXPIRING SOON (`gone …`)
//      after a refetch — expiry state comes from the server view, never the
//      client clock.
//   4. Backdating past the 1h life removes the post from the feed entirely.
//
// Requires the dev server (serve-api :3001 + vite :5173) and the migration v29
// applied. Admin backdating uses SUPABASE_SERVICE_ROLE_KEY. Run:
//   npm run e2e:community-ephemeral
import { createClient } from '@supabase/supabase-js';
import {
  loadEnv,
  createBrowser,
  createLogger,
  signupFlow,
  waitForText,
  exit
} from './e2e-utils.mjs';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const postText = `E2E ephemeral post ${stamp} — will fade and vanish.`;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const tester = createLogger();
const browser = await createBrowser();
let page;

try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const email = `eph${stamp}@apextest.local`;
  await signupFlow(page, BASE, `Ephemeral Tester ${stamp}`, email, 'testpass123');
  tester.log('signup', true, email);

  // ---------- 1. SINGLE GENERAL FEED (no section tabs) ----------
  await page.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
  await waitForText(page, 'Community').catch(() => {});
  const noLegacyTabs = ['Pharmacology', 'Clinical Questions', 'Exam Discussions', 'Clinical Experience', 'School Communities'];
  for (const label of noLegacyTabs) {
    const count = await page.locator('button', { hasText: label }).count().catch(() => 0);
    tester.log(`no legacy section tab "${label}"`, count === 0, `tab count ${count}`);
  }

  // ---------- 2. NEW POST IS LIVE ----------
  const composer = page.locator('textarea');
  if (!(await composer.count())) throw new Error('Composer textarea not found');
  await composer.first().fill(postText);
  await page.locator('button', { hasText: /^Post$/ }).first().click();

  let liveBadge = false;
  try {
    await waitForText(page, 'Live', 15000);
    const card = page.locator('div', { hasText: postText }).last();
    liveBadge = ((await card.textContent()) || '').includes('Live');
  } catch { /* fall through */ }
  tester.log('new post shows the LIVE badge', liveBadge);

  // ---------- 3. INJECTED TIME → COLD (110s window passed) ----------
  const { data: row } = await admin
    .from('community_posts')
    .select('*')
    .eq('content', postText)
    .maybeSingle();
  const postId = row?.id;
  tester.log('post row found for time injection', !!postId, String(postId));

  if (postId) {
    const aged = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    await admin
      .from('community_posts')
      .update({ created_at: aged, last_interaction_at: aged })
      .eq('id', postId);

    await page.reload({ waitUntil: 'networkidle' });
    let coldBadge = false;
    let goneText = false;
    try {
      await waitForText(page, 'Expiring soon', 15000);
      const card = page.locator('div', { hasText: postText }).last();
      const cardText = (await card.textContent()) || '';
      coldBadge = cardText.includes('Expiring soon');
      goneText = cardText.includes('gone');
    } catch { /* fall through */ }
    tester.log('injected-cold post badges EXPIRING SOON', coldBadge);
    tester.log('injected-cold post appends "· gone …"', goneText);
    let liveGone = true;
    if (await page.locator('div', { hasText: postText }).last().isVisible().catch(() => false)) {
      liveGone = !(((await page.locator('div', { hasText: postText }).last().textContent()) || '').includes('Live'));
    }
    tester.log('cold post is NOT badged LIVE', liveGone);

    // ---------- 4. INJECTED TIME → PAST 1h LIFE → GONE ----------
    const wiped = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    await admin
      .from('community_posts')
      .update({ created_at: wiped, last_interaction_at: wiped })
      .eq('id', postId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const bodyAfter = (await page.textContent('body')) || '';
    tester.log('expired (1h+) post removed from the feed', !bodyAfter.includes(postText));

    // Pick it back up so its comment cascade is gone when cleanup purges it.
    await admin.from('community_posts').update({ is_deleted: true }).eq('id', postId);
  }

  await page.screenshot({ path: 'test-results/e2e-community-ephemeral.png' });
  await page.close();
} catch (e) {
  tester.log('E2E community ephemeral flow', false, e.message);
} finally {
  exit(browser, tester.results);
}