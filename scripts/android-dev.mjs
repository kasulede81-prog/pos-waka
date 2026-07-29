#!/usr/bin/env node
/**
 * Android live-reload against Vite on the host machine.
 *
 * Emulator → host loopback is http://10.0.2.2:5173
 * Physical device → Mac LAN IP (e.g. http://192.168.1.10:5173)
 *
 * Usage: npm run android:dev
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

function adbDevices() {
  try {
    const out = execSync("adb devices", { encoding: "utf8", cwd: root });
    return out
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.endsWith("\tdevice") || /\s+device$/.test(line))
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return [];
  }
}

function run(cmd, env = process.env) {
  execSync(cmd, { stdio: "inherit", cwd: root, env, shell: true });
}

if (!existsSync(envDev)) {
  console.error("❌ Missing .env.development.local — copy .env.development.example and set Supabase keys.");
  process.exit(1);
}

if (!existsSync(resolve(root, "android"))) {
  console.error("❌ android/ missing. Run: npx cap add android");
  process.exit(1);
}

const devices = adbDevices();
const hasEmulator = devices.some((d) => d.startsWith("emulator-"));
const hasPhysical = devices.some((d) => !d.startsWith("emulator-"));

const explicit = process.env.CAPACITOR_DEV_SERVER_URL?.trim();
const hostForDevice = hasEmulator && !hasPhysical ? "10.0.2.2" : lanIPv4() ?? "10.0.2.2";
const serverUrl = explicit || `http://${hostForDevice}:${port}`;

console.log(`\n📡 Capacitor Android live reload → ${serverUrl}`);
if (hasEmulator) console.log("   Emulator detected (host alias 10.0.2.2).");
if (hasPhysical) console.log("   Physical device detected — ensure it can reach this host.");
if (!devices.length) console.log("   No adb device yet — start an emulator or plug in a phone.");
console.log("");

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

await new Promise((r) => setTimeout(r, 2500));

try {
  run("npx cap sync android", env);
  console.log("\n📲 Installing debug build with live-reload server URL…\n");
  run("./android/gradlew -p android assembleDebug", env);
  const apk = resolve(root, "android/app/build/outputs/apk/debug/app-debug.apk");
  if (devices.length) {
    for (const serial of devices) {
      run(`adb -s ${serial} install -r "${apk}"`, env);
      run(`adb -s ${serial} shell am force-stop ug.waka.pos`, env);
      run(`adb -s ${serial} shell am start -n ug.waka.pos/.MainActivity`, env);
    }
  } else {
    console.log("⚠️  No device attached — APK built. Start an emulator then: adb install -r android/app/build/outputs/apk/debug/app-debug.apk");
  }
} catch (err) {
  vite.kill("SIGTERM");
  throw err;
}

console.log("\n✅ Live reload ready. Edit React code — Vite HMR updates the emulator WebView.");
console.log("   Chrome DevTools: chrome://inspect → inspect ug.waka.pos WebView\n");

const shutdown = () => {
  vite.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
