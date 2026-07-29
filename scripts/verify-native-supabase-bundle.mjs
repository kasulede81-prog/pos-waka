#!/usr/bin/env node
/**
 * Fail native Capacitor builds when Supabase is not baked into dist/.
 * Root cause of "iOS launches but login fails": production build without VITE_SUPABASE_*.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distAssets = resolve(root, "dist/assets");
const expectedHost = "ljaedextsenbkxzzgxcg.supabase.co";

function fail(msg) {
  console.error(`\n❌ Native Supabase bundle check failed:\n   ${msg}\n`);
  console.error("Fix:");
  console.error("  1. cp .env.production.example .env.production.local");
  console.error("  2. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (Dashboard → Settings → API)");
  console.error("  3. npm run build && npx cap sync ios\n");
  process.exit(1);
}

if (!existsSync(resolve(root, "dist/index.html"))) {
  fail("dist/index.html missing — run npm run build first.");
}

if (!existsSync(distAssets)) {
  fail("dist/assets missing — run npm run build first.");
}

const jsFiles = readdirSync(distAssets).filter((f) => f.endsWith(".js"));
let foundUrl = false;
let foundAnonJwt = false;

for (const file of jsFiles) {
  const text = readFileSync(resolve(distAssets, file), "utf8");
  if (text.includes(expectedHost) || text.includes("supabase.co")) foundUrl = true;
  if (/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)) {
    foundAnonJwt = true;
  }
}

if (!foundUrl) {
  fail(
    `No Supabase URL in dist/ — VITE_SUPABASE_URL was empty at build time. ` +
      `iOS will show local-only mode and cloud login cannot work.`,
  );
}

if (!foundAnonJwt) {
  fail(
    `No Supabase anon JWT in dist/ — VITE_SUPABASE_ANON_KEY was empty at build time.`,
  );
}

console.log(`✓ dist/ includes Supabase config (${expectedHost})`);
