#!/usr/bin/env node
/**
 * Pricing Campaigns window — browser regression harness.
 *
 * WHY THIS EXISTS OUTSIDE VITEST. This repo has no DOM test project (`vitest`
 * runs `environment: "node"` and only picks up `src/**\/*.test.ts`), so a React
 * page cannot be rendered or clicked from the unit suite. The headline defect
 * this guards was a RENDERED-state failure — "Create campaign" silently snapped
 * back to the first campaign because an effect keyed on `draft.id` re-selected
 * it — and the only way to hold that is to drive the real built app in a real
 * browser. Follows the repo's existing `scripts/verify-*.mjs` convention.
 *
 * WHAT IT PROVES
 *   1. the campaign list renders with a status per campaign;
 *   2. "Create campaign" opens an EMPTY form and stays empty, even with a
 *      campaign currently open in the editor (the regression);
 *   3. creating posts `p_id: null` with the typed name and the new campaign
 *      appears in the list afterwards;
 *   4. a discount change without a reason is refused with an ERROR — it used to
 *      be rendered in the green success box — and posts nothing;
 *   5. saving it with a reason posts the discount;
 *   6. pausing a live campaign asks for confirmation before it posts.
 *
 * It stubs Supabase, so it needs no credentials and touches no real data. It
 * serves the LOCAL build, so run `npm run build` first.
 *
 *   node scripts/verify-pricing-campaigns.mjs            # uses ./dist via vite preview
 *   node scripts/verify-pricing-campaigns.mjs <baseUrl>  # or an already-running server
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PROJECT_REF = "ljaedextsenbkxzzgxcg";
const USER_ID = "bbbb1111-2222-4333-8444-555566667777";
const PORT = 4179;
const CAMPAIGN_LIVE = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const CAMPAIGN_DRAFT = "22222222-2222-4222-8222-bbbbbbbbbbbb";

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
      email: "billing-admin@waka.ug",
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "google", providers: ["google"] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

/** In-memory stand-in for the two tables + the four admin RPCs. */
function makeBackend() {
  const now = Date.now();
  return {
    campaigns: [
      {
        id: CAMPAIGN_LIVE,
        name: "Ramadan Offer",
        description: "Seasonal discount",
        enabled: true,
        starts_at: null,
        ends_at: null,
        created_at: new Date(now - 86400000).toISOString(),
        updated_at: new Date(now - 3600000).toISOString(),
      },
      {
        id: CAMPAIGN_DRAFT,
        name: "December Push",
        description: "",
        enabled: false,
        starts_at: null,
        ends_at: null,
        created_at: new Date(now - 7200000).toISOString(),
        updated_at: new Date(now - 7200000).toISOString(),
      },
    ],
    discounts: [
      {
        id: "d1",
        campaign_id: CAMPAIGN_LIVE,
        plan_code: "starter",
        monthly_discount_type: "percentage",
        monthly_discount_value: 10,
        annual_discount_percent: null,
      },
    ],
    saves: [],
    discountSaves: [],
    failDiscounts: false,
    nextId: 1,
  };
}

