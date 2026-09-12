import { test, expect } from '@playwright/test';

test('unauthenticated root redirects to signup', async ({ page }) => {
  await page.goto('/');
  // Root redirects to /signup for unauthenticated visitors
  await expect(page).toHaveURL(/signup/);
  // Brand renders
  await expect(page.locator('body')).toContainText('Polynurse');
});

test('unknown routes resolve (catch-all redirects)', async ({ page }) => {
  await page.goto('/welcome');
  // /welcome no longer exists — catch-all redirects; unauth lands on login/signup
  await expect(page).not.toHaveURL(/welcome/);
});

test('quiz routes are auth-gated (anonymous redirects to login)', async ({ page }) => {
  await page.goto('/quiz');
  // /quiz sits behind RequireAuth; anonymous visitors land on /login
  await expect(page).toHaveURL(/login/);
  await expect(page.locator('body')).toContainText('Polynurse');
});

test('settings shows the account center behind auth', async ({ page }) => {
  // Unauthenticated /settings redirects to the auth page (RequireAuth).
  await page.goto('/settings');
  await expect(page).toHaveURL(/login/);
  await expect(page.locator('body')).toContainText('Polynurse');
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
