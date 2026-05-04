import { test, expect } from '@playwright/test';

test('landing page loads and shows key content', async ({ page }) => {
  await page.goto('http://localhost:5173/');

  // Check headline
  await expect(page.locator('h1')).toContainText('Nursing Success');
  await expect(page.locator('h1')).toContainText('Simplified.');

  // Check CTA
  await expect(page.getByRole('button', { name: /Start Weekly Access/i }).first()).toBeVisible();

  // Check Pricing exists
  const pricingElements = page.locator('text=₦1999.9');
  const count = await pricingElements.count();
  expect(count).toBeGreaterThan(0);
});

test('navigation to dashboard works', async ({ page }) => {
  await page.goto('http://localhost:5173/dashboard');
  await expect(page.locator('h2')).toContainText('Dashboard');
});
