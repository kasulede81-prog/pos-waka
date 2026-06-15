import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { canScanToCartFastAdd, resolvePairedSinglePreset, resolveScanToCartInput } from "./posScanToCart";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Soap",
    sku: "SKU001",
    category: "Groceries",
    baseUnit: "ea",
    stockOnHand: 10,
    minimumStockAlert: 2,
    sellingPricePerUnitUgx: 5000,
    costPricePerUnitUgx: 3000,
    buyingUnit: "",
    ...overrides,
  } as Product;
}

describe("resolveScanToCartInput", () => {
  it("auto-adds fixed-price product with qty 1", () => {
    expect(resolveScanToCartInput(product())).toEqual({ inputMode: "quantity", value: 1 });
    expect(canScanToCartFastAdd(product())).toBe(true);
  });

  it("auto-adds single money preset", () => {
    const p = product({ quickPresetsMoneyUgx: [10000] });
    expect(resolveScanToCartInput(p)).toEqual({ inputMode: "money", value: 10000 });
  });

  it("auto-adds single quantity preset", () => {
    const p = product({ quickPresetsQty: [3] });
    expect(resolveScanToCartInput(p)).toEqual({ inputMode: "quantity", value: 3 });
  });

  it("auto-adds paired money+qty preset for same sell option", () => {
    const p = product({ quickPresetsMoneyUgx: [10000], quickPresetsQty: [2] });
    expect(resolvePairedSinglePreset(p)).toEqual({ inputMode: "money", value: 10000 });
    expect(resolveScanToCartInput(p)).toEqual({ inputMode: "money", value: 10000 });
  });

  it("returns null when paired presets disagree", () => {
    const p = product({ quickPresetsMoneyUgx: [10000], quickPresetsQty: [5] });
    expect(resolveScanToCartInput(p)).toBeNull();
  });

  it("returns null for variable-price product", () => {
    expect(resolveScanToCartInput(product({ sellingPricePerUnitUgx: 0 }))).toBeNull();
  });

  it("returns null for multiple presets", () => {
    const p = product({ quickPresetsMoneyUgx: [5000, 10000] });
    expect(resolveScanToCartInput(p)).toBeNull();
  });

  it("returns null for pack + unit sell presets", () => {
    const p = product({
      buyingUnit: "Carton",
      conversionRate: 12,
      sellingPricePerUnitUgx: 1000,
    });
    expect(resolveScanToCartInput(p)).toBeNull();
  });

  it("returns null for pharmacy packaging", () => {
    const p = product({
      pharmacyPackaging: {
        enabled: true,
        baseUnit: "tablet",
        sell: { tablet: true, strip: true, box: false },
        level1: { unit: "strip", containsBaseUnits: 10 },
      },
    } as Partial<Product>);
    expect(resolveScanToCartInput(p)).toBeNull();
  });
});
