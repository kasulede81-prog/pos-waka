import { describe, expect, it } from "vitest";
import type { Product, Purchase } from "../types";
import {
  computeVoidStockDeltas,
  purchaseLineBaseUnitsIn,
  shouldPushVoidStockReversal,
} from "./purchaseLineSync";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PURCHASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const packProduct: Product = {
  id: PRODUCT_ID,
  name: "Paracetamol",
  sellingPricePerUnitUgx: 500,
  costPricePerUnitUgx: 200,
  stockOnHand: 100,
  baseUnit: "tablet",
  sellingMode: "unit",
  buyingUnit: "box",
  conversionRate: 100,
  category: "Pharmacy",
  sku: "",
  minimumStockAlert: 10,
  updatedAt: "2026-06-01T09:00:00.000Z",
  version: 1,
};

function voidedPurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: PURCHASE_ID,
    supplierId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    supplierName: "Pharma",
    lines: [
      {
        productId: PRODUCT_ID,
        name: "Paracetamol",
        qtyBuyingUnits: 2,
        costPerBuyingUnitUgx: 20_000,
      },
    ],
    totalCostUgx: 40_000,
    amountPaidUgx: 40_000,
    balanceDeltaUgx: 0,
    notes: "",
    createdAt: "2026-06-01T10:00:00.000Z",
    voidedAt: "2026-06-01T11:00:00.000Z",
    voidReason: "Wrong batch",
    pendingSync: true,
    ...overrides,
  };
}

describe("purchaseVoidStockSync", () => {
  it("pushes negative stock only when purchase was synced before void", () => {
    expect(
      shouldPushVoidStockReversal({
        voidedAt: "2026-06-01T11:00:00.000Z",
        preVoidCloudSynced: true,
        voidStockSyncedAt: null,
      }),
    ).toBe(true);
    expect(
      shouldPushVoidStockReversal({
        voidedAt: "2026-06-01T11:00:00.000Z",
        preVoidCloudSynced: false,
        voidStockSyncedAt: null,
      }),
    ).toBe(false);
    expect(
      shouldPushVoidStockReversal({
        voidedAt: "2026-06-01T11:00:00.000Z",
        preVoidCloudSynced: true,
        voidStockSyncedAt: "2026-06-01T11:05:00.000Z",
      }),
    ).toBe(false);
  });

  it("computes negative base-unit deltas for pack lines", () => {
    const purchase = voidedPurchase();
    const deltas = computeVoidStockDeltas(purchase, [packProduct]);
    expect(deltas).toEqual([{ productId: PRODUCT_ID, delta: -200 }]);
  });

  it("computes negative deltas for base_units lines without double conversion", () => {
    const purchase = voidedPurchase({
      lines: [
        {
          productId: PRODUCT_ID,
          name: "Paracetamol",
          qtyBuyingUnits: 50,
          costPerBuyingUnitUgx: 200,
          unitMode: "base_units",
        },
      ],
    });
    expect(purchaseLineBaseUnitsIn(packProduct, purchase.lines[0]!)).toBe(50);
    const deltas = computeVoidStockDeltas(purchase, [packProduct]);
    expect(deltas).toEqual([{ productId: PRODUCT_ID, delta: -50 }]);
  });

  it("duplicate void stock push is skipped after voidStockSyncedAt", () => {
    const purchase = voidedPurchase({
      preVoidCloudSynced: true,
      voidStockSyncedAt: "2026-06-01T11:05:00.000Z",
    });
    expect(shouldPushVoidStockReversal(purchase)).toBe(false);
  });
});
