import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HTML_BOOT_RECOVERY_KEY, isLikelyChunkLoadError } from "./siteDataRecovery";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "siteDataRecovery.ts"), "utf8");

describe("isLikelyChunkLoadError", () => {
  it("detects vite dynamic import failures", () => {
    expect(isLikelyChunkLoadError("Failed to fetch dynamically imported module: https://waka.ug/assets/HomePage-abc.js")).toBe(
      true,
    );
    expect(isLikelyChunkLoadError("Importing a module script failed.")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isLikelyChunkLoadError("Cannot read properties of undefined")).toBe(false);
  });

  it("clears Cache Storage when unregistering the service worker", () => {
    expect(SRC).toContain("clearServiceWorkerCaches");
    expect(SRC).toContain("caches.delete");
  });
});

describe("HTML boot splash recovery", () => {
  it("uses a stable session flag that successful boot clears", () => {
    expect(HTML_BOOT_RECOVERY_KEY).toBe("waka.html-boot-recovery");
    expect(SRC).toContain("clearHtmlBootRecoveryFlag");
    expect(readFileSync(join(ROOT, "src/main.tsx"), "utf8")).toContain("clearHtmlBootRecoveryFlag");
  });

  it("ships an unhashed boot script that recovers on hashed module 404", () => {
    const boot = readFileSync(join(ROOT, "public/boot-recovery.js"), "utf8");
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(html).toContain('src="/boot-recovery.js"');
    expect(boot).toContain(HTML_BOOT_RECOVERY_KEY);
    expect(boot).toContain("waka-html-boot");
    expect(boot).toContain('tagName === "SCRIPT"');
    expect(boot).toContain("serviceWorker");
    expect(boot).toContain("unregister");
    expect(boot).toContain("caches.delete");
    expect(boot).toContain("setTimeout");
    expect(boot).toContain("Tap to reload");
    expect(boot).toContain("unhandledrejection");
  });

  it("does not SPA-rewrite boot-recovery.js and keeps it revalidatable", () => {
    const vercel = readFileSync(join(ROOT, "vercel.json"), "utf8");
    expect(vercel).toContain("boot-recovery\\\\.js");
    expect(vercel).toContain('"/boot-recovery.js"');
    expect(vercel).toContain("max-age=0, must-revalidate");
  });
});
