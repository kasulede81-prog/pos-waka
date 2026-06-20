import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Production API hosts are baked into `dist/` at `npm run build` time (Vite `VITE_*` env).
 * After changing Supabase or `VITE_APP_URL`, run `npm run build` then `npx cap sync android`.
 * Daily Android workflow: `npm run android` (build + sync + open Studio). See docs/ANDROID.md.
 * Optional dev-only live reload: set `server.url` in a local untracked override.
 *
 * App ID `ug.waka.pos` is the Play Store applicationId (do not run `cap init` — config is TypeScript).
 */
const config: CapacitorConfig = {
  appId: "ug.waka.pos",
  appName: "Waka POS",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: false,
      backgroundColor: "#ffffff",
      /** Full logo from `res/drawable/splash.png` (generated from `resources/splash.png`) */
      androidSplashResourceName: "splash",
      androidScaleType: "FIT_CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
