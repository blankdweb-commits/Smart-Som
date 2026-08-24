import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder="Email Address"]', 'admin@apexscholars.com');
  await page.fill('input[placeholder="Password"]', 'changeme123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);

  await page.goto('http://localhost:5173/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const body = await page.textContent('body');

  const checks = {
    'signed in as admin': (body || '').includes('admin@apexscholars.com'),
    'Super Admin badge shown': (body || '').includes('Super Admin'),
    'Activated badge shown': (body || '').includes('Activated'),
  };
  // Desktop: admin nav links should now appear
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  const sidebarText = await page.locator('nav').first().textContent().catch(() => '');
  checks['admin links visible in sidebar'] = (sidebarText || '').includes('Finance Admin') && (sidebarText || '').includes('Question Bank');

  let failed = 0;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? 'PASS' : 'FAIL') + '  ' + k); if (!v) failed++; }
  await page.screenshot({ path: 'test-results/admin-login-check.png' });
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error('FAIL  admin login flow —', e.message);
  await page.screenshot({ path: 'test-results/admin-login-check.png' }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
