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

        # Go to Year 1 -> Semester 1
        await page.click("text=General Nursing")
        await page.wait_for_selector("text=Year 1")
        await page.click("text=Year 1")
        await page.wait_for_selector("text=Semester 1")
        await page.click("text=Semester 1")

        # Check if Course Card is displayed
        await page.wait_for_selector("h4:has-text('Anatomy & Physiology I')")
        print("Found Anatomy & Physiology I course card")

        # Click Start Study
        await page.click("div:has(h4:has-text('Anatomy & Physiology I')) >> button:has-text('Start Study')")

        # Check if cards are displayed
        await page.wait_for_selector("h3", timeout=10000)
        print("Found cards in Anatomy & Physiology I session")

        # Verify Search Assistant is GONE
        await page.goto("http://localhost:5173/search")
        # Should not find the search input
        try:
            await page.wait_for_selector("input[placeholder*='Search for diagrams']", timeout=2000)
            print("ERROR: Search Assistant still exists!")
        except:
            print("Verified: Search Assistant is removed.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
