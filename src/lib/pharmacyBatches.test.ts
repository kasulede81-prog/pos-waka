import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { lineCostForProductQuantity } from "./costPrecision";
import {
  allocateFefo,
  appendBatchToProduct,
  createBatchOnReceive,
  computeBatchIntegrity,
  deductProductBatchesFefo,
  getProductBatches,
  reconcileBatchQuantitiesToStock,
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
    const next = appendBatchToProduct(
      product({ stockOnHand: 40 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 40, unitCostUgx: 100 }),
    );
    const result = deductProductBatchesFefo(next, 15, { at: "2026-01-01T10:00:00.000Z", refId: "sale-1" });
    expect(sumBatchRemaining(getProductBatches(result.product))).toBe(25);
    expect(getProductBatches(result.product)[0]!.timeline.some((e) => e.type === "dispensed")).toBe(true);
  });

  it("detects batch integrity mismatch without repairing", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 40 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const integrity = computeBatchIntegrity(next);
    expect(integrity.ok).toBe(false);
    expect(integrity.delta).toBe(10);
    // Never auto-repairs: the product returned by the detector is untouched.
    expect(getProductBatches(next)[0]!.quantityRemaining).toBe(30);
    expect(next.stockOnHand).toBe(40);
  });
});

/**
 * WAKA POS — Pharmacy Correction Phase 1: batch quantity integrity (item H/I).
 *
 * `stockOnHand` on the core Product is the single authoritative quantity —
 * the batch sub-ledger is operational visibility layered on top and "should"
 * sum to the same number, but nothing here may ever silently mutate the
 * authoritative stock/cost fields to force agreement.
 */
describe("computeBatchIntegrity — H/I: detection for both directions of drift", () => {
  it("H — reports ok when batch quantities already reconcile to stockOnHand", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 30 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const integrity = computeBatchIntegrity(next);
    expect(integrity.ok).toBe(true);
    expect(integrity.delta).toBe(0);
  });

  it("I — detects a shortfall (stockOnHand higher than batch sum)", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 40 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const integrity = computeBatchIntegrity(next);
    expect(integrity.ok).toBe(false);
    expect(integrity.delta).toBe(10); // stockOnHand is 10 ahead of the batch sum
  });

  it("I — detects a surplus (batch sum higher than stockOnHand)", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 20 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const integrity = computeBatchIntegrity(next);
    expect(integrity.ok).toBe(false);
    expect(integrity.delta).toBe(-10); // batches are 10 ahead of stockOnHand
  });

  it("not batch-tracked (batchTracked: false) is always reported ok regardless of any mismatch", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 999, pharmacyMaster: { batchTracked: false, expiryTracked: false } }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 1, unitCostUgx: 100 }),
    );
    expect(computeBatchIntegrity(next).ok).toBe(true);
  });
});

