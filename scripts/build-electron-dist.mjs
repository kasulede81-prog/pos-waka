#!/usr/bin/env node
/** Production Vite build with relative asset paths for the Windows Electron shell only. */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, ELECTRON: "1" };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["tsc", "-b"]);
run("npx", ["vite", "build", "--mode", "production"]);
console.log("Electron dist ready (base=./ for file:// loading).");
