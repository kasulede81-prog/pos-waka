import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  computeMedicineMarginRows,
  pharmacyCostWarnings,
  pharmacyMarginPercent,
  pharmacyMarginUgx,
  pharmacyQuickAddRequiresBuyPrice,
  sortMedicineMarginRows,
} from "./pharmacyCostIntegrity";

function product(partial: Partial<Product> & Pick<Product, "costPricePerUnitUgx" | "sellingPricePerUnitUgx">): Product {
  return {
    id: "p1",
    name: "Paracetamol",
    sellingMode: "unit",
    baseUnit: "tablet",
    stockOnHand: 100,
    minimumStockAlert: 10,
    category: "Pain relief",
    sku: "SKU-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...partial,
  };
}

describe("pharmacyCostIntegrity", () => {
  it("pharmacyQuickAddRequiresBuyPrice is true only in pharmacy mode", () => {
    expect(pharmacyQuickAddRequiresBuyPrice("pharmacy", true)).toBe(true);
    expect(pharmacyQuickAddRequiresBuyPrice("kiosk_duka", false)).toBe(false);
  });

  it("pharmacyCostWarnings flags zero cost, sell below cost, extreme margin", () => {
    expect(pharmacyCostWarnings(product({ costPricePerUnitUgx: 0, sellingPricePerUnitUgx: 100 })).map((w) => w.kind)).toContain(
      "zero_cost",
    );
    expect(pharmacyCostWarnings(product({ costPricePerUnitUgx: 100, sellingPricePerUnitUgx: 50 })).map((w) => w.kind)).toContain(
      "sell_below_cost",
    );
    expect(pharmacyCostWarnings(product({ costPricePerUnitUgx: 100, sellingPricePerUnitUgx: 600 })).map((w) => w.kind)).toContain(
      "extreme_margin",
    );
  });

  it("pharmacyMarginUgx and percent", () => {
    const p = product({ costPricePerUnitUgx: 50, sellingPricePerUnitUgx: 100 });
    expect(pharmacyMarginUgx(p)).toBe(50);
    expect(pharmacyMarginPercent(p)).toBe(100);
  });

  it("computeMedicineMarginRows and sort", () => {
    const rows = computeMedicineMarginRows([
      product({ id: "a", name: "A", costPricePerUnitUgx: 10, sellingPricePerUnitUgx: 30, stockOnHand: 5 }),
      product({ id: "b", name: "B", costPricePerUnitUgx: 100, sellingPricePerUnitUgx: 150, stockOnHand: 2 }),
    ]);
    expect(rows).toHaveLength(2);
    const byInv = sortMedicineMarginRows(rows, "largest_inventory_value");
    expect(byInv[0]!.productId).toBe("b");
    const byHigh = sortMedicineMarginRows(rows, "highest_margin");
    expect(byHigh[0]!.marginUgx).toBeGreaterThanOrEqual(byHigh[1]!.marginUgx);
  });
});
