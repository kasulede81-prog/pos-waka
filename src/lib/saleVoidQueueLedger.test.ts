import { describe, expect, it } from "vitest";
import { resolveSaleVoidQueueLedger } from "./saleVoidQueueLedger";
import type { VoidRecord } from "../types";

const VOID_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function voidRec(partial?: Partial<VoidRecord>): VoidRecord {
  return {
    id: VOID_ID,
    saleId: SALE_ID,
    lineIndex: 0,
    productId: PRODUCT,
    productName: "Widget",
    quantity: 4,
    amountUgx: 40_000,
    reason: "other",
    actorUserId: "u1",
    createdAt: "2026-06-02T12:00:00.000Z",
    ...partial,
  };
}

describe("SALES-MULTI-01 P2-02 old void queue ledger", () => {
  it("uses payload financials when present (new ops)", () => {
    const resolved = resolveSaleVoidQueueLedger({
      payload: {
        referenceId: VOID_ID,
        saleId: SALE_ID,
        amountUgx: 12_000,
        lineIndex: 1,
      },
      voidRecords: [voidRec()],
    });
    expect(resolved.source).toBe("payload");
    expect(resolved.amountUgx).toBe(12_000);
    expect(resolved.lineIndex).toBe(1);
  });

  it("old payload + matching void record reconstructs the ledger", () => {
    const resolved = resolveSaleVoidQueueLedger({
      payload: { referenceId: VOID_ID, referenceType: "sale_void", delta: 4 },
      voidRecords: [voidRec({ amountUgx: 42_000 })],
    });
    expect(resolved.source).toBe("void_record");
    expect(resolved.saleId).toBe(SALE_ID);
    expect(resolved.amountUgx).toBe(42_000);
    expect(resolved.lineIndex).toBe(0);
  });

  it("retry with the same void_record_id stays the same amount", () => {
    const payload = { referenceId: VOID_ID, referenceType: "sale_void", delta: 4 };
    const voids = [voidRec()];
    const once = resolveSaleVoidQueueLedger({ payload, voidRecords: voids });
    const twice = resolveSaleVoidQueueLedger({ payload, voidRecords: voids });
    expect(once).toEqual(twice);
  });

  it("already reconciled payload does not take amount from a different void record", () => {
    const resolved = resolveSaleVoidQueueLedger({
      payload: { referenceId: VOID_ID, saleId: SALE_ID, amountUgx: 8_000 },
      voidRecords: [voidRec({ amountUgx: 99_000 })],
    });
    expect(resolved.source).toBe("payload");
    expect(resolved.amountUgx).toBe(8_000);
  });

  it("ambiguous / missing void record stays stock-only", () => {
    expect(
      resolveSaleVoidQueueLedger({
        payload: { referenceId: VOID_ID, referenceType: "sale_void", delta: 4 },
        voidRecords: [],
      }).source,
    ).toBe("stock_only");
    expect(
      resolveSaleVoidQueueLedger({
        payload: { referenceType: "sale_void", delta: 4 },
        voidRecords: [voidRec()],
      }).source,
    ).toBe("stock_only");
    expect(
      resolveSaleVoidQueueLedger({
        payload: { referenceId: VOID_ID, delta: 4 },
        voidRecords: [voidRec({ amountUgx: 0 })],
      }).source,
    ).toBe("stock_only");
    expect(
      resolveSaleVoidQueueLedger({
        payload: { referenceId: VOID_ID, delta: 4 },
        voidRecords: [voidRec({ saleId: "not-a-uuid" })],
      }).source,
    ).toBe("stock_only");
  });
});
