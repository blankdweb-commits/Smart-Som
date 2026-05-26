import { test, expect } from '@playwright/test';

test.use({
  baseURL: 'http://localhost:5173',
});

test('shows error when Supabase is not configured', async ({ page }) => {
  // We need to run this against a dev server with NO environment variables
  // Since we can't easily change env vars of a running process here,
  // we'll rely on the code change we made.

  await page.goto('/login');

  // Try to sign in
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'password');
  await page.click('button[type="submit"]');

  // Check for the error message we added
  const errorMessage = page.locator('p.text-red-400');
  await expect(errorMessage).toBeVisible();
  const text = await errorMessage.textContent();
  expect(text).toContain('Supabase is not configured');
});
