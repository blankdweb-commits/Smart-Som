// verification/verify_cache_security.spec.js
//
// Browser-network assertions for the caching/performance layer:
//   - the ~4.2 MB flashcard question-bank chunk must NEVER be fetched during an
//     anonymous first paint (the disabled Flashcards feature must stay inert),
//   - the auth surface must not leak community/API traffic,
//   - the app boots cleanly with no console errors that would indicate a broken
//     cache integration.
//
// NOTE: Vercel CDN Cache-Control headers (/assets/* immutable, /index.html
// must-revalidate, /api/* private,no-store) are asserted in
// scripts/verify-deploy-config.mjs; this spec covers CLIENT behavior, which is
// what the dev-server build exercises.
import { test, expect } from '@playwright/test';

test('anonymous first paint never fetches the flashcard question-bank chunk', async ({ page }) => {
  const bankRequests = [];
  page.on('request', (req) => {
    if (/flashcard-data/.test(req.url()) || /data\/flashcards\//.test(req.url())) {
      bankRequests.push(req.url());
    }
  });

  await page.goto('/');
  // Root redirects unauth users to signup; give the shell a beat to settle.
  await expect(page).toHaveURL(/signup/, { timeout: 15000 });
  await expect(page.locator('body')).toContainText('Polynurse');

  // Shell renders = JS booted; wait extra frames so a stray lazy import would surface.
  await page.waitForTimeout(2500);

  expect(bankRequests, 'no flashcard question-bank chunk may load on first paint').toEqual([]);
});

test('anonymous auth surface makes no community/API write traffic', async ({ page }) => {
  const apiRequests = [];
  page.on('request', (req) => {
    if (/\/api\/community/.test(req.url())) apiRequests.push(req.url());
  });

  await page.goto('/login');
  await expect(page.locator('body')).toContainText('Polynurse');
  await page.waitForTimeout(2000);

  expect(apiRequests, 'community endpoints must not be hit from the auth page').toEqual([]);
});

test('app boots with no console errors from the cache integration', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page).toHaveURL(/signup/, { timeout: 15000 });
  await page.waitForTimeout(2000);

  const cacheErrors = errors.filter((e) => /cache|getCacheFirst|dedupe|subscription_plans|achievements/i.test(e));
  expect(cacheErrors, `no cache-layer console errors (got: ${cacheErrors.join(' | ')})`).toEqual([]);
});