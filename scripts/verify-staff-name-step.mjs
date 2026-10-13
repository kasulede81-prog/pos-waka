#!/usr/bin/env node
/**
 * Staff invitation name-review — RELOAD regression harness.
 *
 * WHY THIS EXISTS. The name-review gate was `awaitingName`, a `useState`, while everything it
 * guards is durable: the invitation token lives in sessionStorage (deliberately, so it survives the
 * native round trip) and the session lives in the Supabase client. So after ANY remount — a reload,
 * a service-worker activation, a StrictMode double-mount — the durable half came back and the
 * volatile half did not, the accept effect ran, and `shop_accept_staff_invite()` consumed the
 * invitation while the person was still typing their name.
 *
 * NO UNIT TEST CAN SEE THAT. This repo has no DOM test project (`vitest` runs with
 * `environment: "node"` and only picks up `src/**\/*.test.ts`), so nothing in the suite mounts a
 * component — let alone remounts one. The only way to hold this property is to drive the real built
 * app in a real browser and reload it. That is what this script does; it follows the same convention
 * as `scripts/verify-staff-picker.mjs`.
 *
 * It stubs Supabase and touches no real data. Run `npm run build` first.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PROJECT_REF = "ljaedextsenbkxzzgxcg";
const USER_ID = "bbbb1111-2222-4333-8444-555566667777";
const INVITE = "invite-token-for-reload-regression";
const PORT = 4179;

/** What Google suggested. The harness deliberately confirms something ELSE (below). */
const GOOGLE_NAME = { first: "New", last: "Hire" };
/**
 * What the person actually types. MUST differ from `GOOGLE_NAME`: if the harness submitted the
 * suggestion unchanged, a durable `waka_full_name` equal to it would be indistinguishable from the
 * provider's own value being left alone — and the check would pass even if confirmation wrote
 * nothing at all. A distinct name is what makes the assertion mean "the edit was persisted".
 */
const TYPED_NAME = { first: "Grace", last: "Nakato", full: "Grace Nakato" };

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

/** A first-time Google account: provider claims only, NO `waka_full_name` / marker. */
function freshSession() {
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
      email: "newhire@example.com",
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: "google", providers: ["google"] },
      // The Google name is present as a SUGGESTION and is not a DKASU confirmation.
      user_metadata: { full_name: `${GOOGLE_NAME.first} ${GOOGLE_NAME.last}`, name: `${GOOGLE_NAME.first} ${GOOGLE_NAME.last}` },
      created_at: new Date().toISOString(),
    },
  };
}

