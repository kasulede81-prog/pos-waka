/**
 * Registration runtime flow test (local dev).
 * Requires: dev server on BASE_URL, Supabase anon key in .env,
 * optional SUPABASE_SERVICE_ROLE_KEY for auto email-verify link generation.
 *
 * Usage: node scripts/registration-runtime-test.mjs [--run=1|2|3]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(root, ".env"));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.REG_TEST_BASE_URL || "http://localhost:5173";
const runIndex = Number(process.argv.find((a) => a.startsWith("--run="))?.split("=")[1] || "1");

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

const stamp = Date.now();
const email = `waka.regtest.${runIndex}.${stamp}@mailinator.com`;
const password = `Test-${stamp}-Aa1!`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  return false;
}

async function generateVerifyUrl(targetEmail) {
  if (!SERVICE_KEY) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: targetEmail,
    password,
    options: { redirectTo: `${BASE_URL}/auth/callback` },
  });
  if (error) throw error;
  return data?.properties?.action_link ?? null;
}

async function runBrowserFlow(verifyUrl) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const bootLogs = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[BOOT-") || text.includes("waka_boot") || text.includes("waka-startup")) {
      bootLogs.push(text);
    }
  });

  console.log(`\n=== RUN ${runIndex}: ${email} ===`);
  console.log("STEP register UI…");
  await page.goto(`${BASE_URL}/register`, { waitUntil: "domcontentloaded", timeout: 60_000 });

  if (!verifyUrl) {
    console.log("No service role — register via API only, manual verify required.");
    await browser.close();
    return { ok: false, reason: "no_service_role_for_verify" };
  }

  console.log("STEP open verification link…");
  await page.goto(verifyUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const deadline = Date.now() + 45_000;
  let finalUrl = page.url();
  while (Date.now() < deadline) {
    finalUrl = page.url();
    if (finalUrl.includes("/onboarding")) break;
    if (finalUrl.includes("/login") || finalUrl.includes("/home")) break;
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/shop setup|onboarding|welcome|your business/i.test(bodyText)) break;
    await sleep(500);
  }

  finalUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const traceRaw = await page.evaluate(() => localStorage.getItem("waka.boot.trace.v1"));
  const startupRaw = await page.evaluate(() => localStorage.getItem("waka.startup.diagnostics.v1"));

  await browser.close();

  const onOnboarding =
    finalUrl.includes("/onboarding") || /shop setup|onboarding|welcome/i.test(bodyText);
  const stuckLoading = /finishing sign-in|loading/i.test(bodyText) && !onOnboarding;
  const recovery = /recover|downloading|cloud backup/i.test(bodyText);

  return {
    ok: onOnboarding && !stuckLoading && !recovery,
    finalUrl,
    stuckLoading,
    recovery,
    onOnboarding,
    bootLogs: bootLogs.slice(-30),
    traceRaw,
    startupRaw,
  };
}

async function signUpViaApi() {
  if (SERVICE_KEY) {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        business_name: `RegTest Shop ${runIndex}`,
        organization_name: `RegTest Org ${runIndex}`,
        shop_display_name: `RegTest Shop ${runIndex}`,
        business_type: "kiosk_duka",
        full_name: "Reg Test Owner",
        pos_role: "owner",
      },
    });
    if (error) throw error;
    return data.user?.id ?? null;
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${BASE_URL}/auth/callback`,
      data: {
        business_name: `RegTest Shop ${runIndex}`,
        organization_name: `RegTest Org ${runIndex}`,
        shop_display_name: `RegTest Shop ${runIndex}`,
        business_type: "kiosk_duka",
        full_name: "Reg Test Owner",
        pos_role: "owner",
      },
    },
  });
  if (error) throw error;
  return data.user?.id ?? null;
}

async function main() {
  console.log("Registration runtime test");
  console.log("BASE_URL:", BASE_URL);

  const up = await waitForServer(BASE_URL);
  if (!up) {
    console.error("Dev server not reachable at", BASE_URL);
    process.exit(1);
  }

  const userId = await signUpViaApi();
  console.log("Signed up:", email, userId ?? "(pending confirm)");

  const verifyUrl = await generateVerifyUrl(email);
  const result = await runBrowserFlow(verifyUrl);

  console.log("\n--- RESULT ---");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("\nFAILED run", runIndex);
    process.exit(1);
  }

  console.log("\nPASSED run", runIndex);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
