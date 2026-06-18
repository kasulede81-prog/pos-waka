import { describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import {
  attachStockVersionToLine,
  mergeRemoteInventoryStock,
  productVersionChangedSinceLineAdd,
  validateDraftSaleStockBeforeFinalize,
} from "./inventoryVersionProtection";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function product(stockOnHand: number, version: number): Product {
  return {
    id: PRODUCT_ID,
    name: "Item",
    sellingPricePerUnitUgx: 1_000,
    costPricePerUnitUgx: 100,
    stockOnHand,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 2,
    updatedAt: "2026-06-01T08:00:00.000Z",
    version,
  };
}

function line(quantity: number, stockVersionAtAdd?: number): SaleLine {
  return {
    id: "line-1",
    productId: PRODUCT_ID,
    name: "Item",
    inputMode: "quantity",
    quantity,
    unitPriceUgx: 1_000,
    unitCostUgx: 100,
    lineTotalUgx: quantity * 1_000,
    estimatedProfitUgx: quantity * 900,
    stockVersionAtAdd,
  };
}

describe("inventoryVersionProtection — cart snapshots", () => {
  it("attachStockVersionToLine records product version", () => {
    const withVersion = attachStockVersionToLine(product(5, 3), line(1));
    expect(withVersion.stockVersionAtAdd).toBe(3);
  });

  it("detects version change since line was added", () => {
    expect(productVersionChangedSinceLineAdd(line(1, 2), product(1, 3))).toBe(true);
    expect(productVersionChangedSinceLineAdd(line(1, 3), product(1, 3))).toBe(false);
  });
});

describe("inventoryVersionProtection — pre-sale validation", () => {
  it("passes when stock is sufficient", () => {
    const result = validateDraftSaleStockBeforeFinalize([line(2, 1)], [product(5, 1)]);
    expect(result.ok).toBe(true);
  });

  it("returns noStock when insufficient without version change", () => {
    const result = validateDraftSaleStockBeforeFinalize([line(3, 1)], [product(2, 1)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("noStock");
  });

  it("returns stockChangedAnotherWindow when version changed and stock insufficient", () => {
    const result = validateDraftSaleStockBeforeFinalize([line(2, 1)], [product(1, 2)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorKey).toBe("stockChangedAnotherWindow");
  });

  it("passes when version changed but stock still covers quantity", () => {
    const result = validateDraftSaleStockBeforeFinalize([line(2, 1)], [product(5, 2)]);
    expect(result.ok).toBe(true);
  });
});

describe("inventoryVersionProtection — remote merge", () => {
  it("applies newer remote version and stock", () => {
    const merged = mergeRemoteInventoryStock(product(5, 2), {
      newStock: 3,
      version: 3,
      timestamp: Date.now(),
    });
    expect(merged?.stockOnHand).toBe(3);
    expect(merged?.version).toBe(3);
  });

  it("rejects stale remote version", () => {
    const merged = mergeRemoteInventoryStock(product(5, 5), {
      newStock: 10,
      version: 4,
      timestamp: Date.now(),
    });
    expect(merged).toBeNull();
  });

  it("skips no-op updates", () => {
    const merged = mergeRemoteInventoryStock(product(5, 3), {
      newStock: 5,
      version: 3,
      timestamp: Date.now(),
    });
    expect(merged).toBeNull();
  });
});
