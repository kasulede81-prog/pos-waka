import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appName = env.VITE_APP_NAME?.trim() || "Waka POS";
  const shortName = env.VITE_APP_SHORT_NAME?.trim() || "WakaPOS";

  return {
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
          description: "Point of sale for shops — works offline, syncs when online.",
          theme_color: "#047857",
          background_color: "#ecfdf5",
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
