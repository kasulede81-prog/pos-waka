import { describe, expect, it } from "vitest";
import {
  catalogColumnCount,
  stabilizeCatalogColumnCount,
} from "./posProductGridColumns";

describe("stabilizeCatalogColumnCount (Phase 32.3)", () => {
  it("grows immediately when more width is available", () => {
    expect(stabilizeCatalogColumnCount(9, 6, 1200)).toBe(9);
  });

  it("keeps prior density when checkout shrinks catalog but min-tile still fits", () => {
    // Empty-cart peak ~8 cols; after sidebar ~700px still fits 6 at 112px tiles
    const raw = catalogColumnCount(700);
    expect(stabilizeCatalogColumnCount(raw, 8, 700)).toBeGreaterThanOrEqual(6);
    expect(stabilizeCatalogColumnCount(raw, 8, 700)).toBeLessThanOrEqual(8);
  });

  it("does not drop more than geometry requires", () => {
    expect(stabilizeCatalogColumnCount(5, 8, 700)).toBe(6);
    expect(stabilizeCatalogColumnCount(4, 8, 520)).toBe(4);
  });
});
