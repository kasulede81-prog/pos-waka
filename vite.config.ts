import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isElectronDist = process.env.ELECTRON === "1";
  const appName = env.VITE_APP_NAME?.trim() || "Waka POS";
  const shortName = env.VITE_APP_SHORT_NAME?.trim() || "WakaPOS";
  const googleClientId = env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";

  if (mode === "production" && !googleClientId) {
    console.warn(
      "[waka] VITE_GOOGLE_OAUTH_CLIENT_ID is missing — Google Sign-In will not work. " +
        "Use GIS popup + signInWithIdToken only (no supabase.co redirect).",
    );
  }

  return {
    base: isElectronDist ? "./" : "/",
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      setupFiles: ["src/test/vitest.setup.ts"],
      testTimeout: 15_000,
      hookTimeout: 15_000,
      pool: "threads",
      maxWorkers: Math.min(4, os.cpus().length),
      fileParallelism: true,
      teardownTimeout: 5_000,
      restoreMocks: true,
      clearMocks: true,
    },
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(env.VITE_APP_VERSION?.trim() || pkg.version),
    },
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/jspdf")) return "jspdf";
            if (id.includes("node_modules/html2canvas")) return "html2canvas";
            if (id.includes("node_modules/lottie-react") || id.includes("node_modules/lottie-web")) return "lottie";
            if (id.includes("node_modules/leaflet") || id.includes("node_modules/react-leaflet")) return "maps";
            if (id.includes("node_modules/xlsx")) return "xlsx";
            if (id.includes("node_modules/recharts")) return "charts";
            if (id.includes("/src/pages/InternalWakaAdminPage") || id.includes("/src/components/internal-admin/")) {
              return "internal-admin";
            }
            if (id.includes("node_modules/@supabase")) return "supabase";
            if (id.includes("node_modules/@capacitor")) return "capacitor";
            if (id.includes("node_modules/@tanstack/react-query")) return "rq";
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "react-vendor";
            if (id.includes("node_modules/react-router")) return "router";
            return undefined;
          },
        },
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["waka-logo.png", "icons/icon-192.webp", "icons/icon-512.webp", "og-waka-technologies.png"],
        manifest: {
          name: appName,
          short_name: shortName,
          description:
            "Waka POS by Waka Technologies — simple sales, stock, and reports for shops in Uganda. Works offline too.",
          theme_color: "#ea580c",
          background_color: "#ffffff",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "icons/icon-192.webp", sizes: "192x192", type: "image/webp", purpose: "any" },
            { src: "icons/icon-512.webp", sizes: "512x512", type: "image/webp", purpose: "any" },
            { src: "icons/icon-512.webp", sizes: "512x512", type: "image/webp", purpose: "maskable" },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],
          /** Internal admin bundle is online-only; exclude from SW precache (exceeds 2 MiB default). */
          globIgnores: ["**/internal-admin-*.js"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [
            /^\/auth\/callback/,
            /^\/auth\/recovery/,
            /^\/reset-password/,
            /^\/sitemap\.xml$/,
            /^\/robots\.txt$/,
          ],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/.*supabase\.co\/.*/i,
              handler: "NetworkFirst",
              options: { cacheName: "supabase-api", expiration: { maxEntries: 50, maxAgeSeconds: 86400 } },
            },
          ],
        },
      }),
    ],
  };
});
