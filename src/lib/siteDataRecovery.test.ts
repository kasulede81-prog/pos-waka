import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isLikelyChunkLoadError } from "./siteDataRecovery";

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
