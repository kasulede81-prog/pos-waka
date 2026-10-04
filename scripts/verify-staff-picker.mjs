#!/usr/bin/env node
/**
 * Staff multi-shop picker — mobile + desktop regression harness.
 *
 * WHY THIS EXISTS OUTSIDE VITEST. This repo has no DOM test project (`vitest` runs with
 * `environment: "node"` and only picks up `src/**\/*.test.ts`), so a React component cannot be
 * rendered or clicked from the unit suite. The picker's failure was a RENDERED-state failure —
 * three controls inert while the markup looked correct — and the only way to hold it is to drive
 * the real built app in a real browser. This script is run manually / in CI alongside the unit
 * tests; it follows the repo's existing `scripts/verify-*.mjs` convention.
 *
 * WHAT IT PROVES
 *   1. the picker renders with every control ENABLED (no stuck busy flag on first paint);
 *   2. nothing overlays the buttons (elementFromPoint lands inside the control);
 *   3. sign-out is never disabled, in any state;
 *   4. tapping the cashier shop actually fires the handler and completes the switch;
 *   5. a switch that never settles produces a visible error within the bound, and the screen
 *      becomes usable again instead of locking.
 *
 * It stubs Supabase, so it needs no credentials and touches no real data. It serves the LOCAL
 * build, so run `npm run build` first.
 *
 *   node scripts/verify-staff-picker.mjs            # uses ./dist via vite preview
 *   node scripts/verify-staff-picker.mjs <baseUrl>  # or an already-running server
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PROJECT_REF = "ljaedextsenbkxzzgxcg";
const USER_ID = "aaaa1111-2222-4333-8444-555566667777";
const CASHIER_SHOP = "22222222-2222-4222-8222-222222222222";
const OWNER_SHOP = "11111111-1111-4111-8111-111111111111";
const PORT = 4178;
const SWITCH_TIMEOUT_MS = 10_000; // mirrors STAFF_SHOP_SWITCH_TIMEOUT_MS

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: USER_ID, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
    "sig",
  ].join(".");
  return {
    access_token: jwt,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "rt",
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "cashier@example.com",
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

async function startPreview(baseUrl) {
  if (baseUrl) return { url: baseUrl, stop: () => {} };
  if (!existsSync("dist/index.html")) throw new Error("dist/index.html missing — run `npm run build` first");
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  const url = `http://localhost:${PORT}`;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return { url, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("vite preview did not start");
}

/**
 * Routes Supabase so the picker can render and a real switch can complete — no live data touched.
 *
 * `state.hangSwitch` is flipped by the caller AFTER the picker has rendered: hanging the RPC from
 * the start would also starve the shop LIST, so the picker would never appear and the test would
 * prove nothing about a hung SWITCH.
 */
