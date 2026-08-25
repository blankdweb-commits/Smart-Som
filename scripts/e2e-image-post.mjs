import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

// E2E: signup -> community -> attach image -> post -> image renders in feed
// and the DB row carries image_url pointing at Supabase storage.
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const BASE = 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const TEST_USER = {
  name: `Img Scholar ${stamp}`,
  email: `imgscholar${stamp}@apextest.local`,
  password: 'testpass123'
};
const IMAGE_PATH = path.join(os.tmpdir(), 'apex-test-image.png');
const POST_TEXT = `Image post test ${stamp}`;

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', err => console.log('PAGEERROR:', err.message));

try {
  // ---------- 1. Signup ----------
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Full Name"]', TEST_USER.name);
  await page.selectOption('select', { index: 2 }).catch(() => {});
  await page.fill('input[placeholder="Email Address"]', TEST_USER.email);
  await page.fill('input[placeholder="Password"]', TEST_USER.password);
  await page.fill('input[placeholder="Confirm Password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  const urlNow = page.url();
  const bodyText = await page.textContent('body');
  const needsSignIn = urlNow.includes('/signup') && /account created/i.test(bodyText || '');
  if (needsSignIn) {
    await page.fill('input[placeholder="Email Address"]', TEST_USER.email);
    await page.fill('input[placeholder="Password"]', TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }
  const session = await page.evaluate(async () => {
    const mod = await import('/src/utils/supabase.js');
    const { data } = await mod.supabase.auth.getSession();
    return data.session ? { email: data.session.user.email, id: data.session.user.id } : null;
  });
  log('signup + session', !!session, session?.email || '');
  if (!session) throw new Error('No session — cannot continue');

  // ---------- 2. Composer: attach image ----------
  await page.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const photoBtn = page.locator('button:has-text("Photo")');
  const photoVisible = await photoBtn.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  log('Photo attach button visible', photoVisible);

  await page.setInputFiles('input[type="file"][accept="image/*"]', IMAGE_PATH);
  await page.waitForTimeout(500);
  const previewVisible = await page.isVisible('img[alt="Attachment preview"]');
  log('image preview appears', previewVisible);

  await page.fill('textarea', POST_TEXT);
  await page.click('button:has-text("Post"):not(:has(svg.loader))');
  // click the composer Post button specifically
  await page.click('button:has-text("Posting...")').catch(() => {});
  await page.waitForTimeout(4000);

  // ---------- 3. Feed renders the image ----------
  // The new post should appear at the top (realtime insert or refetch)
  const feedImg = page.locator(`img[alt="Post attachment"]`).first();
  await feedImg.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const imgSrc = await feedImg.getAttribute('src').catch(() => null);
  log('post image renders in feed', !!imgSrc, imgSrc ? imgSrc.slice(0, 90) : 'no img');
  const isStorageUrl = (imgSrc || '').includes('/storage/v1/object/public/uploads/');
  log('image served from uploads bucket', isStorageUrl);

  await page.screenshot({ path: '../opencode-image-post.png', fullPage: false });

  // ---------- 4. DB row verification ----------
  const dbRow = await page.evaluate(async ({ email, text }) => {
    const mod = await import('/src/utils/supabase.js');
    const { data: { user } } = await mod.supabase.auth.getUser();
    const { data } = await mod.supabase
      .from('community_posts')
      .select('id, content, image_url, author_id')
      .eq('author_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = data?.[0];
    return row ? { content: row.content, hasImage: !!row.image_url, url: row.image_url } : null;
  }, { email: TEST_USER.email, text: POST_TEXT });
  log('DB row has image_url', !!dbRow?.hasImage, dbRow?.url ? dbRow.url.slice(0, 90) : 'null');

  // ---------- 5. Public URL is fetchable ----------
  if (dbRow?.url) {
    const imgResp = await page.request.get(dbRow.url);
    log('storage URL publicly fetchable', imgResp.ok(), `status=${imgResp.status()}`);
  }

} catch (e) {
  console.log('FATAL:', e.message);
  results.push({ step: 'fatal', ok: false });
}

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
