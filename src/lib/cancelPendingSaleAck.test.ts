import { describe, expect, it } from "vitest";
import type { Sale, SyncOperation } from "../types";
import {
  applyCancelAckToSale,
  cancelAckPullReason,
  interpretCancelPendingSaleResult,
  matchingCancelQueueOpIds,
  saleUploadRpcForLocalSale,
} from "./cancelPendingSaleAck";
import { computeSyncBackoffMs, deriveQueueHealth, shouldRetrySyncOp } from "./autoSync";
import {
  ALL_INCREMENTAL_PULL_ENTITIES,
  incrementalEntitiesForReason,
  shouldForceCloudPull,
  shouldRunAncillaryCloudBundle,
} from "./syncReasons";

const SALE_ID = "fa5093c8-4179-4aaa-b774-c9416c1569c5";

function cancelledSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: SALE_ID,
    status: "cancelled",
    lines: [],
    subtotalUgx: 1000,
    totalUgx: 1000,
    cashPaidUgx: 0,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt: "2026-08-10T23:46:25.000Z",
    pendingSync: true,
    lastSyncError: "not_found_or_not_draft",
    ...overrides,
  };
}

function cancelOp(partial: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id: "op-cancel-1",
    kind: "pending_sales",
    payload: { saleId: SALE_ID, kind: "pending_cancel" },
    createdAt: "2026-08-11T00:50:20.000Z",
    attempts: 8,
    lastAttemptAt: "2026-08-13T15:40:00.000Z",
    ...partial,
  };
}

describe("SYNC-1.1-R2 cancel upload ACK", () => {
  it("TEST 1: local cancelled + cloud cancelled (ok) clears pendingSync", () => {
    const ack = interpretCancelPendingSaleResult(null, { ok: true, sale_id: SALE_ID });
    expect(ack.ok).toBe(true);
    const next = applyCancelAckToSale(cancelledSale());
    expect(next.status).toBe("cancelled");
    expect(next.pendingSync).toBe(false);
    expect(next.lastSyncError).toBeNull();
  });

  it("TEST 2: already_cancelled RPC is success", () => {
    const ack = interpretCancelPendingSaleResult(null, {
      ok: true,
      already_cancelled: true,
      sale_id: SALE_ID,
    });
    expect(ack).toEqual({ ok: true, alreadyCancelled: true });
    const next = applyCancelAckToSale(cancelledSale({ lastSyncError: "not_found_or_not_draft" }));
    expect(next.pendingSync).toBe(false);
    expect(next.lastSyncError).toBeNull();
  });

  it("TEST 3: genuinely missing sale remains failed", () => {
    const ack = interpretCancelPendingSaleResult(null, {
      ok: false,
      error: "not_found_or_not_draft",
    });
    expect(ack).toEqual({ ok: false, error: "not_found_or_not_draft" });
    expect(cancelledSale().pendingSync).toBe(true);
  });

  it("TEST 4: unauthorized sale remains failed", () => {
    expect(interpretCancelPendingSaleResult(null, { ok: false, error: "forbidden" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(interpretCancelPendingSaleResult(null, { ok: false, error: "not_authenticated" })).toEqual({
      ok: false,
      error: "not_authenticated",
    });
  });

  it("TEST 5: legitimate draft cancellation still succeeds", () => {
    const ack = interpretCancelPendingSaleResult(null, {
      ok: true,
      already_cancelled: false,
      sale_id: SALE_ID,
    });
    expect(ack).toEqual({ ok: true, alreadyCancelled: false });
  });

  it("TEST 6: cancelled local sale is never sent through pending upsert", () => {
    expect(saleUploadRpcForLocalSale(cancelledSale())).toBe("shop_cancel_pending_sale");
    expect(saleUploadRpcForLocalSale({ ...cancelledSale(), status: "pending" })).toBe(
      "shop_push_pending_sale",
    );
    expect(saleUploadRpcForLocalSale({ ...cancelledSale(), status: "completed", pendingSync: true })).toBe(
      "shop_push_sale_complete",
    );
  });

  it("TEST 7: successful idempotent cancel settles the matching queue op", () => {
    const other: SyncOperation = {
      id: "op-other",
      kind: "pending_sales",
      payload: { saleId: "54477db2-3473-47e3-8698-10230a2f7463", kind: "pending_cancel" },
      createdAt: "2026-08-11T00:14:35.000Z",
      attempts: 0,
      lastAttemptAt: null,
    };
    const upsert: SyncOperation = {
      id: "op-upsert",
      kind: "pending_sales",
      payload: { saleId: SALE_ID, kind: "pending_upsert" },
      createdAt: "2026-08-10T23:46:25.000Z",
      attempts: 0,
      lastAttemptAt: null,
    };
    expect(matchingCancelQueueOpIds([cancelOp(), other, upsert], SALE_ID)).toEqual(["op-cancel-1"]);
  });

  it("TEST 8: Run sync now can recover a backing-off cancel without waiting", () => {
    const now = Date.parse("2026-08-13T15:40:01.000Z");
    const stuck = cancelOp({ attempts: 8, lastAttemptAt: new Date(now).toISOString() });
    expect(shouldRetrySyncOp(stuck, now + 1_000)).toBe(false);
    expect(matchingCancelQueueOpIds([stuck], SALE_ID)).toEqual([stuck.id]);
    const acked = applyCancelAckToSale(cancelledSale());
    expect(acked.pendingSync).toBe(false);
    expect(deriveQueueHealth([])).toBe("healthy");
  });

  it("TEST 9: automatic retry recovers after backoff because success removes the op", () => {
    const now = Date.parse("2026-08-13T15:40:00.000Z");
    const stuck = cancelOp({ attempts: 5, lastAttemptAt: new Date(now).toISOString() });
    expect(shouldRetrySyncOp(stuck, now + computeSyncBackoffMs(stuck.attempts))).toBe(true);
    const ack = interpretCancelPendingSaleResult(null, { ok: true, already_cancelled: true });
    expect(ack.ok).toBe(true);
    expect(deriveQueueHealth([])).toBe("healthy");
  });

  it("TEST 10: already-cancelled ACK does not trigger a full incremental pull", () => {
    expect(cancelAckPullReason(true)).toBeNull();
    expect(cancelAckPullReason(false)).toBe("sale_ack");
    expect(incrementalEntitiesForReason("sale_ack")).toEqual(["sales"]);
    expect(incrementalEntitiesForReason("sale_ack")).not.toEqual([...ALL_INCREMENTAL_PULL_ENTITIES]);
    expect(shouldRunAncillaryCloudBundle("sale_ack")).toBe(false);
    expect(shouldForceCloudPull("sale_ack", true)).toBe(false);
  });

  it("does not treat transport errors as already-cancelled success", () => {
    expect(interpretCancelPendingSaleResult({ code: "PGRST301" }, { ok: true, already_cancelled: true })).toEqual({
      ok: false,
      error: "PGRST301",
    });
  });
});
