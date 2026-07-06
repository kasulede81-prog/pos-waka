import { describe, expect, it } from "vitest";
import type { Product, Sale } from "../types";
import { appendBatchToProduct, createBatchOnReceive, getProductBatches } from "./pharmacyBatches";
import { resolveControlledReturnBatch, restoreProductFromControlledReturn } from "./pharmacyControlledReturn";

function baseProduct(): Product {
  return {
    id: "p1",
    name: "Morphine 10mg",
    sellingMode: "unit",
    baseUnit: "tablet",
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    stockOnHand: 10,
    minimumStockAlert: 5,
    category: "Analgesic",
    sku: "",
    updatedAt: "",
    version: 1,
    pharmacyMaster: { batchTracked: true, expiryTracked: true },
  };
}

function batchedProduct(): Product {
  let p = baseProduct();
  p = appendBatchToProduct(
    p,
    createBatchOnReceive({
      batchNumber: "LOT-A",
      expiryDate: "2026-12-31",
      quantityBase: 5,
      unitCostUgx: 500,
    }),
  );
  p = appendBatchToProduct(
    p,
    createBatchOnReceive({
      batchNumber: "LOT-B",
      expiryDate: "2027-06-30",
      quantityBase: 5,
      unitCostUgx: 500,
    }),
  );
  return p;
}

describe("pharmacyControlledReturn", () => {
  it("resolves batch from sale line batch override", () => {
    const product = batchedProduct();
    const batchA = getProductBatches(product)[0]!;
    const sale: Sale = {
      id: "s1",
      lines: [
        {
          productId: "p1",
          name: "Morphine",
          inputMode: "quantity",
          quantity: 2,
          unitPriceUgx: 1000,
          unitCostUgx: 500,
          lineTotalUgx: 2000,
          estimatedProfitUgx: 1000,
          pharmacyBatchOverrideId: batchA.id,
        },
      ],
      subtotalUgx: 2000,
      totalUgx: 2000,
      cashPaidUgx: 2000,
      debtUgx: 0,
      estimatedProfitUgx: 1000,
      createdAt: "2025-07-01T10:00:00.000Z",
      pendingSync: false,
    };
    const r = resolveControlledReturnBatch({
      product,
      quantity: 2,
      sale,
      productId: "p1",
    });
    expect(r.ok).toBe(true);
    expect(r.batchId).toBe(batchA.id);
    expect(r.allocations?.[0]?.quantity).toBe(2);
  });

  it("requires manager override when batch unknown and batches exist", () => {
    const r = resolveControlledReturnBatch({
      product: batchedProduct(),
      quantity: 1,
      productId: "p1",
    });
    expect(r.ok).toBe(false);
    expect(r.errorKey).toBe("pharmacyControlledReturnBatchRequired");
  });

  it("restores batch quantity via applyBatchRestorations", () => {
    const product = batchedProduct();
    const batchA = getProductBatches(product)[0]!;
    const restored = restoreProductFromControlledReturn(
      product,
      [{ batchId: batchA.id, batchNumber: batchA.batchNumber, expiryDate: batchA.expiryDate, quantity: 3 }],
      "2025-07-01T12:00:00.000Z",
      "return-1",
      "staff-1",
      "Jane",
    );
    const batch = getProductBatches(restored).find((b) => b.id === batchA.id);
    expect(batch?.quantityRemaining).toBe(8);
  });
});
