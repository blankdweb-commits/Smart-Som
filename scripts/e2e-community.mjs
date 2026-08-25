import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// E2E: signup a brand-new user via the UI -> community page -> create post -> like it.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const BASE = 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const TEST_USER = {
  name: `Test Scholar ${stamp}`,
  email: `scholar${stamp}@apextest.local`,
  password: 'testpass123'
};

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile-first viewport
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

try {
  // ---------- 1. SIGNUP ----------
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });

  await page.fill('input[placeholder="Full Name"]', TEST_USER.name);
  await page.selectOption('select', { index: 2 }).catch(() => {}); // nursing year optional
  await page.fill('input[placeholder="Email Address"]', TEST_USER.email);
  await page.fill('input[placeholder="Password"]', TEST_USER.password);
  await page.fill('input[placeholder="Confirm Password"]', TEST_USER.password);
  await page.click('button[type="submit"]');

  // Either auto-session -> redirected, or success message asking to sign in.
  await page.waitForTimeout(3000);
  const urlNow = page.url();
  const bodyText = await page.textContent('body');
  const needsSignIn =
    urlNow.includes('/signup') &&
    /account created/i.test(bodyText || '');

  if (needsSignIn) {
    log('signup', true, `email confirmation enabled; signing in as ${TEST_USER.email}`);
    await page.fill('input[placeholder="Email Address"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  } else {
    log('signup', true, `${TEST_USER.email} (auto-session)`);
  }

  // ---------- 2. VERIFY SESSION + PROFILE SYNC ----------
  await page.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const sessionState = await page.evaluate(async () => {
    const mod = await import('/src/utils/supabase.js');
    if (!mod.supabase) return { configured: false };
    const { data } = await mod.supabase.auth.getSession();
    if (!data.session) return { configured: true, session: false };
    const { data: prof } = await mod.supabase.from('profiles').select('*').eq('id', data.session.user.id).maybeSingle();
    return { configured: true, session: true, email: data.session.user.email, profile: prof };
  });

  log('session exists', !!sessionState.session, sessionState.email || '');
  log('profile row created by trigger', !!sessionState.profile,
      sessionState.profile ? `role=${sessionState.profile.role}, full_name="${sessionState.profile.full_name}"` : 'profiles row MISSING');

  // ---------- 3. CREATE A POST ----------
  const postText = `E2E test post ${stamp} — hello Apex Scholars!`;
  const composer = page.locator('textarea');
  if (!(await composer.count())) throw new Error('Composer textarea not found');
  await composer.first().fill(postText);
  await page.locator('button', { hasText: /^Post$/ }).first().click();

  // Wait for realtime/refetch to show the post (realtime latency can vary)
  let appeared = true;
  try {
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      postText,
      { timeout: 15000 }
    );
  } catch {
    appeared = false;
  }
  const feedText = await page.textContent('body');
  log('post appears in feed', appeared && (feedText || '').includes(postText));

  // ---------- 4. REACT (LIKE) TO OWN POST ----------
  // Find the like button within the article containing our post text.
  const likeBtn = page.locator(`button:has-text("${postText.slice(0, 20)}")`).locator('..');
  void likeBtn;

  // More robust: find all like buttons; click the one inside our post's card.
  // The Community card structure: heart button with count next to MessageCircle etc.
  // We locate the post card by its content then descend.
  const card = page.locator('div.rounded-\\[2rem\\]', { hasText: postText }).last();
  const heartButton = card.locator('button').filter({ has: page.locator('svg.lucide-heart') }).first();
  await heartButton.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});

  if (await heartButton.count() === 0) {
    log('like button found', false, 'no heart icon in post card');
  } else {
    const beforeCount = parseInt((await heartButton.textContent()).replace(/[^0-9]/g, '') || '0', 10);
    await heartButton.click();
    await page.waitForTimeout(2000);
    const afterText = await heartButton.textContent();
    const afterCount = parseInt((afterText || '').replace(/[^0-9]/g, '') || '0', 10);
    log('like applied (count incremented)', afterCount === beforeCount + 1, `${beforeCount} -> ${afterCount}`);

    // Verify persisted server-side
    const dbCheck = await page.evaluate(async ({ email }) => {
      const mod = await import('/src/utils/supabase.js');
      const { data: s } = await mod.supabase.auth.getSession();
      const { data: posts } = await mod.supabase.from('community_feed').select('*').order('created_at', { ascending: false }).limit(5);
      const mine = (posts || []).find(p => p.content.includes(email ? '' : '') ) ;
      return { topPosts: (posts || []).map(p => ({ content: p.content.slice(0, 40), likes: p.like_count })) };
    }, { email: TEST_USER.email });
    const dbPost = dbCheck.topPosts.find(p => p.content.includes(postText.slice(0, 30)));
    log('like persisted in database', !!dbPost && dbPost.likes >= 1, JSON.stringify(dbPost));
  }

} catch (e) {
  log('E2E flow', false, e.message);
} finally {
  if (consoleErrors.length) {
    console.log('\nConsole errors captured:');
    consoleErrors.forEach(c => console.log('  -', c.slice(0, 200)));
  }
  await page.screenshot({ path: 'test-results/e2e-community-final.png', fullPage: false });
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}
