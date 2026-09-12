// verification/verify_mobile.spec.js
//
// Mobile regression matrix for the redeployment checklist. The primary community
// and quiz surfaces must lay out cleanly (no horizontal overflow) at every
// common mobile viewport, and the auth gating must hold at those sizes.
//
// Requires the dev server (playwright.config.js starts `npm run dev`).
import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: '320x568 iPhone SE 1st gen', width: 320, height: 568 },
  { name: '360x800 small Android', width: 360, height: 800 },
  { name: '375x812 iPhone X/XS/11 Pro', width: 375, height: 812 },
  { name: '390x844 iPhone 12-14', width: 390, height: 844 },
  { name: '412x915 Pixel 7 / large Android', width: 412, height: 915 },
  { name: '430x932 iPhone 14 Pro Max', width: 430, height: 932 },
];

const assertNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not horizontally overflow the viewport').toBe(false);
};

for (const vp of VIEWPORTS) {
  test.describe(`mobile ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('auth page renders without horizontal overflow', async ({ page }) => {
      await page.goto('/login');
      await expect(page).toHaveURL(/login/);
      await expect(page.locator('body')).toContainText('Polynurse');
      await assertNoHorizontalOverflow(page);
    });

    test('/quiz (anon) redirects to login without overflow', async ({ page }) => {
      await page.goto('/quiz');
      await expect(page).toHaveURL(/login/);
      await assertNoHorizontalOverflow(page);
    });

    test('/community (anon) redirects to login without overflow', async ({ page }) => {
      await page.goto('/community');
      await expect(page).toHaveURL(/login/);
      await assertNoHorizontalOverflow(page);
    });
  });
}