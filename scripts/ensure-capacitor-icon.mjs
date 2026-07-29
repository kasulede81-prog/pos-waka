#!/usr/bin/env node
/** Ensure resources/icon.png exists for @capacitor/assets (mirrors brand logo.png). */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logo = resolve(root, "resources/logo.png");
const icon = resolve(root, "resources/icon.png");

if (!existsSync(logo)) {
  console.error("Missing resources/logo.png — run npm run brand:assets first.");
  process.exit(1);
}
copyFileSync(logo, icon);
console.log("✓ resources/icon.png ← resources/logo.png");
