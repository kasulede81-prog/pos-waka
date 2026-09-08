/**
 * SALES-SYNC-RETURN-RPC-OBSERVABILITY-01 — allowlisted lastError only.
 */
import { describe, expect, it } from "vitest";
import { computeSyncBackoffMs, markSyncOpFailed, shouldRetrySyncOp } from "./autoSync";
import {
  RPC_FAILED_ERROR,
  WAITING_FOR_SALE_ERROR,
  classifyPostgrestSyncError,
  classifyShopPushSaleReturnOutcome,
  classifySyncExceptionMessage,
  isSyncAck,
  markSyncOpWaitingForSale,
  sanitizeStoredSyncError,
  syncProcessLastError,
  syncProcessStatus,
} from "./saleAdjustmentSync";
import { buildSyncForensicSnapshot } from "./syncForensicSnapshot";
import type { SyncOperation } from "../types";

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, "id">): SyncOperation {
  return {
    kind: "pending_returns",
    payload: { returnId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    createdAt: "2026-09-07T22:43:57.603Z",
    attempts: 0,
    lastAttemptAt: null,
    shopId: "11111111-1111-4111-8111-111111111111",
    ...partial,
  };
}

describe("classifyShopPushSaleReturnOutcome", () => {
  it("data.ok === true → ACK", () => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: true } })).toEqual({ status: "ack" });
  });

  it("data.error === sale_not_found → BLOCK + token", () => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: false, error: "sale_not_found" } })).toEqual({
      status: "block",
      lastError: "sale_not_found",
    });
  });

  it("data.error === refund_exceeds_remaining → BLOCK + token", () => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: false, error: "refund_exceeds_remaining" } })).toEqual({
      status: "block",
      lastError: "refund_exceeds_remaining",
    });
  });

  it("data.error === closed_business_date → PARK", () => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: false, error: "closed_business_date" } })).toEqual({
      status: "park",
      lastError: "closed_business_date",
    });
  });

  it("unknown data.error → RETRY + rpc_failed", () => {
    expect(
      classifyShopPushSaleReturnOutcome({ data: { ok: false, error: "DROP TABLE sale_returns; -- jwt" } }),
    ).toEqual({ status: "retry", lastError: RPC_FAILED_ERROR });
  });

  it("PostgREST 401 / 403 / 42501 / 42P01 / PGRST / other", () => {
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "401" } })).toEqual({
      status: "retry",
      lastError: "401",
    });
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "403" } })).toEqual({
      status: "retry",
      lastError: "403",
    });
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "42501" } })).toEqual({
      status: "retry",
      lastError: "42501",
    });
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "42P01" } })).toEqual({
      status: "retry",
      lastError: "42P01",
    });
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "PGRST116" } })).toEqual({
      status: "retry",
      lastError: "PGRST",
    });
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "XX000", message: "secret" } })).toEqual({
      status: "retry",
      lastError: RPC_FAILED_ERROR,
    });
  });
});

describe("classifySyncExceptionMessage", () => {
  it("raw exception containing sensitive text → only rpc_failed", () => {
    expect(classifySyncExceptionMessage("JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload customer=Jane")).toBe(
      RPC_FAILED_ERROR,
    );
    expect(sanitizeStoredSyncError("JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload")).toBeNull();
  });

  it("invalid input syntax for type uuid → invalid_uuid", () => {
    expect(classifySyncExceptionMessage("invalid input syntax for type uuid")).toBe("invalid_uuid");
  });

  it("Product ... not in shop → product_not_in_shop", () => {
    expect(classifySyncExceptionMessage("Product 11111111-1111-4111-8111-111111111111 not in shop")).toBe(
      "product_not_in_shop",
    );
    expect(classifySyncExceptionMessage("Product Coca-Cola leaked in shop")).toBe(RPC_FAILED_ERROR);
  });

  it("constraint failure → constraint_violation", () => {
    expect(classifySyncExceptionMessage("duplicate key value violates unique constraint \"sale_returns_pkey\"")).toBe(
      "constraint_violation",
    );
    expect(classifySyncExceptionMessage("insert or update on table \"sale_returns\" violates foreign key constraint")).toBe(
      "constraint_violation",
    );
    expect(classifySyncExceptionMessage("null value in column \"id\" violates not-null constraint")).toBe(
      "constraint_violation",
    );
    expect(classifySyncExceptionMessage("new row violates check constraint \"sale_returns_quantity_check\"")).toBe(
      "constraint_violation",
    );
  });
});

