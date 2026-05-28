from playwright.sync_api import Page, expect, sync_playwright
import time
import os

def test_auth_error_no_supabase(page: Page):
    # Go to login page
    page.goto("http://localhost:5173/login")

    # Fill in dummy credentials
    page.fill('input[placeholder="Email Address"]', "test@example.com")
    page.fill('input[placeholder="Password"]', "password123")

    # Click Sign In
    page.click('button[type="submit"]')

    # Wait for error message
    error_locator = page.locator('p.text-red-400')
    expect(error_locator).to_be_visible()
    expect(error_locator).to_contain_text("Supabase is not configured")

    # Take screenshot
    page.screenshot(path="/home/jules/verification/auth_error.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_auth_error_no_supabase(page)
        finally:
            browser.close()
