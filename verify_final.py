import asyncio
from playwright.async_api import async_playwright
import os

async def verify_mobile():
    async with async_playwright() as p:
        # iPhone 12 viewport
        device = p.devices['iPhone 12']
        browser = await p.chromium.launch()
        context = await browser.new_context(**device)
        page = await context.new_page()

        # Start dev server
        process = await asyncio.create_subprocess_shell(
            "npm run dev -- --port 3000",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        await asyncio.sleep(5)  # Wait for server

        try:
            await page.goto("http://localhost:3000")
            await page.wait_for_selector("canvas", timeout=10000)

            # Take screenshot
            await page.screenshot(path="verification/mobile_final.png")
            print("Screenshot saved to verification/mobile_final.png")

            # Check for canvas existence and visibility
            visible = await page.is_visible("canvas")
            print(f"Canvas visible: {visible}")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            await browser.close()
            process.kill()

if __name__ == "__main__":
    if not os.path.exists("verification"):
        os.makedirs("verification")
    asyncio.run(verify_mobile())
