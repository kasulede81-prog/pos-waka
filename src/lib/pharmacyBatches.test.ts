import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  allocateFefo,
  appendBatchToProduct,
  createBatchOnReceive,
  computeBatchIntegrity,
  deductProductBatchesFefo,
  getProductBatches,
  sortBatchesFefo,
  sumBatchRemaining,
} from "./pharmacyBatches";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Paracetamol",
    sellingMode: "unit",
    baseUnit: "tablet",
    sellingPricePerUnitUgx: 500,
    costPricePerUnitUgx: 200,
    stockOnHand: 100,
    minimumStockAlert: 10,
    category: "Pain relief",
    sku: "",
    updatedAt: new Date().toISOString(),
    version: 1,
    pharmacyMaster: { batchTracked: true, expiryTracked: true },
    ...overrides,
  };
}

describe("pharmacyBatches", () => {
  it("creates batch on receive and appends to product", () => {
    const batch = createBatchOnReceive({
      batchNumber: "BN-001",
      expiryDate: "2026-12-31",
      quantityBase: 50,
      unitCostUgx: 180,
    });
    const next = appendBatchToProduct(product(), batch);
    expect(getProductBatches(next)).toHaveLength(1);
    expect(getProductBatches(next)[0]!.quantityRemaining).toBe(50);
    expect(next.expiryDate).toBe("2026-12-31");
  });

  it("allocates FEFO by earliest expiry first", () => {
    const p = product();
    let next = appendBatchToProduct(
      p,
      createBatchOnReceive({ batchNumber: "LATE", expiryDate: "2027-06-01", quantityBase: 20, unitCostUgx: 100 }),
    );
    next = appendBatchToProduct(
      next,
      createBatchOnReceive({ batchNumber: "SOON", expiryDate: "2026-03-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const batches = getProductBatches(next);
    const sorted = sortBatchesFefo(batches);
    expect(sorted[0]!.batchNumber).toBe("SOON");
    const alloc = allocateFefo(batches, 25);
    expect(alloc.allocations).toHaveLength(1);
    expect(alloc.allocations[0]!.batchNumber).toBe("SOON");
    expect(alloc.allocations[0]!.quantity).toBe(25);
    const allocSpan = allocateFefo(batches, 35);
    expect(allocSpan.allocations).toHaveLength(2);
    expect(allocSpan.allocations[1]!.batchNumber).toBe("LATE");
    expect(allocSpan.allocations[1]!.quantity).toBe(5);
  });

  it("deducts batches on dispense", () => {
    let next = appendBatchToProduct(
      product({ stockOnHand: 40 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 40, unitCostUgx: 100 }),
    );
    const result = deductProductBatchesFefo(next, 15, { at: "2026-01-01T10:00:00.000Z", refId: "sale-1" });
    expect(sumBatchRemaining(getProductBatches(result.product))).toBe(25);
    expect(getProductBatches(result.product)[0]!.timeline.some((e) => e.type === "dispensed")).toBe(true);
  });

  it("detects batch integrity mismatch without repairing", () => {
    let next = appendBatchToProduct(
      product({ stockOnHand: 40 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const integrity = computeBatchIntegrity(next);
    expect(integrity.ok).toBe(false);
    expect(integrity.delta).toBe(10);
  });
});
