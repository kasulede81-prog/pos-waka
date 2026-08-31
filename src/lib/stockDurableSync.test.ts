import { describe, expect, it } from "vitest";
import {
  classifyPendingStockPayload,
  r3AdjustmentStockPayload,
  r3InventoryCountStockPayload,
  r3PurchaseVoidStockPayload,
  r3SaleVoidStockPayload,
  shouldAckR3StockResult,
} from "./stockDurableSync";
import {
  stableVoidLineIdentity,
  stableVoidLineMovementId,
  stableVoidRecordId,
} from "./saleLifecycle";

const PRODUCT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab";
const ADJ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PURCHASE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VOID_REC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SALE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SHOP_KEY = "sb:user:shop-a";

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

  it("stamps explicit sale_void void_record identity", () => {
    const p = r3SaleVoidStockPayload({
      productId: PRODUCT,
      delta: 2,
      voidRecordId: VOID_REC,
    });
    expect(p.referenceType).toBe("sale_void");
    expect(p.referenceId).toBe(VOID_REC);
    expect(p.delta).toBe(2);
  });

  it("stamps explicit purchase_void purchase identity (negative delta)", () => {
    const p = r3PurchaseVoidStockPayload({
      productId: PRODUCT,
      delta: -12,
      purchaseId: PURCHASE,
    });
    expect(p.referenceType).toBe("purchase_void");
    expect(p.referenceId).toBe(PURCHASE);
    expect(p.delta).toBe(-12);
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

  it("T14 — quarantines legacy purchase_void note without referenceType", () => {
    const r = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: -10,
      note: `purchase_void:${PURCHASE}`,
    });
    expect(r.route).toBe("quarantine");
    if (r.route === "quarantine") expect(r.reason).toBe("purchase_void_missing_reference");
  });

  it("routes durable purchase_void_line to dedicated path", () => {
    const r = classifyPendingStockPayload(
      r3PurchaseVoidStockPayload({ productId: PRODUCT, delta: -5, purchaseId: PURCHASE }),
    );
    expect(r).toEqual({
      route: "purchase_void_line",
      productId: PRODUCT,
      delta: -5,
      referenceId: PURCHASE,
      note: "purchase_void",
    });
  });

  it("quarantines kind purchase_void without trustworthy purchaseId", () => {
    const r = classifyPendingStockPayload({ kind: "purchase_void", purchaseId: "not-a-uuid" });
    expect(r.route).toBe("quarantine");
    if (r.route === "quarantine") expect(r.reason).toBe("purchase_void_missing_reference");
  });

  it("routes purchase: note to 166 stock RPC", () => {
    const r = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: 12,
      note: `purchase:${PURCHASE}`,
    });
    expect(r.route).toBe("purchase_note");
  });

  it("routes durable sale_void to dedicated path (not generic RPC)", () => {
    const r = classifyPendingStockPayload(
      r3SaleVoidStockPayload({ productId: PRODUCT, delta: 2, voidRecordId: VOID_REC }),
    );
    expect(r).toEqual({
      route: "sale_void",
      productId: PRODUCT,
      delta: 2,
      referenceId: VOID_REC,
      note: "",
    });
  });

  it("quarantines legacy note:void without durable reference", () => {
    const r = classifyPendingStockPayload({
      productId: PRODUCT,
      delta: 2,
      note: "void",
    });
    expect(r.route).toBe("quarantine");
    if (r.route === "quarantine") expect(r.reason).toBe("sale_void_missing_reference");
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

describe("stockDurableSync — durable stock retry ACK", () => {
  it("ACKs first apply and idempotent replay; never treats them as a rebase license", () => {
    expect(shouldAckR3StockResult({ ok: true, idempotent: false })).toBe(true);
    expect(shouldAckR3StockResult({ ok: true, idempotent: true })).toBe(true);
    expect(shouldAckR3StockResult({ ok: false })).toBe(false);
    expect(shouldAckR3StockResult(null)).toBe(false);
  });
});

describe("SALE-VOID-STOCK-1.0 — stable void identities", () => {
  it("creates stable void_record_id that survives retry", () => {
    const identity = stableVoidLineIdentity(SALE, 0, "line-1");
    const first = stableVoidRecordId(SHOP_KEY, SALE, identity);
    const retry = stableVoidRecordId(SHOP_KEY, SALE, identity);
    expect(first).toBe(retry);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("multi-line void produces distinct durable line identities", () => {
    const a = stableVoidRecordId(SHOP_KEY, SALE, stableVoidLineIdentity(SALE, 0, "line-a"));
    const b = stableVoidRecordId(SHOP_KEY, SALE, stableVoidLineIdentity(SALE, 1, "line-b"));
    expect(a).not.toBe(b);
    const moveA = stableVoidLineMovementId(SHOP_KEY, SALE, stableVoidLineIdentity(SALE, 0, "line-a"), PRODUCT);
    const moveB = stableVoidLineMovementId(SHOP_KEY, SALE, stableVoidLineIdentity(SALE, 1, "line-b"), PRODUCT_B);
    expect(moveA).not.toBe(moveB);
  });

  it("queue payload retains immutable void referenceId for retry", () => {
    const voidRecordId = stableVoidRecordId(SHOP_KEY, SALE, stableVoidLineIdentity(SALE, 0, null));
    const first = r3SaleVoidStockPayload({ productId: PRODUCT, delta: 3, voidRecordId });
    const retry = r3SaleVoidStockPayload({ productId: PRODUCT, delta: 3, voidRecordId });
    expect(first.referenceId).toBe(voidRecordId);
    expect(retry.referenceId).toBe(first.referenceId);
    expect(first.referenceType).toBe("sale_void");
  });
});
