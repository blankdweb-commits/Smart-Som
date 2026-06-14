import { test, expect } from '@playwright/test';

test('dashboard loads as the primary entry point', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  // Root should redirect to /dashboard
  await expect(page).toHaveURL(/.*dashboard/);
  // Header should contain "Apex Scholars"
  await expect(page.locator('h2').first()).toContainText('Apex Scholars');
});

test('quiz central is accessible', async ({ page }) => {
  await page.goto('http://localhost:5173/quiz');
  await expect(page.locator('h2').first()).toContainText('Quiz Central');
});

test('settings is accessible', async ({ page }) => {
  await page.goto('http://localhost:5173/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
