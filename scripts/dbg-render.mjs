import { loadEnv, createBrowser, signupFlow } from "./e2e-utils.mjs";
const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const stamp = Date.now().toString().slice(-8);
const browser = await createBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("console", (m) => { if (m.text().startsWith("DBG")) console.log("CONSOLE", m.text().slice(0,200)); });
  const email = `dbg${stamp}@apextest.local`;
  console.log("EMAIL", email);
  await signupFlow(page, BASE, `Dbg Tester ${stamp}`, email, "testpass123");
  await page.waitForTimeout(1500);
  // Set a marker in localStorage to verify persistence across reload
  await page.evaluate(() => window.localStorage.setItem("__test_persist__", "hello"));
  const before = await page.evaluate(() => ({
    token: !!window.localStorage.getItem("sb-urhcvdcpxhxmmnavkcvd-auth-token"),
    marker: window.localStorage.getItem("__test_persist__")
  }));
  console.log("BEFORE RELOAD", JSON.stringify(before));
  await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    token: !!window.localStorage.getItem("sb-urhcvdcpxhxmmnavkcvd-auth-token"),
    marker: window.localStorage.getItem("__test_persist__"),
    allKeys: Array.from({length: window.localStorage.length}, (_, i) => window.localStorage.key(i))
  }));
  console.log("AFTER RELOAD", JSON.stringify(after));
  console.log("URL", page.url());
  await browser.close();
} catch (e) {
  console.error("ERR", e && e.message);
  try { await browser.close(); } catch {}
}
