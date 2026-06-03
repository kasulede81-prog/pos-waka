#!/usr/bin/env node
/**
 * Runs electron-builder for Windows using a fresh output directory when
 * release/windows* trees are locked (app.asar in use).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] === "portable" ? "portable" : "nsis";
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const outputDir = `release/win-build-${stamp}`;
const publishDir = resolve(root, "release", "windows-build");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stopWindowsDesktopApp() {
  if (process.platform !== "win32") return;
  for (const name of ["WAKA POS.exe", "electron.exe"]) {
    try {
      spawnSync("taskkill", ["/IM", name, "/F"], { stdio: "ignore" });
    } catch {
      /* not running */
    }
  }
}

stopWindowsDesktopApp();
await sleep(600);

const builderArgs = [
  "electron-builder",
  `--win`,
  target,
  "--x64",
  `-c.directories.output=${outputDir}`,
];

console.log(`Building Windows ${target} → ${outputDir}/`);
const result = spawnSync("npx", builderArgs, {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const builtDir = resolve(root, outputDir);
const installers = readdirSync(builtDir).filter((f) => f.endsWith(".exe"));
if (installers.length === 0) {
  console.error(`No .exe found in ${builtDir}`);
  process.exit(1);
}

mkdirSync(publishDir, { recursive: true });
for (const name of installers) {
  const from = join(builtDir, name);
  const to = join(publishDir, name);
  cpSync(from, to, { force: true });
  console.log(`Installer: ${to}`);
}

console.log(`Unpacked app: ${join(builtDir, "win-unpacked")}`);
