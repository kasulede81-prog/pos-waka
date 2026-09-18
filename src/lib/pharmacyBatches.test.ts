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
  writeOffFromBatches,
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
    // Explicit `at` anchor (well before either expiry date) keeps both
    // batches genuinely "active" regardless of when this test actually
    // runs — status is computed relative to `at`, not wall-clock "now".
    const receivedAt = "2026-01-01T00:00:00.000Z";
    const p = product();
    let next = appendBatchToProduct(
      p,
      createBatchOnReceive({ batchNumber: "LATE", expiryDate: "2027-06-01", quantityBase: 20, unitCostUgx: 100, at: receivedAt }),
    );
    next = appendBatchToProduct(
      next,
      createBatchOnReceive({ batchNumber: "SOON", expiryDate: "2026-03-01", quantityBase: 30, unitCostUgx: 100, at: receivedAt }),
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
      createBatchOnReceive({
        batchNumber: "A",
        expiryDate: "2026-04-01",
        quantityBase: 40,
        unitCostUgx: 100,
        at: "2026-01-01T00:00:00.000Z", // keeps the batch "active" regardless of wall-clock "now"
      }),
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
    const receivedAt = "2026-01-01T00:00:00.000Z"; // keeps both batches "active" for the FEFO removal order
    let next = appendBatchToProduct(
      product({ stockOnHand: 20 }),
      createBatchOnReceive({ batchNumber: "SOON", expiryDate: "2026-03-01", quantityBase: 15, unitCostUgx: 100, at: receivedAt }),
    );
    next = appendBatchToProduct(
      next,
      createBatchOnReceive({ batchNumber: "LATE", expiryDate: "2027-06-01", quantityBase: 15, unitCostUgx: 100, at: receivedAt }),
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
      createBatchOnReceive({
        batchNumber: "EXPENSIVE-BATCH",
        expiryDate: "2026-04-01",
        quantityBase: 30,
        unitCostUgx: 999,
        at: "2026-01-01T00:00:00.000Z", // keeps the batch "active" so normal FEFO can select it
      }),
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

/**
 * WAKA POS — Pharmacy Phase 2: FEFO/expiry hardening.
 *
 * DEFECT FIXED: sortBatchesFefo/allocateFefo used to include
 * status === "expired" batches in the DEFAULT (automatic) pool. Since an
 * expired batch always sorts earliest, a product with both expired and
 * active stock would have FEFO draw from the expired batch FIRST for an
 * ordinary sale — even under a shop's "block expired sales" policy, because
 * that policy's guard checks product-level expiry, which is false whenever
 * ANY non-expired stock exists. Default is now to exclude expired batches
 * from automatic allocation; write-offs explicitly opt back in via
 * `{ includeExpired: true }` (the one legitimate exception — removing
 * expired stock is the entire point of a write-off); an explicit
 * `overrideBatchId` still bypasses status entirely, unchanged.
 */
describe("FEFO/expiry hardening — item B/C/E (Phase 2)", () => {
  it("B — an expired batch is excluded from normal (automatic) FEFO allocation", () => {
    let next = appendBatchToProduct(
      product({ stockOnHand: 50 }),
      createBatchOnReceive({
        batchNumber: "EXPIRED",
        expiryDate: "2026-03-01",
        quantityBase: 20,
        unitCostUgx: 100,
        at: "2026-04-01T00:00:00.000Z", // received AFTER its own expiry -> status "expired" at creation
      }),
    );
    next = appendBatchToProduct(
      next,
      createBatchOnReceive({
        batchNumber: "ACTIVE",
        expiryDate: "2027-01-01",
        quantityBase: 30,
        unitCostUgx: 100,
        at: "2026-04-01T00:00:00.000Z",
      }),
    );
    const batches = getProductBatches(next);
    expect(batches.find((b) => b.batchNumber === "EXPIRED")!.status).toBe("expired");

    const sorted = sortBatchesFefo(batches);
    expect(sorted.map((b) => b.batchNumber)).toEqual(["ACTIVE"]); // EXPIRED never even appears in the pool

    const alloc = allocateFefo(batches, 10);
    expect(alloc.allocations).toHaveLength(1);
    expect(alloc.allocations[0]!.batchNumber).toBe("ACTIVE"); // not EXPIRED, even though it expires "earlier"
  });

  it("B2 — an explicit overrideBatchId can still target an expired batch deliberately (unchanged)", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 20 }),
      createBatchOnReceive({
        batchNumber: "EXPIRED",
        expiryDate: "2026-03-01",
        quantityBase: 20,
        unitCostUgx: 100,
        at: "2026-04-01T00:00:00.000Z",
      }),
    );
    const expired = getProductBatches(next)[0]!;
    const alloc = allocateFefo(getProductBatches(next), 5, expired.id);
    expect(alloc.usedOverride).toBe(true);
    expect(alloc.allocations[0]!.batchId).toBe(expired.id);
  });

  it("write-offs can still reach expired stock with no specific batch chosen (the one legitimate exception)", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 20 }),
      createBatchOnReceive({
        batchNumber: "EXPIRED",
        expiryDate: "2026-03-01",
        quantityBase: 20,
        unitCostUgx: 100,
        at: "2026-04-01T00:00:00.000Z",
      }),
    );
    const result = writeOffFromBatches(next, 5, "damaged"); // no batchId, reason isn't "expired" either
    expect(result.writtenOff).toBe(5);
    expect(getProductBatches(result.product)[0]!.quantityRemaining).toBe(15);
  });

  it("C — a depleted batch (quantityRemaining 0) is excluded regardless of expiry", () => {
    let next = appendBatchToProduct(
      product({ stockOnHand: 10 }),
      createBatchOnReceive({ batchNumber: "DEPLETED", expiryDate: "2027-01-01", quantityBase: 10, unitCostUgx: 100, at: "2026-01-01T00:00:00.000Z" }),
    );
    // Deplete it fully first.
    const depleted = deductProductBatchesFefo(next, 10, { at: "2026-01-02T00:00:00.000Z" }).product;
    expect(getProductBatches(depleted)[0]!.quantityRemaining).toBe(0);
    expect(getProductBatches(depleted)[0]!.status).toBe("depleted");

    next = appendBatchToProduct(
      depleted,
      createBatchOnReceive({ batchNumber: "FRESH", expiryDate: "2027-06-01", quantityBase: 10, unitCostUgx: 100, at: "2026-01-02T00:00:00.000Z" }),
    );
    const alloc = allocateFefo(getProductBatches(next), 5);
    expect(alloc.allocations).toHaveLength(1);
    expect(alloc.allocations[0]!.batchNumber).toBe("FRESH");
  });

  it("E — insufficient total (eligible) batch quantity reports the shortfall instead of over-allocating", () => {
    const next = appendBatchToProduct(
      product({ stockOnHand: 8 }),
      createBatchOnReceive({ batchNumber: "A", expiryDate: "2027-01-01", quantityBase: 8, unitCostUgx: 100, at: "2026-01-01T00:00:00.000Z" }),
    );
    const alloc = allocateFefo(getProductBatches(next), 15);
    expect(alloc.allocations).toHaveLength(1);
    expect(alloc.allocations[0]!.quantity).toBe(8); // took everything available
    expect(alloc.remainingUnallocated).toBe(7); // honestly reports it couldn't fully allocate
  });
});

