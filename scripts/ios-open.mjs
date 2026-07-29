#!/usr/bin/env node
/**
 * One command: build web app (with Supabase) → sync Capacitor → open Xcode.
 * Usage: npm run ios  |  npm run cap:open:ios
 */
import { execSync } from "node:child_process";
import { existsSync, copyFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envLocal = resolve(root, ".env.production.local");
const envProd = resolve(root, ".env.production");
const distIndex = resolve(root, "dist/index.html");
const iosDir = resolve(root, "ios");
const logoPng = resolve(root, "resources/logo.png");
const iconPng = resolve(root, "resources/icon.png");

function run(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: root, env: process.env, shell: true });
}

function runCap(args) {
  const bin = resolve(root, "node_modules/.bin/cap");
  execSync(`"${bin}" ${args}`, { stdio: "inherit", cwd: root, shell: true });
}

function hasProductionEnv() {
  return existsSync(envLocal) || existsSync(envProd);
}

function distIsFresh(maxAgeMinutes = 120) {
  if (!existsSync(distIndex)) return false;
  const ageMs = Date.now() - statSync(distIndex).mtimeMs;
  return ageMs < maxAgeMinutes * 60 * 1000;
}

if (process.platform !== "darwin") {
  console.error("\n❌ iOS builds require macOS with Xcode.\n");
  process.exit(1);
}

if (!hasProductionEnv()) {
  console.error("\n❌ Missing .env.production.local — cloud login will not work in the iOS app.");
  console.error("   cp .env.production.example .env.production.local");
  console.error("   Then set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from Supabase → Settings → API.\n");
  process.exit(1);
}

if (!existsSync(iosDir)) {
  console.error("\n❌ ios/ missing. Run: npx cap add ios\n");
  process.exit(1);
}

if (existsSync(logoPng)) {
  copyFileSync(logoPng, iconPng);
}

const skipBuild = process.env.SKIP_IOS_BUILD === "1" || process.env.SKIP_IOS_BUILD === "true";
const skipBrand = process.env.SKIP_BRAND_ASSETS === "1" || process.env.SKIP_BRAND_ASSETS === "true";

if (!skipBrand && existsSync(resolve(root, "resources/w-symbol-source.png"))) {
  console.log("🎨 Refreshing app icons & splash from brand source…\n");
  run("npm run brand:assets");
  if (existsSync(logoPng)) copyFileSync(logoPng, iconPng);
  run("npx capacitor-assets generate --assetPath resources --ios --android --pwa");
}

if (!skipBuild && !distIsFresh()) {
  console.log("\n📦 Building production web bundle (baked into the iOS app)…\n");
  run("npm run build");
} else if (skipBuild && !existsSync(distIndex)) {
  console.error("\n❌ dist/ missing. Remove SKIP_IOS_BUILD or run npm run build first.\n");
  process.exit(1);
} else if (!skipBuild && distIsFresh()) {
  console.log("\n⏭️  dist/ is fresh — rebuilding anyway so Supabase env cannot go stale.\n");
  run("npm run build");
} else {
  console.log("\n⏭️  Using existing dist/ (SKIP_IOS_BUILD).\n");
}

console.log("🔎 Verifying Supabase is baked into dist/…\n");
run("node scripts/verify-native-supabase-bundle.mjs");

console.log("📲 Syncing web assets + Capacitor plugins into ios/…\n");
runCap("sync ios");

console.log("\n🚀 Opening Xcode…\n");
runCap("open ios");

console.log("\n✅ Ready. In Xcode: select a simulator or device → press Run ▶\n");
console.log("   Cloud login uses the Supabase project baked at build time (not localhost).\n");