async function startPreview() {
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

async function main() {
  const { url, stop } = await startPreview();
  const browser = await chromium.launch();
  try {
    /**
     * `serviceWorkers: "block"` IS LOAD-BEARING — without it not one stub below is consulted.
     *
     * The built app registers `sw.js` (vite-plugin-pwa). Requests a service worker mediates are NOT
     * intercepted by `page.route()`, so every call went to the real Supabase project instead: the
     * accept RPC, the profile reads, and `confirmWakaName`'s `GET`/`PUT /auth/v1/user`, which came
     * back 403 against the fake session. `confirmWakaName` then returned `not_authenticated`, the
     * name step stayed up, and acceptance never ran — while every route handler sat unused.
     *
     * The failure was silent because the reload-protection leg needs no network at all: the durable
     * gate is re-derived from `getSession()`, which reads local storage. So this leg passed on a
     * build where the stubs did nothing, which is exactly what made it look like a PUT-handler bug.
     *
     * Blocking the SW costs the harness nothing it asserts — a reload is still a genuine remount —
     * and it is what keeps the run hermetic (no real project is ever contacted).
     */
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();

    /** Every `shop_accept_staff_invite` call the app makes, across reloads. */
    let acceptCalls = 0;
    /** Every `confirmWakaName` metadata write, and the last payload it sent. */
    let nameWrites = 0;
    let lastNameWrite = null;
    let session = freshSession();

    await page.route("**/rest/v1/rpc/**", async (route) => {
      const u = route.request().url();
      if (u.includes("shop_accept_staff_invite")) {
        acceptCalls += 1;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, shop_id: "shop-1", membership_role: "cashier" }) });
      }
      if (u.includes("shop_has_pending_staff_invite_for_me")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    });
    await page.route("**/auth/v1/**", async (route) => {
      const req = route.request();
      const u = req.url();
      if (u.includes("/user") && req.method() === "PUT") {
        /**
         * `confirmWakaName` → `supabase.auth.updateUser({ data })`, i.e. GoTrue's
         * `PUT /auth/v1/user` with `{ data: <the whole merged metadata document> }`.
         *
         * `updateUser` is the ONLY durable half of confirmation, so getting the stub wrong makes
         * the whole submit leg meaningless. It is mocked to GoTrue's actual contract: persist the
         * metadata, then return the full updated user — supabase-js saves that user into the
         * session it already holds, which is what puts the confirmed name in local storage and
         * makes it survive the next remount.
         *
         * MERGE, NOT REPLACE. `confirmWakaName` spreads the current metadata before its own keys
         * precisely because a replacement would strip `pos_role`/`account_kind`/`business_name`, so
         * a real account's other keys must survive here too — that merge is the behaviour under
         * test, not an incidental detail of the fixture.
         */
        const body = (() => { try { return JSON.parse(req.postData() ?? "{}"); } catch { return {}; } })();
        nameWrites += 1;
        lastNameWrite = body.data ?? {};
        session = { ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, ...(body.data ?? {}) } } };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
      }
      if (u.includes("/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
      if (u.includes("/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.route("**/rest/v1/**", async (route) => {
      if (route.request().url().includes("/rpc/")) return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    const seed = async () => {
      await page.goto(`${url}/staff/accept`);
      await page.evaluate(([k, v, token]) => {
        localStorage.setItem(k, JSON.stringify(v));
        sessionStorage.setItem("waka.staffInvite.token", token);
      }, [`sb-${PROJECT_REF}-auth-token`, session, INVITE]);
    };

    // ---------------------------------------------------------------- first load
    await seed();
    await page.goto(`${url}/staff/accept?token=${INVITE}`);
    await page.waitForTimeout(3500);

    const nameStep = await page.$('[data-testid="staff-invite-name-step"]');
    check("first load: the name step is shown", !!nameStep);
    check("first load: the invitation is NOT accepted while it is shown", acceptCalls === 0, `acceptCalls=${acceptCalls}`);

    // ---------------------------------------------------------------- THE REGRESSION
    // A reload is the exact event that used to skip the step: the volatile gate died, the durable
    // token and session did not, and the accept effect ran.
    await page.reload();
    await page.waitForTimeout(3500);

    const afterReload = await page.$('[data-testid="staff-invite-name-step"]');
    check("AFTER RELOAD: the name step is STILL required", !!afterReload);
    check("AFTER RELOAD: the invitation is STILL not accepted", acceptCalls === 0, `acceptCalls=${acceptCalls}`);
    check("AFTER RELOAD: the token was not consumed", (await page.evaluate(() => sessionStorage.getItem("waka.staffInvite.token"))) === INVITE);

    // ---------------------------------------------------------------- explicit submit
    // The person EDITS the suggestion before confirming — see TYPED_NAME for why that matters.
    check(
      "after reload: the fields are prefilled from the Google suggestion",
      (await page.inputValue('[data-testid="name-review-first-name"]')) === GOOGLE_NAME.first &&
        (await page.inputValue('[data-testid="name-review-last-name"]')) === GOOGLE_NAME.last,
      "prefill did not match the provider's name",
    );

    await page.fill('[data-testid="name-review-first-name"]', TYPED_NAME.first);
    await page.fill('[data-testid="name-review-last-name"]', TYPED_NAME.last);
    await page.click('[data-testid="staff-invite-name-step"] button[type="button"]');

    // Wait for the success navigation itself (`<Navigate to="/" replace />`) rather than guessing a
    // duration: it is reached only after `confirmWakaName` has written and acceptance has finished.
    // The post-accept routing then settles on its own (`/` → `/welcome` for a tenancy-less account).
    await page.waitForURL((u) => new URL(u).pathname !== "/staff/accept", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const landed = new URL(page.url()).pathname;

    /**
     * Point 8 — `confirmWakaName` succeeded. Both halves matter: the write was SENT (the stub above
     * is what makes this leg work at all) and it carried the person's EDITED name, with the durable
     * marker that `needsNameReview` reads. A `full_name` equal to the Google suggestion would prove
     * nothing, which is why TYPED_NAME differs from it.
     */
    check(
      "submit: confirmWakaName sent the metadata write with the edited name",
      nameWrites === 1 &&
        lastNameWrite?.full_name === TYPED_NAME.full &&
        lastNameWrite?.waka_full_name === TYPED_NAME.full &&
        typeof lastNameWrite?.waka_name_confirmed_at === "string" &&
        lastNameWrite.waka_name_confirmed_at.length > 0,
      `nameWrites=${nameWrites} body=${JSON.stringify(lastNameWrite)}`,
    );

    // Point 9 — durability, read back from the session the CLIENT PERSISTED, not from the stub's
    // own variable. This is the value a remount loads, so it is what the gate will re-derive from.
    const persisted = await page.evaluate((k) => {
      try {
        return JSON.parse(localStorage.getItem(k) ?? "null")?.user?.user_metadata ?? null;
      } catch {
        return null;
      }
    }, `sb-${PROJECT_REF}-auth-token`);
    check(
      "submit: the durable confirmed name is in the persisted session",
      persisted?.waka_full_name === TYPED_NAME.full && typeof persisted?.waka_name_confirmed_at === "string",
      `persisted=${JSON.stringify(persisted)}`,
    );

    check("submit: acceptance runs", acceptCalls >= 1, `acceptCalls=${acceptCalls}`);
    // Exactly once: the accept effect re-runs several times on this path (the phase flips back to
    // "ready", and `nameConfirmedAt` is bumped to make it re-read), so a broken single-flight shows
    // up here as 2+, not as zero.
    check("submit: acceptance runs EXACTLY once", acceptCalls === 1, `acceptCalls=${acceptCalls}`);
    check(
      "submit: the invitation token was consumed",
      (await page.evaluate(() => sessionStorage.getItem("waka.staffInvite.token"))) === null,
      "token still present after a successful acceptance",
    );
    // The page's own contract on success is `<Navigate to="/" replace />`; where the app routes from
    // there is its business. Landing on the accept page (nothing happened) or on /login (the session
    // was lost) both mean the flow did not actually complete.
    check(
      "submit: the app reaches its successful destination",
      landed !== "/staff/accept" && landed !== "/login",
      `landed on ${landed}`,
    );

    // ---------------------------------------------------------------- remount after confirmation
    const before = acceptCalls;
    await page.reload();
    await page.waitForTimeout(3500);
    check("after confirmation: the name step does NOT reappear", !(await page.$('[data-testid="staff-invite-name-step"]')));
    check("after confirmation: acceptance is not duplicated", acceptCalls === before, `was ${before}, now ${acceptCalls}`);

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
  console.error("verify-staff-name-step failed:", err?.message ?? err);
  process.exit(1);
});
