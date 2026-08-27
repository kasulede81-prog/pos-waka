import { describe, expect, it } from "vitest";
import {
  classifyPendingStockPayload,
  r3AdjustmentStockPayload,
  r3InventoryCountStockPayload,
  shouldAckR3StockResult,
} from "./stockDurableSync";

const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADJ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PURCHASE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("stockDurableSync — payload identity", () => {
  it("stamps explicit adjustment referenceType/referenceId", () => {
    const p = r3AdjustmentStockPayload({
      productId: PRODUCT,
      delta: -3,
      adjustmentId: ADJ,
      note: "damaged",
    });
    expect(p.referenceType).toBe("adjustment");
    expect(p.referenceId).toBe(ADJ);
    expect(p.note).toBe("damaged");
  });

  it("stamps explicit inventory_count session identity", () => {
    const p = r3InventoryCountStockPayload({
      productId: PRODUCT,
      delta: -6,
      sessionId: SESSION,
    });
    expect(p.referenceType).toBe("inventory_count");
    expect(p.referenceId).toBe(SESSION);
  });

  it("does not treat note text as the durable identity", () => {
    const classified = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: -3,
      note: "inventory_count:not-an-id-authority",
    });
    expect(classified.route).toBe("quarantine");
  });
});

describe("stockDurableSync — classifyPendingStockPayload", () => {
  it("routes purchase kind to 166 path", () => {
    expect(classifyPendingStockPayload({ kind: "purchase", purchaseId: PURCHASE }).route).toBe("purchase");
    expect(classifyPendingStockPayload({ kind: "purchase_void", purchaseId: PURCHASE }).route).toBe("purchase_void");
  });

  it("routes purchase: note to 166 stock RPC", () => {
    const r = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: 12,
      note: `purchase:${PURCHASE}`,
    });
    expect(r.route).toBe("purchase_note");
  });

  it("leaves sale void on the frozen legacy path", () => {
    const r = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: 2,
      note: "void",
    });
    expect(r.route).toBe("legacy_void");
  });

  it("routes explicit R3 adjustment", () => {
    const r = classifyPendingStockPayload(
      r3AdjustmentStockPayload({ productId: PRODUCT, delta: -1, adjustmentId: ADJ }),
    );
    expect(r).toEqual({
      route: "r3_adjustment",
      productId: PRODUCT,
      delta: -1,
      referenceId: ADJ,
      note: "",
    });
  });

  it("routes explicit R3 count", () => {
    const r = classifyPendingStockPayload(
      r3InventoryCountStockPayload({ productId: PRODUCT, delta: -2, sessionId: SESSION }),
    );
    expect(r.route).toBe("r3_count");
    if (r.route === "r3_count") expect(r.referenceId).toBe(SESSION);
  });

  it("T16 — R3-domain generic delta without referenceId is quarantined", () => {
    for (const note of ["damaged", "lost", "added", "count", "writeoff_expired", "supplier_return", "controlled_return"]) {
      const r = classifyPendingStockPayload({ productId: PRODUCT, delta: -4, note });
      expect(r.route).toBe("quarantine");
      if (r.route === "quarantine") expect(r.reason).toBe("r3_legacy_generic_delta");
    }
  });

  it("quarantines R3 type with missing/invalid referenceId", () => {
    const r = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: -1,
      referenceType: "adjustment",
      note: "damaged",
    });
    expect(r.route).toBe("quarantine");
    if (r.route === "quarantine") expect(r.reason).toBe("r3_missing_reference");
  });
});

describe("stockDurableSync — R3 retry ACK", () => {
  it("ACKs first apply and idempotent replay; never treats them as a rebase license", () => {
    expect(shouldAckR3StockResult({ ok: true, idempotent: false })).toBe(true);
    expect(shouldAckR3StockResult({ ok: true, idempotent: true })).toBe(true);
    expect(shouldAckR3StockResult({ ok: false })).toBe(false);
    expect(shouldAckR3StockResult(null)).toBe(false);
  });
});
