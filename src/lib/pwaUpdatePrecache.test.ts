import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("PWA update precache", () => {
  it("does not precache every JS/CSS file on deploy", () => {
    const src = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(src).not.toContain('globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"]');
    expect(src).toContain('globPatterns: ["manifest.webmanifest", "favicon.svg", "icons/icon-192.webp"]');
    expect(src).not.toContain('navigateFallback: "index.html"');
    expect(src).toContain("navigateFallback: undefined");
    expect(src).toContain("waka-html-navigations");
    expect(src).toContain("NetworkFirst");
    expect(src).toContain("networkTimeoutSeconds: 8");
    expect(src).toContain("waka-hashed-assets");
    expect(src).toContain("waka-sw-reload-stale-clients");
    const swSnippet = readFileSync(join(ROOT, "src/lib/swReloadStaleClients.js"), "utf8");
    expect(swSnippet).toContain("__wakaHadActiveWorker");
    expect(swSnippet).toContain("client.navigate");
  });

  it("does not mark sw.js as an immutable year-long cache", () => {
    const src = readFileSync(join(ROOT, "vercel.json"), "utf8");
    expect(src).toContain('"/sw.js"');
    expect(src).toContain("max-age=0, must-revalidate");
    expect(src).not.toMatch(/\/\(\.\*\)\\\\.\(js\|css\|woff2/);
  });
});
