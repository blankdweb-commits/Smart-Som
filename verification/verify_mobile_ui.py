from playwright.sync_api import sync_playwright, expect
import time

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create a mobile context
        context = browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
        )
        page = context.new_page()

        try:
            # 1. Navigate to Dashboard
            print("Navigating to Dashboard...")
            page.goto("http://localhost:5173/")
            page.wait_for_selector("h2:has-text('Dashboard')", timeout=10000)
            time.sleep(2)
            page.screenshot(path="/home/jules/verification/mobile_dashboard.png")

            # 2. Check Bottom Nav
            print("Checking Bottom Nav...")
            expect(page.get_by_role("link", name="Cards")).to_be_visible()
            expect(page.get_by_role("link", name="Exams")).to_be_visible()

            # 3. Navigate to Flashcards (Academic)
            print("Navigating to Flashcards...")
            page.get_by_role("link", name="Cards").click()
            page.wait_for_selector("text=Your Curriculum", timeout=10000)
            time.sleep(1)
            page.screenshot(path="/home/jules/verification/mobile_flashcards_start.png")

            # 4. Select General Nursing -> Year 1
            print("Selecting Program and Level...")
            page.get_by_role("button", name="General Nursing").click()
            time.sleep(1)
            page.get_by_role("button", name="Year 1").click()
            time.sleep(1)
            page.screenshot(path="/home/jules/verification/mobile_flashcards_year1.png")

            # 5. Check Exam Timetable
            print("Navigating to Exams...")
            page.get_by_role("link", name="Exams").click()
            page.wait_for_selector("h2:has-text('Exam Timetable')", timeout=10000)
            time.sleep(1)
            page.screenshot(path="/home/jules/verification/mobile_exams.png")

            # 6. Check Pronunciation Helper
            print("Navigating to Audio...")
            page.get_by_role("link", name="Audio").click()
            page.wait_for_selector("h2:has-text('Medical Pronunciation Helper')", timeout=10000)
            time.sleep(1)
            page.screenshot(path="/home/jules/verification/mobile_audio.png")

            print("Verification successful!")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
            with open("/home/jules/verification/debug_page.html", "w") as f:
                f.write(page.content())
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    run_verification()
