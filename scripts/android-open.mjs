#!/usr/bin/env node
/**
 * One command: build web app → sync Capacitor → open Android Studio.
 * Usage: npm run android  |  npm run cap:open:android  |  .\cap open android (Windows)
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envLocal = resolve(root, ".env.production.local");
const envProd = resolve(root, ".env.production");
const distIndex = resolve(root, "dist/index.html");

function run(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: root, env: process.env, shell: true });
}

function runCap(args) {
  const bin =
    process.platform === "win32"
      ? resolve(root, "node_modules/.bin/cap.cmd")
      : resolve(root, "node_modules/.bin/cap");
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

if (!hasProductionEnv()) {
  console.warn("\n⚠️  No .env.production.local — copy .env.production.example and set Supabase keys.");
  console.warn("   Build may still run; login will not work in the APK without VITE_* vars.\n");
}

const skipBuild = process.env.SKIP_ANDROID_BUILD === "1" || process.env.SKIP_ANDROID_BUILD === "true";
const skipBrand = process.env.SKIP_BRAND_ASSETS === "1" || process.env.SKIP_BRAND_ASSETS === "true";

if (!skipBrand && existsSync(resolve(root, "resources/w-symbol-source.png"))) {
  console.log("🎨 Refreshing app icons & splash from brand source…\n");
  run("npm run brand:assets");
  run("npx capacitor-assets generate --assetPath resources --android --pwa");
}

if (!skipBuild && !distIsFresh()) {
  console.log("\n📦 Building production web bundle (baked into the APK)…\n");
  run("npm run build");
} else if (skipBuild && !existsSync(distIndex)) {
  console.error("\n❌ dist/ missing. Remove SKIP_ANDROID_BUILD or run npm run build first.\n");
  process.exit(1);
} else {
  console.log("\n⏭️  Using existing dist/ build (fresh enough).\n");
}

console.log("📲 Syncing web assets + Capacitor plugins into android/…\n");
runCap("sync android");

console.log("\n🚀 Opening Android Studio…\n");
runCap("open android");

console.log("\n✅ Ready. In Android Studio: wait for Gradle sync → press Run ▶\n");