describe("classifyPostgrestSyncError", () => {
  it("maps allowlisted codes only", () => {
    expect(classifyPostgrestSyncError("401")).toBe("401");
    expect(classifyPostgrestSyncError("PGRST301")).toBe("PGRST");
    expect(classifyPostgrestSyncError("57014")).toBe(RPC_FAILED_ERROR);
  });
});

describe("markSyncOpFailed observability", () => {
  it("attempts/lastAttemptAt remain unchanged in semantics", () => {
    const before = op({ id: "a", attempts: 3, lastAttemptAt: null, lastError: "waiting_for_sale" });
    const failed = markSyncOpFailed(before);
    expect(failed.attempts).toBe(4);
    expect(failed.lastAttemptAt).toBeTruthy();
    expect(failed.lastError).toBe("waiting_for_sale");
    expect(failed.id).toBe("a");
  });

  it("stores allowlisted lastError only", () => {
    const before = op({ id: "b", attempts: 1, lastError: undefined });
    const classified = markSyncOpFailed(before, "401");
    expect(classified.lastError).toBe("401");
    const rejected = markSyncOpFailed(before, "Bearer secret.jwt.token");
    expect(rejected.lastError).toBeUndefined();
    expect(rejected.attempts).toBe(2);
  });

  it("retryAt/backoff behavior remains unchanged", () => {
    const now = Date.now();
    const failed = markSyncOpFailed(op({ id: "c", attempts: 2, lastAttemptAt: new Date(now).toISOString() }), "401");
    expect(computeSyncBackoffMs(failed.attempts)).toBe(computeSyncBackoffMs(3));
    expect(shouldRetrySyncOp(failed, now + 1_000)).toBe(false);
    expect(shouldRetrySyncOp(failed, now + computeSyncBackoffMs(failed.attempts))).toBe(true);
  });

  it("existing WAIT behavior remains unchanged", () => {
    const before = op({ id: "w", attempts: 2, lastAttemptAt: null });
    const waited = markSyncOpWaitingForSale(before);
    expect(waited.attempts).toBe(2);
    expect(waited.lastAttemptAt).toBeNull();
    expect(waited.lastError).toBe(WAITING_FOR_SALE_ERROR);
    expect(shouldRetrySyncOp(waited)).toBe(true);
  });
});

describe("sync process result helpers", () => {
  it("existing ACK is a string ack", () => {
    expect(isSyncAck("ack")).toBe(true);
    expect(syncProcessStatus("ack")).toBe("ack");
    expect(syncProcessLastError("ack")).toBeUndefined();
  });

  it("RETRY with lastError does not look like ACK", () => {
    const result = { status: "retry" as const, lastError: "sale_not_found" };
    expect(isSyncAck(result)).toBe(false);
    expect(syncProcessStatus(result)).toBe("retry");
    expect(syncProcessLastError(result)).toBe("sale_not_found");
  });

  it("existing PARK status stays park", () => {
    expect(syncProcessStatus("park")).toBe("park");
    expect(syncProcessLastError("park")).toBeUndefined();
  });
});

describe("forensic snapshot lastError", () => {
  it("shows allowlisted lastError without treating it as WAIT", () => {
    const row = op({
      id: "obs-1",
      attempts: 34,
      lastAttemptAt: "2026-09-07T23:42:32.109Z",
      lastError: "401",
    });
    const snap = buildSyncForensicSnapshot({
      queue: [row],
      nowMs: new Date("2026-09-07T23:43:00.000Z").getTime(),
      dayCloses: [],
      activeShopId: row.shopId ?? null,
      accountKeyPresent: true,
      authenticated: true,
      actorRole: "owner",
      online: true,
      platform: "web",
      runtime: "desktop",
      appVersion: "0",
    });
    expect(snap.rows[0]?.lastError).toBe("401");
    expect(snap.rows[0]?.classification).toBe("BACKOFF");
    expect(snap.blocker?.lastError).toBe("401");
    expect(snap.rows[0]?.classification).not.toBe("WAITING_FOR_SALE");
  });
});