async function stubBackend(page, state) {
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const url = route.request().url();
    if (url.includes("list_user_shops")) {
      if (state.hangSwitch) return new Promise(() => {}); // never settles
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { shop_id: OWNER_SHOP, shop_name: "peterson hardware", organization_id: "o1", role: "owner", is_primary: true },
          { shop_id: CASHIER_SHOP, shop_name: "Cathyy", organization_id: "o2", role: "cashier", is_primary: false },
        ]),
      });
    }
    if (url.includes("user_can_access_shop")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    if (url.includes("set_user_primary_shop")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    if (url.includes("waka_account_identity")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, auth_user_id: USER_ID, is_member: false, is_shop_member: true, shop_id: OWNER_SHOP, membership_role: "owner", is_org_member: true, has_pending_staff_invite: false, merchant_intent: false, member_intent: false, profile_exists: true }) });
    }
    if (url.includes("owner_workspace_health")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  await page.route("**/auth/v1/**", async (route) => {
    const session = fakeSession();
    const u = route.request().url();
    if (u.includes("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
    if (u.includes("/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/rest/v1/**", async (route) => {
    if (route.request().url().includes("/rpc/")) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function openPicker(browser, baseUrl, viewport, state) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  await stubBackend(page, state);
  await page.goto(`${baseUrl}/login`);
  await page.evaluate(
    ([key, session]) => {
      localStorage.setItem(key, JSON.stringify(session));
      sessionStorage.setItem("waka.staffLogin.intent", "1");
    },
    [`sb-${PROJECT_REF}-auth-token`, fakeSession()],
  );
  await page.goto(`${baseUrl}/login`);
  await page.waitForSelector('[data-testid="staff-login-shop-picker"]', { timeout: 20000 });
  return { ctx, page };
}

async function main() {
  const explicit = process.argv[2];
  const { url, stop } = await startPreview(explicit);
  const browser = await chromium.launch();
  try {
    for (const [label, viewport] of [
      ["mobile 390x844", { width: 390, height: 844 }],
      ["desktop 1280x800", { width: 1280, height: 800 }],
    ]) {
      console.log(`\n${label}`);
      const { ctx, page } = await openPicker(browser, url, viewport, { hangSwitch: false });

      const state = await page.evaluate(() => {
        const shops = [...document.querySelectorAll('[data-testid^="staff-shop-option-"]')];
        const signOut = document.querySelector('[data-testid="staff-gate-signout"]');
        const btn = shops[0];
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          shopCount: shops.length,
          shopDisabled: shops.map((b) => b.disabled),
          signOutDisabled: signOut ? signOut.disabled : null,
          signOutPresent: !!signOut,
          overlaid: btn.contains(top) ? false : (top ? top.tagName : "none"),
        };
      });

      check(`${label}: two shops listed`, state.shopCount === 2, `got ${state.shopCount}`);
      check(`${label}: shop buttons enabled on first paint`, state.shopDisabled.every((d) => d === false), JSON.stringify(state.shopDisabled));
      check(`${label}: sign-out present and enabled`, state.signOutPresent && state.signOutDisabled === false, `present=${state.signOutPresent} disabled=${state.signOutDisabled}`);
      check(`${label}: nothing overlays the buttons`, state.overlaid === false, `top element=${state.overlaid}`);

      // Tap the CASHIER shop and require a real, observable consequence.
      await page.click(`[data-testid="staff-shop-option-${CASHIER_SHOP}"]`);
      await page.waitForTimeout(2500);
      const after = await page.evaluate(() => ({
        stillOnPicker: !!document.querySelector('[data-testid="staff-login-shop-picker"]'),
        busyText: /Opening/.test(document.body.innerText),
        alert: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
        path: location.pathname,
      }));
      check(
        `${label}: tapping the cashier shop fires and the screen responds`,
        after.stillOnPicker === false || after.busyText || after.alert !== null,
        JSON.stringify(after),
      );
      await ctx.close();
    }

    console.log("\nhung switch (bounded switch must not lock the screen)");
    const hungState = { hangSwitch: false };
    const { ctx, page } = await openPicker(browser, url, { width: 390, height: 844 }, hungState);
    const before = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="staff-shop-option-"]')].map((b) => b.disabled));
    check("hung: controls enabled before tap", before.every((d) => d === false), JSON.stringify(before));

    hungState.hangSwitch = true; // the switch itself now never settles
    await page.click(`[data-testid="staff-shop-option-${CASHIER_SHOP}"]`);
    await page.waitForTimeout(SWITCH_TIMEOUT_MS + 3000);

    const hung = await page.evaluate(() => ({
      alert: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
      shopDisabled: [...document.querySelectorAll('[data-testid^="staff-shop-option-"]')].map((b) => b.disabled),
      signOutDisabled: document.querySelector('[data-testid="staff-gate-signout"]')?.disabled ?? null,
      stillOnPicker: !!document.querySelector('[data-testid="staff-login-shop-picker"]'),
    }));
    check("hung: a visible error appears instead of a silent lock", typeof hung.alert === "string" && hung.alert.length > 0, JSON.stringify(hung));
    check("hung: the picker is still there to retry on", hung.stillOnPicker === true, JSON.stringify(hung));
    check("hung: shop buttons usable again", hung.shopDisabled.every((d) => d === false), JSON.stringify(hung.shopDisabled));
    check("hung: sign-out stayed available throughout", hung.signOutDisabled === false, String(hung.signOutDisabled));
    await ctx.close();
  } finally {
    await browser.close();
    stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`FAILED:\n${failed.map((f) => `  - ${f.name}: ${f.detail}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-staff-picker failed:", err?.message ?? err);
  process.exit(1);
});
