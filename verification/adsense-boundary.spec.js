import { test, expect } from '@playwright/test';

// Boundary suite for the controlled AdSense integration.
//
// These run WITHOUT an authenticated session on purpose: the highest-risk paths
// are the screens an anonymous/error/utility route can reach. Ads must never
// load there — not the publisher script, not an <ins> slot.
//
// (Allowed-route behaviour — Dashboard/Community/Voting — is covered by
// verification/adsense-policy.spec.mjs plus scripts/verify-deploy-config.mjs,
// which assert the route matcher and the placement wiring statically.)

const AD_HOSTS = /pagead2\.googlesyndication\.com|googleads|doubleclick\.net/;

const collectAdRequests = (page) => {
  const hits = [];
  page.on('request', (req) => {
    if (AD_HOSTS.test(req.url())) hits.push(req.url());
  });
  return hits;
};

const expectNoAds = async (page) => {
  expect(await page.locator('script[src*="adsbygoogle.js"]').count()).toBe(0);
  expect(await page.locator('.adsbygoogle').count()).toBe(0);
};

test('login screen loads no AdSense script or slot', async ({ page }) => {
  const adRequests = collectAdRequests(page);
  await page.goto('/login');
  await expect(page.locator('body')).toContainText('Polynurse');
  await page.waitForTimeout(600);
  await expectNoAds(page);
  expect(adRequests).toEqual([]);
});

test('signup screen loads no AdSense script or slot', async ({ page }) => {
  const adRequests = collectAdRequests(page);
  await page.goto('/signup');
  await expect(page.locator('body')).toContainText('Polynurse');
  await page.waitForTimeout(600);
  await expectNoAds(page);
  expect(adRequests).toEqual([]);
});

test('an auth-gated route (anonymous) shows no ads after redirect', async ({ page }) => {
  const adRequests = collectAdRequests(page);
  await page.goto('/dashboard');
  // RequireAuth bounces anonymous visitors to the auth page.
  await expect(page).toHaveURL(/login/);
  await page.waitForTimeout(600);
  await expectNoAds(page);
  expect(adRequests).toEqual([]);
});

test('quiz route (forbidden) never requests AdSense', async ({ page }) => {
  const adRequests = collectAdRequests(page);
  await page.goto('/quiz');
  await expect(page).toHaveURL(/login/);
  await page.waitForTimeout(600);
  await expectNoAds(page);
  expect(adRequests).toEqual([]);
});

test('the served document has no global AdSense loader', async ({ page }) => {
  await page.goto('/login');
  const html = await page.content();
  expect(html).not.toMatch(/pagead2\.googlesyndication\.com/);
  expect(html).not.toMatch(/adsbygoogle\.js/);
});