async function stubBackend(page, backend) {
  await page.route("**/auth/v1/**", async (route) => {
    const session = fakeSession();
    const u = route.request().url();
    if (u.includes("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
    if (u.includes("/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1]?.split("?")[0] ?? "";
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (fn === "waka_internal_me") {
      return json([
        {
          id: "ia-1",
          email: "billing-admin@waka.ug",
          full_name: "Billing Admin",
          role: "super_admin",
          assigned_district_ids: [],
          active: true,
          max_shops: null,
        },
      ]);
    }
    if (fn === "waka_account_identity") {
      return json({
        ok: true,
        auth_user_id: USER_ID,
        is_member: false,
        is_shop_member: true,
        shop_id: "shop-1",
        membership_role: "owner",
        is_org_member: true,
        has_pending_staff_invite: false,
        merchant_intent: true,
        member_intent: false,
        profile_exists: true,
      });
    }
    if (fn === "get_my_shop_activation_gate") return json(null);
    // BusinessProfileRequiredRoute fails CLOSED on an unusable answer, and an
    // unmatched `null` is exactly that — it would block every /internal/ path.
    if (fn === "owner_onboarding_status") return json({ complete: true, missing: [] });
    if (fn === "admin_pricing_campaign_save") {
      const body = route.request().postDataJSON() ?? {};
      backend.saves.push(body);
      const created = body.p_id === null || body.p_id === undefined;
      const id = created ? `created-${backend.nextId++}` : body.p_id;
      const row = {
        id,
        name: body.p_name,
        description: body.p_description ?? "",
        enabled: Boolean(body.p_enabled),
        starts_at: body.p_starts_at ?? null,
        ends_at: body.p_ends_at ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const idx = backend.campaigns.findIndex((c) => c.id === id);
      if (idx >= 0) backend.campaigns[idx] = row;
      else backend.campaigns.unshift(row);
      return json({ ok: true, campaign_id: id, created });
    }
    if (fn === "admin_pricing_campaign_plan_discount_save") {
      const body = route.request().postDataJSON() ?? {};
      backend.discountSaves.push(body);
      const idx = backend.discounts.findIndex(
        (d) => d.campaign_id === body.p_campaign_id && d.plan_code === body.p_plan_code,
      );
      const row = {
        id: idx >= 0 ? backend.discounts[idx].id : `d${backend.nextId++}`,
        campaign_id: body.p_campaign_id,
        plan_code: body.p_plan_code,
        monthly_discount_type: body.p_monthly_discount_type,
        monthly_discount_value: body.p_monthly_discount_value,
        annual_discount_percent: body.p_annual_discount_percent,
      };
      if (idx >= 0) backend.discounts[idx] = row;
      else backend.discounts.push(row);
      return json({ ok: true, computed: {} });
    }
    if (fn === "admin_pricing_campaign_metrics") {
      return json({
        campaign_id: CAMPAIGN_LIVE,
        campaign_name: "Ramadan Offer",
        campaign_active: true,
        new_subscribers: 12,
        new_subscribers_by_plan: { starter: 7, business: 5 },
        revenue_recorded_ugx: 412000,
        conversion_rate_percent: 8.5,
        total_subscriptions_in_window: 141,
      });
    }
    if (fn === "admin_pricing_campaign_audit_feed") {
      return json([
        {
          id: "a1",
          campaign_id: CAMPAIGN_LIVE,
          plan_code: "starter",
          actor_name: "Billing Admin",
          previous_discount: {},
          new_discount: {},
          reason: "seed",
          created_at: new Date().toISOString(),
        },
      ]);
    }
    return json(null);
  });

  await page.route("**/rest/v1/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rpc/")) return route.fallback();
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/pricing_campaigns")) return json(backend.campaigns);
    if (url.includes("/pricing_campaign_plan_discounts")) {
      // Lets a test fail only the REFRESH that follows a save.
      if (backend.failDiscounts) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "simulated discount read failure" }),
        });
      }
      const match = /campaign_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(url));
      if (!match) return json(backend.discounts);
      const ids = match[1].split(",").map((s) => s.replace(/^"|"$/g, ""));
      return json(backend.discounts.filter((d) => ids.includes(d.campaign_id)));
    }
    return json([]);
  });
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

async function openWindow(browser, baseUrl, viewport, backend) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
    // The built app registers a Service Worker; without this it intercepts
    // requests before `page.route` and every stub below is silently inert.
    serviceWorkers: "block",
  });
  const page = await ctx.newPage();
  // A Service Worker would intercept before page.route and make the stubs inert.
  await ctx.addInitScript(
    ([key, session]) => {
      localStorage.setItem(key, JSON.stringify(session));
    },
    [`sb-${PROJECT_REF}-auth-token`, fakeSession()],
  );
  await stubBackend(page, backend);
  await page.goto(`${baseUrl}/internal/waka/billing/pricing-campaigns`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('[data-testid="pricing-campaigns-page"]', { timeout: 25000 });
  } catch {
    // Say WHERE the app stopped instead of just "selector not found".
    const diag = await page.evaluate(() => ({
      path: location.pathname + location.search,
      startup: document.querySelector("[data-startup-state]")?.getAttribute("data-startup-state") ?? null,
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
    }));
    throw new Error(`Pricing Campaigns window never rendered: ${JSON.stringify(diag)}`);
  }
  return { ctx, page };
}

const formState = (page) =>
  page.evaluate(() => {
    const form = document.querySelector('[data-testid="pricing-campaign-form"]');
    const name = document.querySelector('[data-testid="pricing-campaign-name"]');
    return {
      formOpen: Boolean(form),
      heading: form?.querySelector("h2")?.textContent?.trim() ?? null,
      name: name ? name.value : null,
    };
  });

