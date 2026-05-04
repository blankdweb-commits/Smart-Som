import { test, expect } from '@playwright/test';

test('landing page loads and shows key content', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  // Check headline
  await expect(page.locator('h1')).toContainText('Nursing Success');
  await expect(page.locator('h1')).toContainText('Simplified.');

  // Check CTA
  await expect(page.getByRole('button', { name: /Start Weekly Access/i })).toBeVisible();

  // Check Pricing
  await expect(page.locator('text=₦1999.9')).toHaveCount(4); // Hero, Pricing section (twice), Sticky CTA
});

test('navigation to dashboard works', async ({ page }) => {
  await page.goto('http://localhost:5173/dashboard');
  await expect(page.locator('h2')).toContainText('Dashboard');
});
