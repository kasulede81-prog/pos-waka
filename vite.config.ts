import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
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
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(env.VITE_APP_VERSION?.trim() || pkg.version),
    },
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
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
        includeAssets: ["favicon.svg"],
        manifest: {
          name: appName,
          short_name: shortName,
          description: "Trusted point of sale for Uganda — offline-first, simple for every shop.",
          theme_color: "#ea580c",
          background_color: "#fff7ed",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "favicon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
            { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/auth\/callback/, /^\/auth\/recovery/],
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
