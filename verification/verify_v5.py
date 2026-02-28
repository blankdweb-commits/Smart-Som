from playwright.sync_api import Page, expect, sync_playwright

def verify_nursing_hub_v5(page: Page):
    # Set viewport to mobile
    page.set_viewport_size({"width": 375, "height": 667})

    # 1. Header (Exam link check)
    page.goto("http://localhost:5173")
    page.wait_for_selector("text=NursingHub", timeout=10000)
    exam_link = page.get_by_role("link", name="Exams") # on 375px it might be hidden text, let's see
    page.screenshot(path="/home/jules/verification/v5_header.png")

    # 2. Flashcard Program Selection
    page.goto("http://localhost:5173/flashcards")
    page.wait_for_selector("text=Select Your Program", timeout=10000)
    page.screenshot(path="/home/jules/verification/v5_program_selection.png")

    # Select Midwifery
    page.click("text=Midwifery")
    page.wait_for_selector("text=Midwifery Curriculum", timeout=10000)
    page.screenshot(path="/home/jules/verification/v5_midwifery_track.png")

    # 3. Community Reply UI
    page.goto("http://localhost:5173/community")
    page.wait_for_selector("text=Nursing Community", timeout=10000)
    # Check for reply button on existing post
    reply_btn = page.get_by_text("Replies").first
    reply_btn.click()
    page.screenshot(path="/home/jules/verification/v5_community_reply_mobile.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_nursing_hub_v5(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
