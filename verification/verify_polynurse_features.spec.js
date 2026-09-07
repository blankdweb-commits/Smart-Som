import { test, expect } from '@playwright/test';

// P0 verification: centralized metadata + brand + SEO foundation.
// Runs against public-facing routes (no authentication required).

test('index.html serves centralized brand metadata', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<title>Polynurse Exam Center | Your NCLEX Success Partner</title>');
  expect(html).toContain('content="Polynurse Exam Center"'); // theme/brand
  expect(html).toContain('og:site_name');
  expect(html).toContain('og:title');
  expect(html).toContain('canonical');
  expect(html).toContain('manifest.webmanifest');
  // Old brand must be gone from the document metadata
  expect(html).not.toContain('Apex Scholars');
});

test('robots.txt is served with valid directives', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  const ct = res.headers()['content-type'] || '';
  expect(ct).toContain('text/plain');
  const body = await res.text();
  expect(body).toContain('User-agent: *');
  expect(body).toContain('Disallow: /quiz');
  expect(body).toContain('Disallow: /dashboard');
  expect(body).toContain('Sitemap: https://www.polynurse.com.ng/sitemap.xml');
});

test('sitemap.xml is served as valid XML with public urls only', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('<?xml version="1.0"');
  expect(body).toContain('<urlset');
  expect(body).toContain('https://www.polynurse.com.ng/');
  // No private URLs in the sitemap
  expect(body).not.toContain('/dashboard');
  expect(body).not.toContain('/quiz');
});

test('manifest.webmanifest is served for PWA', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('"short_name": "Polynurse"');
  expect(body).toContain('"name": "Polynurse Exam Center"');
});

test('signup page renders the Polynurse brand and NCLEX tagline', async ({ page }) => {
  await page.goto('/signup');
  await expect(page).toHaveTitle(/Polynurse Exam Center/);
  await expect(page.locator('body')).toContainText('Polynurse Exam Center');
  await expect(page.locator('body')).toContainText('NCLEX success');
  // Old brand should not appear
  await expect(page.locator('body')).not.toContainText('Apex Scholars');
});

test('root route redirects to signup (unauthenticated)', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/signup/);
});
