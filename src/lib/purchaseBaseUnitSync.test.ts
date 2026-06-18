import { describe, expect, it } from "vitest";
import type { Product, Purchase } from "../types";
import {
  parsePurchaseLineFromCloud,
  purchaseLineBaseUnitsIn,
  serializePurchaseLineForCloud,
} from "./purchaseLineSync";
import { buyingUnitsToBaseUnits } from "./sellingEngine";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const packProduct: Product = {
  id: PRODUCT_ID,
  name: "Rice sack",
  sellingPricePerUnitUgx: 5_000,
  costPricePerUnitUgx: 1_000,
  stockOnHand: 10,
  baseUnit: "kg",
  sellingMode: "unit",
  buyingUnit: "sack",
  conversionRate: 50,
  category: "General",
  sku: "",
  minimumStockAlert: 2,
  updatedAt: "2026-06-01T09:00:00.000Z",
  version: 1,
};

const pharmacyProduct: Product = {
  ...packProduct,
  name: "Amoxicillin",
  baseUnit: "capsule",
  buyingUnit: "strip",
  conversionRate: 10,
  category: "Pharmacy",
};

const weightedProduct: Product = {
  id: PRODUCT_ID,
  name: "Sugar",
  sellingPricePerUnitUgx: 4_000,
  costPricePerUnitUgx: 3_000,
  stockOnHand: 5,
  baseUnit: "kg",
  sellingMode: "weighted",
  category: "General",
  sku: "",
  minimumStockAlert: 1,
  updatedAt: "2026-06-01T09:00:00.000Z",
  version: 1,
};

describe("purchaseBaseUnitSync", () => {
  it("converts buying_units pack purchase to base units", () => {
    const line = { productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 2, costPerBuyingUnitUgx: 50_000 };
    expect(purchaseLineBaseUnitsIn(packProduct, line)).toBe(100);
    expect(purchaseLineBaseUnitsIn(packProduct, line)).toBe(buyingUnitsToBaseUnits(packProduct, 2));
  });

  it("does not reconvert base_units pharmacy direct entry", () => {
    const line = {
      productId: PRODUCT_ID,
      name: "Amoxicillin",
      qtyBuyingUnits: 30,
      costPerBuyingUnitUgx: 500,
      unitMode: "base_units" as const,
    };
    expect(purchaseLineBaseUnitsIn(pharmacyProduct, line)).toBe(30);
    expect(purchaseLineBaseUnitsIn(pharmacyProduct, line)).not.toBe(
      buyingUnitsToBaseUnits(pharmacyProduct, 30),
    );
  });

  it("serializes and parses unitMode for cloud round-trip", () => {
    const line = {
      productId: PRODUCT_ID,
      name: "Amoxicillin",
      qtyBuyingUnits: 30,
      costPerBuyingUnitUgx: 500,
      unitMode: "base_units" as const,
    };
    const cloud = serializePurchaseLineForCloud(line);
    expect(cloud.unitMode).toBe("base_units");
    const parsed = parsePurchaseLineFromCloud(cloud);
    expect(parsed?.unitMode).toBe("base_units");
    expect(purchaseLineBaseUnitsIn(pharmacyProduct, parsed!)).toBe(30);
  });

  it("weighted product buying_units still converts once", () => {
    const line = { productId: PRODUCT_ID, name: "Sugar", qtyBuyingUnits: 3, costPerBuyingUnitUgx: 9_000 };
    expect(purchaseLineBaseUnitsIn(weightedProduct, line)).toBe(3);
  });

  it("mixed bundle uses correct mode per line", () => {
    const purchase: Purchase = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      supplierId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      supplierName: "Mixed",
      lines: [
        { productId: PRODUCT_ID, name: "Rice", qtyBuyingUnits: 1, costPerBuyingUnitUgx: 50_000 },
        {
          productId: PRODUCT_ID,
          name: "Amoxicillin",
          qtyBuyingUnits: 20,
          costPerBuyingUnitUgx: 400,
          unitMode: "base_units",
        },
      ],
      totalCostUgx: 58_000,
      amountPaidUgx: 58_000,
      balanceDeltaUgx: 0,
      notes: "",
      createdAt: "2026-06-01T10:00:00.000Z",
      pendingSync: false,
    };
    const packLine = purchaseLineBaseUnitsIn(packProduct, purchase.lines[0]!);
    const pharmaLine = purchaseLineBaseUnitsIn(pharmacyProduct, purchase.lines[1]!);
    expect(packLine).toBe(50);
    expect(pharmaLine).toBe(20);
  });
});