async function main() {
  const explicit = process.argv[2];
  const { url, stop } = await startPreview(explicit);
  const browser = await chromium.launch();
  try {
    const backend = makeBackend();
    const { ctx, page } = await openWindow(browser, url, { width: 1280, height: 900 }, backend);

    // --- 1. the list renders with a status per campaign -------------------
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="pricing-campaign-row-"]')].map((r) => r.getAttribute("data-testid")),
    );
    check("campaign list renders every campaign", rows.length === 2, JSON.stringify(rows));

    const liveStatus = (await page.textContent(`[data-testid="pricing-campaign-status-${CAMPAIGN_LIVE}"]`))?.trim();
    const draftStatus = (await page.textContent(`[data-testid="pricing-campaign-status-${CAMPAIGN_DRAFT}"]`))?.trim();
    check("an enabled in-window campaign reads Live", liveStatus === "Live", String(liveStatus));
    check("a disabled campaign reads Draft", draftStatus === "Draft", String(draftStatus));
    const ruleShown = await page.textContent(`[data-testid="pricing-campaign-row-${CAMPAIGN_LIVE}"]`);
    check("the list shows the pricing rule", /−10%/.test(ruleShown ?? ""), String(ruleShown?.slice(0, 90)));

    // --- 2. open an existing campaign ------------------------------------
    await page.click(`[data-testid="pricing-campaign-edit-${CAMPAIGN_LIVE}"]`);
    await page.waitForSelector('[data-testid="pricing-campaign-form"]');
    let form = await formState(page);
    check("Edit loads the campaign into the form", form.name === "Ramadan Offer", JSON.stringify(form));

    // --- 3. a discount change with no reason is refused loudly -----------
    await page.selectOption('[data-testid="pricing-plan-row-starter"] select', "percentage");
    await page.fill('[data-testid="pricing-plan-row-starter"] input[type="number"]', "25");
    await page.click('[data-testid="pricing-plan-save-starter"]');
    await page.waitForTimeout(600);
    const reasonError = await page.evaluate(() => {
      const err = document.querySelector('[data-testid="pricing-campaigns-error"]');
      const notice = document.querySelector('[data-testid="pricing-campaign-notice"]');
      return {
        error: err?.textContent?.trim() ?? null,
        errorIsAlert: err?.getAttribute("role") === "alert",
        notice: notice?.textContent?.trim() ?? null,
      };
    });
    check(
      "a missing reason shows an ERROR, not a green success box",
      Boolean(reasonError.error) && reasonError.errorIsAlert && reasonError.notice === null,
      JSON.stringify(reasonError),
    );
    check("nothing was posted without a reason", backend.discountSaves.length === 0, JSON.stringify(backend.discountSaves));

    // --- 4. the same save with a reason goes through ---------------------
    await page.fill('[data-testid="pricing-campaign-reason"]', "Q2 push");
    await page.click('[data-testid="pricing-plan-save-starter"]');
    await page.waitForTimeout(900);
    const saved = backend.discountSaves[backend.discountSaves.length - 1];
    check(
      "saving with a reason posts the discount and its audit reason",
      backend.discountSaves.length === 1 &&
        saved.p_reason === "Q2 push" &&
        Number(saved.p_monthly_discount_value) === 25 &&
        saved.p_plan_code === "starter",
      JSON.stringify(saved),
    );
    check(
      "the save reports success",
      Boolean((await page.getAttribute('[data-testid="pricing-campaigns-notice"]', "role")) === "status"),
      "no success banner",
    );

    // The plan editor must be re-seeded from the RELOADED rows. Re-syncing from
    // the render-time closure would snap the field back to the pre-save 10%.
    const afterSave = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="pricing-plan-row-starter"]');
      return {
        type: row?.querySelector("select")?.value ?? null,
        value: row?.querySelector('input[type="number"]')?.value ?? null,
        text: row?.textContent?.replace(/\s+/g, " ") ?? "",
      };
    });
    check(
      "after saving, the plan row shows the SAVED discount, not the pre-save one",
      afterSave.type === "percentage" && afterSave.value === "25" && /UGX 13,500/.test(afterSave.text),
      JSON.stringify(afterSave),
    );

    // --- 5. REGRESSION: Create campaign must open and stay empty ---------
    await page.click('[data-testid="pricing-campaign-new"]');
    await page.waitForTimeout(900); // the old effect re-selected asynchronously
    form = await formState(page);
    check(
      "Create campaign opens an EMPTY form while another campaign is open",
      form.formOpen && form.heading === "New campaign" && form.name === "",
      JSON.stringify(form),
    );

    // --- 6. creating persists and appears in the list --------------------
    await page.fill('[data-testid="pricing-campaign-name"]', "Black Friday");
    await page.click('[data-testid="pricing-campaign-save"]');
    await page.waitForTimeout(1000);
    const createPost = backend.saves[backend.saves.length - 1];
    check(
      "creating posts p_id=null with the typed name",
      backend.saves.length === 1 && createPost.p_id === null && createPost.p_name === "Black Friday",
      JSON.stringify(createPost),
    );
    const listText = await page.textContent('[data-testid="pricing-campaigns-page"]');
    check("the new campaign appears in the list", /Black Friday/.test(listText ?? ""), "not found in list");
    const rowCount = await page.evaluate(
      () => document.querySelectorAll('[data-testid^="pricing-campaign-row-"]').length,
    );
    check("the list grew by one", rowCount === 3, String(rowCount));

    // --- 7. pausing the live campaign asks first -------------------------
    await page.click(`[data-testid="pricing-campaign-toggle-${CAMPAIGN_LIVE}"]`);
    await page.waitForSelector('[data-testid="pricing-campaign-confirm"]', { timeout: 5000 }).catch(() => {});
    const confirmVisible = await page.isVisible('[data-testid="pricing-campaign-confirm"]').catch(() => false);
    check("pausing a live campaign asks for confirmation", confirmVisible === true, "no confirm dialog");
    // Only saves targeting the live campaign count here — the create step above
    // legitimately posts p_enabled:false for a brand-new draft campaign.
    check(
      "nothing is posted for the live campaign before the confirmation",
      backend.saves.filter((s) => s.p_id === CAMPAIGN_LIVE && s.p_enabled === false).length === 0,
      JSON.stringify(backend.saves),
    );
    if (confirmVisible) {
      await page.click('[data-testid="pricing-campaign-confirm"]');
      await page.waitForTimeout(900);
      const pausePost = backend.saves[backend.saves.length - 1];
      check("confirming pauses the campaign", pausePost.p_enabled === false && pausePost.p_id === CAMPAIGN_LIVE, JSON.stringify(pausePost));
    }
    await ctx.close();

    // --- 8. a failed refresh must not silently reset the editor -----------
    // The refresh that follows a save is a separate read; if it fails, the plan
    // editor must keep what was just saved rather than re-seed from an empty
    // result and claim every plan now has "no discount".
    const failBackend = makeBackend();
    const failed = await openWindow(browser, url, { width: 1280, height: 900 }, failBackend);
    await failed.page.click(`[data-testid="pricing-campaign-edit-${CAMPAIGN_LIVE}"]`);
    await failed.page.waitForSelector('[data-testid="pricing-campaign-form"]');
    await failed.page.fill('[data-testid="pricing-campaign-reason"]', "refresh failure probe");
    await failed.page.fill('[data-testid="pricing-plan-row-starter"] input[type="number"]', "30");
    failBackend.failDiscounts = true; // only the read-after-save fails
    await failed.page.click('[data-testid="pricing-plan-save-starter"]');
    await failed.page.waitForTimeout(1000);
    const afterFailedRefresh = await failed.page.evaluate(() => {
      const row = document.querySelector('[data-testid="pricing-plan-row-starter"]');
      return {
        posted: null,
        type: row?.querySelector("select")?.value ?? null,
        value: row?.querySelector('input[type="number"]')?.value ?? null,
        loadErrorShown: Boolean(document.querySelector('[data-testid="pricing-campaigns-load-error"]')),
      };
    });
    check(
      "the save still reached the server when the refresh failed",
      failBackend.discountSaves.length === 1 &&
        Number(failBackend.discountSaves[0].p_monthly_discount_value) === 30,
      JSON.stringify(failBackend.discountSaves),
    );
    check(
      "a failed refresh does NOT reset the plan editor to 'no discount'",
      afterFailedRefresh.type === "percentage" && afterFailedRefresh.value === "30",
      JSON.stringify(afterFailedRefresh),
    );
    check(
      "a failed refresh is disclosed instead of silently ignored",
      afterFailedRefresh.loadErrorShown === true,
      JSON.stringify(afterFailedRefresh),
    );
    await failed.ctx.close();

    // --- 9. mobile layout -------------------------------------------------
    const mobileBackend = makeBackend();
    const mobile = await openWindow(browser, url, { width: 390, height: 844 }, mobileBackend);
    const overflow = await mobile.page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      tableScrolls: (() => {
        const wrap = document.querySelector('[data-testid="pricing-campaigns-page"] table')?.parentElement;
        return wrap ? wrap.scrollWidth > wrap.clientWidth : null;
      })(),
    }));
    check(
      "mobile: no horizontal page overflow (the table scrolls inside its own box)",
      overflow.docWidth <= overflow.viewport + 1,
      JSON.stringify(overflow),
    );
    check("mobile: the campaign table is present", overflow.tableScrolls !== null, "no table");
    await mobile.ctx.close();
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
  console.error("verify-pricing-campaigns failed:", err?.message ?? err);
  process.exit(1);
});
