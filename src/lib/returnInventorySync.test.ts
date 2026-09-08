import { describe, expect, it } from "vitest";
import type { ReturnReason } from "../types";
import { returnRestocksInventory } from "./returnPolicy";
import { returnStockDelta, applyStockDeltas } from "./inventoryIntegrity";

const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RETURN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const REASONS: ReturnReason[] = ["wrong_item", "damaged", "broken", "warm_bad", "other"];

describe("returnInventorySync — returnRestocksInventory", () => {
  it("sellable returns restock; damaged/broken/warm do not", () => {
    expect(returnRestocksInventory("wrong_item")).toBe(true);
    expect(returnRestocksInventory("other")).toBe(true);
    expect(returnRestocksInventory("damaged")).toBe(false);
    expect(returnRestocksInventory("broken")).toBe(false);
    expect(returnRestocksInventory("warm_bad")).toBe(false);
  });
});

describe("returnInventorySync — returnStockDelta reconciliation", () => {
  it("wrong_item return increases expected stock in movement ledger", () => {
    const delta = returnStockDelta(RETURN_ID, PRODUCT_ID, 3, "wrong_item", "2026-06-01T10:00:00.000Z");
    expect(delta.delta).toBe(3);
    expect(applyStockDeltas(10, [delta])).toBe(13);
  });

  it("other return also restocks sellable inventory", () => {
    const delta = returnStockDelta(RETURN_ID, PRODUCT_ID, 1, "other", "2026-06-01T10:00:00.000Z");
    expect(delta.delta).toBe(1);
    expect(applyStockDeltas(11, [delta])).toBe(12);
  });

  for (const reason of ["damaged", "broken", "warm_bad"] as const) {
    it(`${reason} return does not increase stock in movement ledger`, () => {
      const delta = returnStockDelta(RETURN_ID, PRODUCT_ID, 3, reason, "2026-06-01T10:00:00.000Z");
      expect(delta.delta).toBe(0);
      expect(applyStockDeltas(10, [delta])).toBe(10);
    });
  }

  it("cloud-aligned policy: unsellable reasons never add quantity", () => {
    for (const reason of REASONS) {
      const delta = returnStockDelta(RETURN_ID, PRODUCT_ID, 5, reason, "2026-06-01T10:00:00.000Z");
      const expectedDelta = returnRestocksInventory(reason) ? 5 : 0;
      expect(delta.delta).toBe(expectedDelta);
    }
  });
});

/** Mirrors apply_sale_return_stock guard in migration 181. */
function simulateServerApplyReturnStock(
  currentStock: number,
  quantity: number,
  reason: ReturnReason,
  alreadyApplied: boolean,
): { stock: number; applied: boolean } {
  if (alreadyApplied) return { stock: currentStock, applied: true };
  if (!returnRestocksInventory(reason)) {
    return { stock: currentStock, applied: true };
  }
  return { stock: currentStock + quantity, applied: true };
}

describe("returnInventorySync — server-side return processing policy", () => {
  it("wrong_item increases server stock once", () => {
    const first = simulateServerApplyReturnStock(4, 2, "wrong_item", false);
    expect(first.stock).toBe(6);
    const second = simulateServerApplyReturnStock(first.stock, 2, "wrong_item", true);
    expect(second.stock).toBe(6);
  });

  it("damaged return does not increase server stock", () => {
    const result = simulateServerApplyReturnStock(4, 2, "damaged", false);
    expect(result.stock).toBe(4);
    expect(result.applied).toBe(true);
  });
});