/**
 * WAKA POS — Pharmacy Phase 2: unbatched/legacy stock (item I).
 *
 * A product with NO batches at all (batches.length === 0) must be treated
 * as explicitly out-of-scope for batch-quantity comparison — never a false
 * "mismatch" — since core stockOnHand remains authoritative regardless.
 */
describe("unbatched/legacy stock — item I (Phase 2)", () => {
  it("computeBatchIntegrity reports ok for a product with zero batches, any stockOnHand", () => {
    const p = product({ stockOnHand: 250, pharmacyMaster: { batchTracked: true, expiryTracked: true } });
    expect(getProductBatches(p)).toHaveLength(0);
    const integrity = computeBatchIntegrity(p);
    expect(integrity.ok).toBe(true);
    expect(integrity.batchTracked).toBe(true); // tracked, just legitimately has no batches yet
  });

  it("deductProductBatchesFefo is a safe no-op for a product with zero batches", () => {
    const p = product({ stockOnHand: 100 });
    const result = deductProductBatchesFefo(p, 10, { at: "2026-01-01T00:00:00.000Z" });
    expect(result.allocations).toHaveLength(0);
    expect(result.product).toBe(p); // unchanged — core stockOnHand deduction (elsewhere) is unaffected by this no-op
  });

  it("reconcileBatchQuantitiesToStock is a safe no-op for a product with zero batches", () => {
    const p = product({ stockOnHand: 100 });
    const result = reconcileBatchQuantitiesToStock(p);
    expect(result.ok).toBe(true);
    expect(result.product).toBe(p);
  });
});
