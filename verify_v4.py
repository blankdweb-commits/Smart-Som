import asyncio
from playwright.async_api import async_playwright

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("http://localhost:5173/flashcards")

        # Check if the page loaded and didn't crash
        title = await page.title()
        print(f"Page Title: {title}")

        # Check for General Nursing button
        await page.wait_for_selector("text=General Nursing")
        print("Found General Nursing button")

        # Go to Year 1 -> Semester 1 -> Anatomy
        await page.click("text=General Nursing")
        await page.wait_for_selector("text=Year 1")
        await page.click("text=Year 1")
        await page.wait_for_selector("text=Semester 1")
        await page.click("text=Semester 1")

        # The normalization logic changes "and" to "&"
        await page.wait_for_selector("text=Anatomy & Physiology I")
        await page.click("text=Anatomy & Physiology I")

        # Check if cards are displayed
        # FlashcardCard uses h3 for the question
        await page.wait_for_selector("h3", timeout=5000)
        print("Found cards in Anatomy & Physiology I")

        # Verify Search Assistant
        await page.goto("http://localhost:5173/search")
        # Fixed selector for placeholder
        await page.wait_for_selector("input[placeholder*='Search for diagrams']")
        await page.fill("input[placeholder*='Search for diagrams']", "heart")
        await page.click("button:has-text('Research')")

        # Wait for results
        await page.wait_for_selector("text=Heart Anatomy & Labelling Diagram", timeout=10000)
        print("Search Assistant returned correct result for 'heart'")

        # Verify "Generate Flashcard" button
        await page.wait_for_selector("button:has-text('Generate Flashcard')")
        print("Found Generate Flashcard button in search results")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
