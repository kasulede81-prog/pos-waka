#!/usr/bin/env node
/**
 * Capture the signed-in /upgrade page at desktop and narrow widths.
 *
 * Local mode: vite dev has no VITE_SUPABASE_URL, so authMode is local. A local
 * session plus an IndexedDB snapshot with onboarding complete is enough to pass
 * KnownIdentityGate / BusinessProfileRequiredRoute / OnboardingRouteGate and land
 * on /upgrade. The printer panel needs a remote shopId, so it is not in these
 * frames — cloud-mode capture is a separate mode.
 *
 * Usage:
 *   node scripts/capture-upgrade-screens.mjs before
 *   node scripts/capture-upgrade-screens.mjs after
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const label = process.argv[2] || "shot";
const PORT = 5199;
const OUT = resolve(process.cwd(), "screenshots", "upgrade-redesign", label);
mkdirSync(OUT, { recursive: true });

const ACCOUNT_KEY = "local:owner_localhost.test";

function startServer() {
  return spawn("npx", ["vite", "--mode", "development", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
}

async function waitFor(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${url}`);
}

/**
 * Seed BEFORE first paint. useAuth reads `waka-pos-local-session` during its
 * init effect, and OnboardingRouteGate races the store hydrate — seeding after
 * load is too late for the session and loses the /upgrade race every time.
 */
function installSeeds(page) {
  return page.addInitScript(async (accountKey) => {
    localStorage.setItem("waka-pos-local-session", JSON.stringify({ email: "owner@localhost.test" }));
    try {
      const db = await new Promise((resolveDb, reject) => {
        const req = indexedDB.open("waka-pos-offline", 5);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
          if (!d.objectStoreNames.contains("syncQueue")) d.createObjectStore("syncQueue", { keyPath: "id" });
          if (!d.objectStoreNames.contains("backups")) d.createObjectStore("backups", { keyPath: "id" });
        };
        req.onsuccess = () => resolveDb(req.result);
        req.onerror = () => reject(req.error);
      });
      const snapshot = {
        products: [],
        customers: [],
        sales: [],
        preferences: {
          onboardingDone: true,
          onboardingWizardDone: true,
          schemaVersion: 2,
          shopDisplayName: "Demo Shop",
          shopCurrency: "UGX",
        },
        debtPayments: [],
        dayCloses: [],
      };
      await new Promise((resolveWrite, reject) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(snapshot, `${accountKey}::snapshot`);
        tx.oncomplete = () => resolveWrite();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      /* seed is best-effort; the session alone still authenticates */
    }
  }, ACCOUNT_KEY);
}

async function shoot(page, name, viewportName) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(OUT, `${viewportName}-${name}.png`), fullPage: true });
  console.log(`saved ${viewportName}-${name}.png`);
}

async function main() {
  const server = startServer();
  const url = `http://localhost:${PORT}`;
  await waitFor(url);
  const browser = await chromium.launch();
  try {
    const viewports = [
      { name: "desktop", options: { viewport: { width: 1280, height: 900 } } },
      { name: "mobile", options: { ...devices["iPhone 13"] } },
    ];

    for (const vp of viewports) {
      const ctx = await browser.newContext({ ...vp.options, serviceWorkers: "block" });
      const page = await ctx.newPage();
      await installSeeds(page);
      // Dev builds always show the stability overlay — it obscures the page under review.
      await page.addInitScript(() => {
        const style = document.createElement("style");
        // Dev-only StabilityDiagnosticsOverlay (fixed bottom-left, aria-hidden).
        style.textContent = "body > div[aria-hidden] { display: none !important; }";
        document.documentElement.appendChild(style);
      });

      await page.goto(`${url}/upgrade`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);

      let path = await page.evaluate(() => location.pathname);
      if (!path.startsWith("/upgrade")) {
        // OnboardingRouteGate may have raced the store hydrate on first paint.
        // Retry once now that preferences are loaded.
        await page.evaluate(() => {
          window.history.pushState({}, "", "/upgrade");
          window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
        });
        await page.waitForTimeout(1500);
        path = await page.evaluate(() => location.pathname);
      }
      if (!path.startsWith("/upgrade")) {
        console.warn(`warn: landed on ${path}, not /upgrade`);
      }

      // Drop the dev-only stability overlay so it does not cover the page under review.
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll("div[aria-hidden]"))) {
          if (el.textContent?.includes("Waka stability")) el.remove();
        }
      });

      await shoot(page, "upgrade-top", vp.name);
      // AppShell scrolls an inner `.scroll-main-chrome`, not the window.
      await page.evaluate(() => {
        const el = document.querySelector(".scroll-main-chrome") ?? document.scrollingElement;
        if (el) el.scrollTop = Math.min(1400, el.scrollHeight);
      });
      await page.waitForTimeout(400);
      await shoot(page, "upgrade-plans", vp.name);
      await page.evaluate(() => {
        const el = document.querySelector(".scroll-main-chrome") ?? document.scrollingElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
      await shoot(page, "upgrade-bottom", vp.name);
      // Yearly + printer block sits in the lower half of the page.
      await page.evaluate(() => {
        const heading = document.getElementById("upgrade-yearly-heading");
        heading?.scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(400);
      await shoot(page, "upgrade-yearly", vp.name);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
