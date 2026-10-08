import { test, expect } from '@playwright/test';

test('unauthenticated root renders the public crawlable landing page', async ({ page }) => {
  await page.goto('/');
  // Root no longer login-walls: unauthenticated visitors stay on "/" and get
  // the public PolyNurse landing (AdSense-safe real content).
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
  await expect(page.locator('body')).toContainText('Polynurse');
  // Real public content + clear navigation into the app
  await expect(page.getByRole('link', { name: /create a free account/i }).first()).toBeVisible();
  // Landing shows "Sign in" in BOTH the header and the hero — assert on the
  // first match (strict mode would otherwise reject the legitimate duplicate).
  await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
});

test('root landing link routes into the app signup flow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /create a free account/i }).first().click();
  await expect(page).toHaveURL(/signup/);
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
