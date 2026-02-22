from playwright.sync_api import Page, expect, sync_playwright
import os

def run_verification(page: Page):
    # Navigate to Flashcards
    page.goto("http://localhost:5173/flashcards")
    page.wait_for_selector("h2")

    # Take screenshot of Library Browser
    page.screenshot(path="/home/jules/verification/library_browser.png")

    # Click on Year 1
    page.get_by_text("Year 1").first.click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/year_1_selection.png")

    # Click on Semester 1
    page.get_by_text("Semester 1").first.click()
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/semester_1_selection.png")

    # Click on a subject (e.g., Foundations of Nursing)
    page.get_by_text("Foundations of Nursing").first.click()
    page.wait_for_timeout(1000)
    page.screenshot(path="/home/jules/verification/flashcard_list.png")

    # Verify NCLEX Page
    page.goto("http://localhost:5173/nclex")
    page.wait_for_selector("h1")
    page.screenshot(path="/home/jules/verification/nclex_page.png")

    # Verify NMCN Page
    page.goto("http://localhost:5173/nmcn")
    page.wait_for_selector("h1")
    page.screenshot(path="/home/jules/verification/nmcn_page.png")

    # Verify Pronunciation
    page.goto("http://localhost:5173/pronunciation")
    page.wait_for_selector("h2")
    # Search for a term
    page.fill("input[placeholder='Search terms...']", "Cyanosis")
    page.wait_for_timeout(500)
    page.screenshot(path="/home/jules/verification/pronunciation_search.png")

    # Verify Exam Timetable
    page.goto("http://localhost:5173/exams")
    page.wait_for_selector("h2")
    page.screenshot(path="/home/jules/verification/exam_timetable.png")

if __name__ == "__main__":
    os.makedirs("/home/jules/verification", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            run_verification(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
