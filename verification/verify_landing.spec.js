import { test, expect } from '@playwright/test';

test('dashboard is the primary entry point', async ({ page }) => {
  await page.goto('/');
  // Root should redirect to /dashboard
  await expect(page).toHaveURL(/.*dashboard/);
  // Header should contain "Apex Scholars"
  await expect(page.locator('header').first()).toContainText('Apex Scholars');
});

test('landing page has been removed', async ({ page }) => {
  await page.goto('/welcome');
  // /welcome no longer exists — catch-all redirects to dashboard
  await expect(page).toHaveURL(/.*dashboard/);
});

test('quiz modes are accessible', async ({ page }) => {
  await page.goto('/quiz');
  await expect(page.getByRole('heading', { name: /Quiz Modes/i })).toBeVisible();
});

test('settings shows the account center', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Account Center')).toBeVisible();
});

test('admin nav links are hidden for non-admin users (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  const sidebar = page.locator('nav');
  await expect(sidebar.getByText('Finance Admin')).toHaveCount(0);
  await expect(sidebar.getByText('Question Bank')).toHaveCount(0);
});

test('product key activation form has been removed from activate page', async ({ page }) => {
  await page.goto('/activate');
  await expect(page.getByText('Enter Product Key')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Activate with key' })).toHaveCount(0);
});
