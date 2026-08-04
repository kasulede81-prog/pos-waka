import { describe, expect, it } from "vitest";
import {
  POS_PRODUCT_CARD_MAX_WIDTH_PX,
  catalogProductGridStyle,
  sparseAwareCatalogColumnCount,
} from "./posProductGridColumns";

describe("sparseAwareCatalogColumnCount (Phase 32.4.1)", () => {
  it("keeps dense columns for medium/large shelves", () => {
    expect(sparseAwareCatalogColumnCount(10, 50)).toBe(10);
    expect(sparseAwareCatalogColumnCount(10, 8)).toBe(10);
    expect(sparseAwareCatalogColumnCount(6, 6)).toBe(6);
  });

  it("widens a single product on desktop (3 cols when dense ≥8)", () => {
    expect(sparseAwareCatalogColumnCount(10, 1)).toBe(3);
    expect(sparseAwareCatalogColumnCount(8, 1)).toBe(3);
    expect(sparseAwareCatalogColumnCount(5, 1)).toBe(2);
  });

  it("packs 2–5 products into a balanced row", () => {
    expect(sparseAwareCatalogColumnCount(10, 2)).toBe(2);
    expect(sparseAwareCatalogColumnCount(10, 3)).toBe(3);
    expect(sparseAwareCatalogColumnCount(10, 4)).toBe(4);
    expect(sparseAwareCatalogColumnCount(10, 5)).toBe(5);
  });

  it("uses full width for a single product on phone band (2-col dense)", () => {
    expect(sparseAwareCatalogColumnCount(2, 1)).toBe(1);
    expect(sparseAwareCatalogColumnCount(2, 2)).toBe(2);
  });

  it("never exceeds the dense column count", () => {
    expect(sparseAwareCatalogColumnCount(4, 3)).toBe(3);
    expect(sparseAwareCatalogColumnCount(4, 1)).toBe(2);
  });
});

describe("catalogProductGridStyle (Phase 32.4.2)", () => {
  it("centers sparse shelves with a max card width", () => {
    const one = catalogProductGridStyle(10, 1);
    expect(one.sparse).toBe(true);
    expect(one.justifyContent).toBe("center");
    expect(one.gridTemplateColumns).toContain(`${POS_PRODUCT_CARD_MAX_WIDTH_PX}px`);
    expect(one.columns).toBe(3);

    const three = catalogProductGridStyle(10, 3);
    expect(three.sparse).toBe(true);
    expect(three.columns).toBe(3);
    expect(three.justifyContent).toBe("center");
  });

  it("keeps dense fluid tracks for large catalogs", () => {
    const dense = catalogProductGridStyle(10, 50);
    expect(dense.sparse).toBe(false);
    expect(dense.gridTemplateColumns).toBe("repeat(10, minmax(0, 1fr))");
    expect(dense.justifyContent).toBeUndefined();
  });

  it("keeps phone band fluid (no max-width stretch)", () => {
    const phone = catalogProductGridStyle(2, 1);
    expect(phone.sparse).toBe(false);
    expect(phone.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });
});
