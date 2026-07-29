#!/usr/bin/env node
/**
 * iOS live-reload against Vite on your Mac LAN IP.
 *
 * Why not http://localhost:5173 inside the Simulator?
 * - iOS Simulator can reach the Mac loopback (127.0.0.1) — that works for Simulator only.
 * - Physical devices cannot — they need the Mac's LAN IP (e.g. http://192.168.1.10:5173).
 * - Capacitor without server.url loads bundled dist/ (no live reload, env frozen at last build).
 *
 * Usage: npm run ios:dev
 */
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.VITE_PORT?.trim() || "5173";
const envDev = resolve(root, ".env.development.local");

function lanIPv4() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", cwd: root, env, shell: true });
}

if (process.platform !== "darwin") {
  console.error("❌ ios:dev requires macOS.");
  process.exit(1);
}

if (!existsSync(envDev)) {
  console.error("❌ Missing .env.development.local — copy .env.development.example and set Supabase keys.");
  process.exit(1);
}

if (!existsSync(resolve(root, "ios"))) {
  console.error("❌ ios/ missing. Run: npx cap add ios");
  process.exit(1);
}

const ip = lanIPv4() ?? "127.0.0.1";
const serverUrl = process.env.CAPACITOR_DEV_SERVER_URL?.trim() || `http://${ip}:${port}`;

console.log(`\n📡 Capacitor live reload → ${serverUrl}`);
console.log("   Ensure the Simulator/device can reach this host.\n");

const vite = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--mode", "development", "--host", "0.0.0.0", "--port", port],
  { cwd: root, stdio: "inherit", env: process.env },
);

const env = {
  ...process.env,
  CAPACITOR_LIVE_RELOAD: "1",
  CAPACITOR_DEV_SERVER_URL: serverUrl,
};

// Give Vite a moment to bind before sync/open.
await new Promise((r) => setTimeout(r, 2500));

try {
  run("npx cap sync ios", env);
  run("npx cap open ios", env);
} catch (err) {
  vite.kill("SIGTERM");
  throw err;
}

console.log("\n✅ Xcode opening. Keep this terminal running (Vite). Rebuild/run the app in Xcode.\n");
console.log("   Stop with Ctrl+C when done.\n");

process.on("SIGINT", () => {
  vite.kill("SIGTERM");
  process.exit(0);
});

await new Promise((resolvePromise) => {
  vite.on("exit", resolvePromise);
});
