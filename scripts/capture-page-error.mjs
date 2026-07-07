import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5173/floor";
const errors = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("pageerror", (err) => pageErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const body = await page.locator("body").innerText();
  console.log("URL:", url);
  console.log("BODY_SNIPPET:", body.slice(0, 500).replace(/\s+/g, " "));
  console.log("PAGE_ERRORS:", JSON.stringify(pageErrors, null, 2));
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors.slice(0, 20), null, 2));
} catch (e) {
  console.error("NAV_FAIL", e);
} finally {
  await browser.close();
}
