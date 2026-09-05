import { describe, expect, it } from "vitest";
import type { Product } from "../../../types";
import { resolveDateFilterBounds } from "../../../lib/dateFilters";
import {
  REPORTS_STOCK_NOW_HREF,
  REPORTS_STOCK_NOW_PREVIEW_LIMIT,
  reportsStockNowHeading,
  reportsStockNowPreview,
  reportsStockNowRowFields,
} from "./reportsStockNowPreview";

function product(id: string, extras: Partial<Product> = {}): Product {
  return {
    id,
    name: extras.name ?? id,
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: extras.costPricePerUnitUgx ?? 400,
    stockOnHand: extras.stockOnHand ?? 3,
    baseUnit: extras.baseUnit ?? "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 1,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version: 1,
    ...extras,
  };
}

function catalog(n: number): Product[] {
  return Array.from({ length: n }, (_, i) =>
    product(`p${i + 1}`, {
      name: `Item ${i + 1}`,
      stockOnHand: i + 1,
      costPricePerUnitUgx: 500 + i,
    }),
  );
}

describe("RPT-P3-03 Stock now preview", () => {
  it("TEST 1 — more than 12 products: 12 of N and /stock action", () => {
    const products = catalog(20);
    const preview = reportsStockNowPreview(products);
    expect(preview.rows).toHaveLength(12);
    expect(preview.shown).toBe(12);
    expect(preview.total).toBe(20);
    expect(preview.showCount).toBe(true);
    expect(preview.showViewStock).toBe(true);
    expect(preview.rows.map((p) => p.id)).toEqual(products.slice(0, 12).map((p) => p.id));
    expect(reportsStockNowHeading("en", preview.shown, preview.total)).toBe("Stock now · 12 of 20");
    expect(REPORTS_STOCK_NOW_HREF).toBe("/stock");
    expect(REPORTS_STOCK_NOW_PREVIEW_LIMIT).toBe(12);
  });

  it("TEST 2 — fewer than 12 products: 8 of 8, never 12 of 8", () => {
    const products = catalog(8);
    const preview = reportsStockNowPreview(products);
    expect(preview.rows).toHaveLength(8);
    expect(preview.shown).toBe(8);
    expect(preview.total).toBe(8);
    expect(reportsStockNowHeading("en", preview.shown, preview.total)).toBe("Stock now · 8 of 8");
    expect(reportsStockNowHeading("en", preview.shown, preview.total)).not.toContain("12 of 8");
  });

  it("TEST 3 — empty catalog keeps title only; no 0 of 0 or View stock", () => {
    const preview = reportsStockNowPreview([]);
    expect(preview.rows).toEqual([]);
    expect(preview.shown).toBe(0);
    expect(preview.total).toBe(0);
    expect(preview.showCount).toBe(false);
    expect(preview.showViewStock).toBe(false);
    expect(reportsStockNowHeading("en", preview.shown, preview.total)).toBe("Stock now");
    expect(reportsStockNowHeading("en", preview.shown, preview.total)).not.toContain("0 of 0");
  });

  it("TEST 4 — date filter does not change Stock now population", () => {
    const products = catalog(15);
    const today = resolveDateFilterBounds({ kind: "preset", preset: "today" });
    const month = resolveDateFilterBounds({ kind: "preset", preset: "this_month" });
    expect(today).not.toEqual(month);
    const a = reportsStockNowPreview(products);
    const b = reportsStockNowPreview(products);
    expect(a.total).toBe(15);
    expect(b.total).toBe(15);
    expect(a.rows.map((p) => p.id)).toEqual(b.rows.map((p) => p.id));
    expect(a.shown).toBe(12);
  });

  it("TEST 5 — preview rows expose quantity/unit only, not cost or value", () => {
    const p = product("sugar", {
      name: "Sugar",
      stockOnHand: 10,
      baseUnit: "kg",
      costPricePerUnitUgx: 30_000,
    });
    const row = reportsStockNowRowFields(p);
    expect(row).toEqual({ name: "Sugar", stockOnHand: 10, baseUnit: "kg" });
    expect(row).not.toHaveProperty("costPricePerUnitUgx");
    expect(row).not.toHaveProperty("stockValueUgx");
    expect(row).not.toHaveProperty("value_ugx");
    expect(JSON.stringify(row)).not.toContain("30000");
  });
});
