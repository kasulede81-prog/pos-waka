import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Production API hosts are baked into `dist/` at `npm run build` time (Vite `VITE_*` env).
 * After changing Supabase or `VITE_APP_URL`, run `npm run build` then `npx cap sync android`.
 * Optional dev-only live reload: set `server.url` in a local untracked override (see docs/DEPLOYMENT.md).
 */
const config: CapacitorConfig = {
  appId: "ug.waka.pos",
  appName: "Waka POS",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#ecfdf5",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
