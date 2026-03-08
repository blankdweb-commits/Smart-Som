from playwright.sync_api import sync_playwright, expect
import time

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        try:
            # 1. Check Clinical Search Assistant
            print("Navigating to Clinical Search...")
            page.goto("http://localhost:5173/search")
            # Wait for any heading in the main content area
            page.wait_for_selector("h2", timeout=15000)

            # Perform a search
            page.fill("input[placeholder*='medications']", "preeclampsia")
            page.click("button:has-text('Research')")

            # Wait for results
            time.sleep(3)
            page.screenshot(path="/home/jules/verification/clinical_search_results.png")

            # 2. Check Flashcards with Exam Priority
            print("Navigating to Flashcards...")
            page.goto("http://localhost:5173/flashcards")
            page.wait_for_selector("h2", timeout=15000)

            # Click General Nursing
            page.click("button:has-text('General Nursing')")
            time.sleep(1)
            # Click Year 1
            page.click("button:has-text('Year 1')")
            time.sleep(1)
            # Click Semester 1
            page.click("button:has-text('Semester 1')")
            time.sleep(1)
            # Click Anatomy
            page.click("h5:has-text('Anatomy')")
            time.sleep(1)

            # Final screenshot of flashcard list
            page.screenshot(path="/home/jules/verification/flashcards_with_priority_btn.png")

            print("Verification successful!")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="/home/jules/verification/v2_error.png")
            # Log HTML
            with open("/home/jules/verification/v2_debug.html", "w") as f:
                f.write(page.content())
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()
