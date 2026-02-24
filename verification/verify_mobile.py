from playwright.sync_api import sync_playwright

def verify_mobile():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        device = p.devices['iPhone 12']
        context = browser.new_context(**device)
        page = context.new_page()

        page.goto("http://localhost:5177/")
        page.wait_for_timeout(2000)
        page.screenshot(path="verification/mobile_home.png")

        # Click on Cards in Bottom Nav
        page.get_by_role("link", name="Cards", exact=True).click()
        page.wait_for_timeout(2000)
        page.screenshot(path="verification/mobile_cards.png")

        # Click on year 1
        page.get_by_text("Year 1").first.click()
        page.wait_for_timeout(1000)

        # Click on Semester 1
        page.get_by_text("Semester 1").first.click()
        page.wait_for_timeout(1000)

        # Click on a subject
        page.get_by_text("Foundations of Nursing").first.click()
        page.wait_for_timeout(1000)
        page.screenshot(path="verification/mobile_subject_list.png")

        # Test the custom select (Bottom Sheet)
        page.get_by_text("All Difficulties").click()
        page.wait_for_timeout(1000)
        page.screenshot(path="verification/mobile_select_drawer.png")

        browser.close()

if __name__ == "__main__":
    verify_mobile()
