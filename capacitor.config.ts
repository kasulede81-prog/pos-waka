import type { CapacitorConfig } from "@capacitor/cli";
import os from "node:os";

/**
 * Production API hosts are baked into `dist/` at `npm run build` time (Vite `VITE_*` env).
 * After changing Supabase or `VITE_APP_URL`, run `npm run build` then `npx cap sync`.
 *
 * Live reload (simulator → Vite on your Mac):
 *   CAPACITOR_LIVE_RELOAD=1 npm run ios:dev
 *   or set CAPACITOR_DEV_SERVER_URL=http://<LAN-IP>:5173
 *
 * App ID `ug.waka.pos` — do not run `cap init`.
 */

function lanIPv4(): string | null {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

const liveReload =
  process.env.CAPACITOR_LIVE_RELOAD === "1" || process.env.CAPACITOR_LIVE_RELOAD === "true";
const explicitDevServer = process.env.CAPACITOR_DEV_SERVER_URL?.trim();
const port = process.env.VITE_PORT?.trim() || "5173";
const resolvedDevServer =
  explicitDevServer ||
  (liveReload ? `http://${lanIPv4() ?? "127.0.0.1"}:${port}` : undefined);

if (liveReload && !lanIPv4() && !explicitDevServer) {
  console.warn(
    "[capacitor] CAPACITOR_LIVE_RELOAD set but no LAN IPv4 found — using 127.0.0.1 (Simulator only).",
  );
}

const config: CapacitorConfig = {
  appId: "ug.waka.pos",
  appName: "Waka POS",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: Boolean(resolvedDevServer),
  },
  ios: {
    contentInset: "automatic",
    allowsLinkPreview: false,
    scrollEnabled: true,
    preferredContentMode: "mobile",
    /** Safari Web Inspector when live-reloading against Vite. */
    webContentsDebuggingEnabled: Boolean(resolvedDevServer) || process.env.CAPACITOR_IOS_DEBUG === "1",
  },
  server: {
    androidScheme: "https",
    iosScheme: "https",
    /**
     * When set, Capacitor loads the Vite (or other) dev server instead of bundled dist/.
     * Simulator can reach the Mac via LAN IP; 127.0.0.1 works for iOS Simulator only.
     */
    ...(resolvedDevServer
      ? {
          url: resolvedDevServer,
          cleartext: resolvedDevServer.startsWith("http://"),
        }
      : {}),
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      style: "DARK",
      hidden: false,
      animation: "NONE",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: false,
      backgroundColor: "#fffaf5",
      androidSplashResourceName: "splash",
      androidScaleType: "FIT_CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
