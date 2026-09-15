import { describe, expect, it } from "vitest";
import { isLikelyChunkLoadError } from "./siteDataRecovery";

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
});
