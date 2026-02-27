from playwright.sync_api import Page, expect, sync_playwright

def verify_nursing_hub_v3(page: Page):
    # Set viewport to mobile
    page.set_viewport_size({"width": 375, "height": 667})

    # 1. Dashboard & Header (Vercel optimization test via local dev)
    page.goto("http://localhost:5173")
    page.wait_for_selector("text=NursingHub", timeout=10000)
    page.screenshot(path="/home/jules/verification/v3_dashboard.png")

    # 2. Community Page (Supabase Integration Check)
    page.goto("http://localhost:5173/community")
    page.wait_for_selector("text=Nursing Community", timeout=10000)
    page.screenshot(path="/home/jules/verification/v3_community.png")

    # Check if Post button is there
    expect(page.get_by_role("button", name="Post")).to_be_visible()

    # 3. Flashcards Page (TTS & Content Expansion)
    page.goto("http://localhost:5173/flashcards")
    page.click("text=Year 1")
    page.wait_for_selector("text=Semester 1", timeout=10000)
    page.click("text=Semester 1")

    # Click a subject (e.g., Anatomy)
    page.click("text=Anatomy and Physiology")

    # Check if a card is visible
    page.wait_for_selector(".flashcard-container", timeout=10000)

    # Check for Speak button (Volume2 icon)
    # Since it's a lucide icon, we check for a button with 'Listen to question' title
    speak_btn = page.get_by_title("Listen to question").first
    expect(speak_btn).to_be_visible()

    page.screenshot(path="/home/jules/verification/v3_flashcard_tts.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_nursing_hub_v3(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