describe("reconcileBatchQuantitiesToStock — safe reconciliation path (item 5)", () => {
  it("does nothing (and reports ok) when already reconciled", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 30 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const result = reconcileBatchQuantitiesToStock(next);
    expect(result.ok).toBe(true);
    expect(result.delta).toBe(0);
    expect(result.product).toBe(next); // unchanged reference — no rewrite happened
  });

  it("shortfall: credits the missing units to the batch with the furthest expiry, preserving FEFO order of the rest", () => {
    let next = appendBatchToProduct(
      product({ stockOnHand: 40 }),
      createBatchOnReceive({ batchNumber: "SOON", expiryDate: "2026-03-01", quantityBase: 20, unitCostUgx: 100 }),
    );
    next = appendBatchToProduct(
      next,
      createBatchOnReceive({ batchNumber: "LATE", expiryDate: "2027-06-01", quantityBase: 10, unitCostUgx: 100 }),
    );
    // stockOnHand=40, batch sum=30 -> shortfall of 10
    const before = computeBatchIntegrity(next);
    expect(before.ok).toBe(false);
    expect(before.delta).toBe(10);

    const result = reconcileBatchQuantitiesToStock(next, { actorUserId: "u1", actorName: "Manager", note: "count correction" });
    expect(result.ok).toBe(false); // ok describes the PRE-reconciliation state
    expect(result.delta).toBe(10);
    const batches = getProductBatches(result.product);
    expect(sumBatchRemaining(batches)).toBe(40);
    const late = batches.find((b) => b.batchNumber === "LATE")!;
    expect(late.quantityRemaining).toBe(20); // 10 original + 10 credited
    const soon = batches.find((b) => b.batchNumber === "SOON")!;
    expect(soon.quantityRemaining).toBe(20); // untouched
    expect(late.timeline.some((e) => e.type === "adjusted")).toBe(true);
    // Core authoritative fields are never touched by reconciliation.
    expect(result.product.stockOnHand).toBe(40);
    expect(result.product.costPricePerUnitUgx).toBe(next.costPricePerUnitUgx);

    // Re-running integrity now reports ok.
    expect(computeBatchIntegrity(result.product).ok).toBe(true);
  });

  it("surplus: removes the excess FEFO-first (earliest-expiring batches first)", () => {
    let next = appendBatchToProduct(
      product({ stockOnHand: 20 }),
      createBatchOnReceive({ batchNumber: "SOON", expiryDate: "2026-03-01", quantityBase: 15, unitCostUgx: 100 }),
    );
    next = appendBatchToProduct(
      next,
      createBatchOnReceive({ batchNumber: "LATE", expiryDate: "2027-06-01", quantityBase: 15, unitCostUgx: 100 }),
    );
    // stockOnHand=20, batch sum=30 -> surplus of 10
    const result = reconcileBatchQuantitiesToStock(next);
    expect(result.delta).toBe(-10);
    const batches = getProductBatches(result.product);
    expect(sumBatchRemaining(batches)).toBe(20);
    const soon = batches.find((b) => b.batchNumber === "SOON")!;
    expect(soon.quantityRemaining).toBe(5); // 15 - 10 removed first (earliest expiry)
    const late = batches.find((b) => b.batchNumber === "LATE")!;
    expect(late.quantityRemaining).toBe(15); // untouched
    expect(computeBatchIntegrity(result.product).ok).toBe(true);
  });

  it("never touches stockOnHand, cost, or creates/voids a Sale — only batch quantities move", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 40, costPricePerUnitUgx: 250 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 100 }),
    );
    const result = reconcileBatchQuantitiesToStock(next);
    expect(result.product.stockOnHand).toBe(40); // untouched
    expect(result.product.costPricePerUnitUgx).toBe(250); // untouched
    expect(result.product.packCostUnitsDepleted).toBe(next.packCostUnitsDepleted); // untouched
  });
});

/**
 * WAKA POS — Pharmacy Correction Phase 1: batch cost boundary (item J).
 *
 * A batch's own unitCostUgx (captured at receive time for inventory-value
 * and write-off-loss reporting) must never be consulted by the sale-COGS
 * engine — there is exactly one COGS mechanism, and it always prices from
 * the authoritative Product fields, regardless of what any individual
 * batch happens to record.
 */
describe("batch cost never creates a second COGS ledger (item J)", () => {
  it("sale-line COGS uses the product's authoritative cost, not a selected batch's unitCostUgx", () => {
    const p = appendBatchToProduct(
      product({ stockOnHand: 30, costPricePerUnitUgx: 200 }),
      createBatchOnReceive({ batchNumber: "EXPENSIVE-BATCH", expiryDate: "2026-04-01", quantityBase: 30, unitCostUgx: 999 }),
    );
    // FEFO would select this exact (only) batch for a sale of 5 units.
    const fefo = deductProductBatchesFefo(p, 5, { at: "2026-01-01T10:00:00.000Z" });
    expect(fefo.allocations[0]!.batchId).toBe(getProductBatches(p)[0]!.id);

    // The authoritative sale-COGS calculation is entirely independent of
    // that batch selection and its unitCostUgx (999) — it only ever reads
    // the product's own costPricePerUnitUgx (200).
    const cogs = lineCostForProductQuantity(fefo.product, 5);
    expect(cogs).toBe(1_000); // 5 * 200, NOT 5 * 999 = 4,995
  });
});
