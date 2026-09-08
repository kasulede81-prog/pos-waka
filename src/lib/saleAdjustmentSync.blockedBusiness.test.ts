/**
 * SALES-SYNC-REFUND-BUSINESS-REJECTION-05 — BLOCKED_BUSINESS vs RETRY/WAIT/PARK.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveQueueHealth, markSyncOpFailed, shouldRetrySyncOp } from "./autoSync";
import {
  BLOCKED_BUSINESS_ERRORS,
  WAITING_FOR_SALE_ERROR,
  classifyShopPushSaleReturnOutcome,
  forensicAdjustmentOperationType,
  isBlockedBusinessSyncError,
  isSyncAck,
  markSyncOpBlockedBusiness,
  markSyncOpWaitingForSale,
  syncProcessStatus,
} from "./saleAdjustmentSync";
import { buildSyncForensicSnapshot } from "./syncForensicSnapshot";
import type { SyncOperation } from "../types";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OLD_PAYLOAD = {
  returnId: "2fb42c22-25b6-4771-8bb9-c8bd00e937e2",
  saleId: "3dbdd270-8138-477e-935c-90f11a2dc3c3",
  productId: "1f35d2bf-b64d-4078-abb8-9cc4cd3277db",
  quantity: 2,
  refundAmountUgx: 2000,
};

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, "id">): SyncOperation {
  return {
    kind: "pending_returns",
    payload: { ...OLD_PAYLOAD },
    createdAt: "2026-09-07T22:43:57.603Z",
    attempts: 34,
    lastAttemptAt: "2026-09-07T23:42:32.109Z",
    shopId: SHOP,
    ...partial,
  };
}

function snapshot(queue: SyncOperation[]) {
  return buildSyncForensicSnapshot({
    queue,
    nowMs: Date.parse("2026-09-07T23:43:00.000Z"),
    dayCloses: [],
    activeShopId: SHOP,
    accountKeyPresent: true,
    authenticated: true,
    actorRole: "owner",
    online: true,
    platform: "web",
    runtime: "desktop",
    appVersion: "0",
  });
}

describe("BLOCKED_BUSINESS classification", () => {
  it.each([
    "refund_exceeds_remaining",
    "refund_exceeds_sale",
    "product_not_on_sale",
    "return_qty_exceeds_sold",
    "refund_exceeds_line",
    "sale_not_found",
    "product_not_found",
    "invalid_payload",
  ] as const)("%s → BLOCKED_BUSINESS", (token) => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: false, error: token } })).toEqual({
      status: "block",
      lastError: token,
    });
    expect(isBlockedBusinessSyncError(token)).toBe(true);
  });

  it("closed_business_date → PARK", () => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: false, error: "closed_business_date" } })).toEqual({
      status: "park",
      lastError: "closed_business_date",
    });
    expect(isBlockedBusinessSyncError("closed_business_date")).toBe(false);
  });

  it("WAIT remains WAIT", () => {
    const waited = markSyncOpWaitingForSale(op({ id: "wait-1", attempts: 2, lastAttemptAt: null }));
    expect(waited.lastError).toBe(WAITING_FOR_SALE_ERROR);
    expect(waited.attempts).toBe(2);
    expect(shouldRetrySyncOp(waited)).toBe(true);
    expect(deriveQueueHealth([waited])).toBe("healthy");
  });

  it("network error remains RETRY", () => {
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "XX000", message: "network timeout" } })).toEqual({
      status: "retry",
      lastError: "rpc_failed",
    });
  });

  it("401 remains RETRY", () => {
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "401" } })).toEqual({
      status: "retry",
      lastError: "401",
    });
    expect(shouldRetrySyncOp(op({ id: "auth-401", lastError: "401", lastAttemptAt: null }))).toBe(true);
  });

  it("403 remains RETRY", () => {
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "403" } })).toEqual({
      status: "retry",
      lastError: "403",
    });
  });

  it("PGRST remains RETRY", () => {
    expect(classifyShopPushSaleReturnOutcome({ error: { code: "PGRST116" } })).toEqual({
      status: "retry",
      lastError: "PGRST",
    });
  });

  it("unknown error remains RETRY", () => {
    expect(classifyShopPushSaleReturnOutcome({ data: { ok: false, error: "something_new" } })).toEqual({
      status: "retry",
      lastError: "rpc_failed",
    });
    expect(isBlockedBusinessSyncError("rpc_failed")).toBe(false);
  });
});

describe("BLOCKED_BUSINESS queue health and durability", () => {
  it("BLOCKED_BUSINESS does not produce backing_off", () => {
    const blocked = op({
      id: "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf",
      lastError: "refund_exceeds_remaining",
    });
    expect(shouldRetrySyncOp(blocked, Date.now())).toBe(false);
    expect(deriveQueueHealth([blocked])).toBe("blocked");
    expect(deriveQueueHealth([blocked])).not.toBe("backing_off");
    expect(deriveQueueHealth([blocked])).not.toBe("healthy");
  });

  it("blocked ops stay non-retryable until an explicit validated probe passes", () => {
    const blocked = op({
      id: "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf",
      lastError: "refund_exceeds_remaining",
    });
    expect(shouldRetrySyncOp(blocked, Date.now() + 1_000_000)).toBe(false);
    expect(isSyncAck({ status: "block", lastError: "refund_exceeds_remaining" })).toBe(false);
  });

  it("does not mask a real retryable backoff", () => {
    const blocked = op({ id: "blocked-1", lastError: "refund_exceeds_remaining" });
    const retrying = markSyncOpFailed(
      op({
        id: "retry-1",
        kind: "pending_sales",
        payload: { saleId: "sale-1" },
        attempts: 2,
        lastAttemptAt: new Date().toISOString(),
        lastError: "401",
      }),
      "401",
    );
    expect(deriveQueueHealth([blocked, retrying])).toBe("backing_off");
  });

  it("blocked operation remains durable and is not ACKed/deleted", () => {
    const before = op({
      id: "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf",
      lastError: "refund_exceeds_remaining",
    });
    const frozen = structuredClone(before);
    const blocked = markSyncOpBlockedBusiness(before, "refund_exceeds_remaining");
    expect(blocked.id).toBe(before.id);
    expect(blocked.kind).toBe("pending_returns");
    expect(blocked.attempts).toBe(34);
    expect(blocked.lastAttemptAt).toBe(before.lastAttemptAt);
    expect(blocked.payload).toEqual(OLD_PAYLOAD);
    expect(blocked.lastError).toBe("refund_exceeds_remaining");
    expect(before).toEqual(frozen);
    expect(isSyncAck({ status: "block", lastError: "refund_exceeds_remaining" })).toBe(false);
    expect(syncProcessStatus({ status: "block", lastError: "refund_exceeds_remaining" })).toBe("block");
    const engine = readFileSync(resolve(process.cwd(), "src/offline/syncEngine.ts"), "utf8");
    const ackBranch = engine.slice(engine.indexOf('if (status === "ack")'), engine.indexOf('} else if (status === "wait")'));
    const blockBranch = engine.slice(engine.indexOf('} else if (status === "block")'), engine.indexOf("} else {"));
    expect(ackBranch).toContain("removeSyncOperation");
    expect(blockBranch).toContain("markSyncOpBlockedBusiness");
    expect(blockBranch).not.toContain("removeSyncOperation");
    expect(blockBranch).not.toContain("markSyncOpFailed");
  });

  it("old pending_returns payload remains compatible", () => {
    const row = op({ id: "legacy-return", lastError: "refund_exceeds_remaining" });
    expect(row.payload).toEqual(OLD_PAYLOAD);
    expect(forensicAdjustmentOperationType(row.kind, row.payload)).toBe("return");
    expect(BLOCKED_BUSINESS_ERRORS.has("refund_exceeds_remaining")).toBe(true);
  });

  it("forensic snapshot exposes sanitized lastError/classification", () => {
    const row = op({
      id: "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf",
      lastError: "refund_exceeds_remaining",
    });
    const snap = snapshot([row]);
    expect(snap.rows[0]?.classification).toBe("BLOCKED_BUSINESS");
    expect(snap.rows[0]?.lastError).toBe("refund_exceeds_remaining");
    expect(snap.rows[0]?.retryEligible).toBe(false);
    expect(snap.rows[0]?.retryAt).toBeNull();
    expect(snap.queue.queueHealth).toBe("blocked");
    expect(snap.queue.queueHasBlockedBusiness).toBe(true);
    expect(snap.queue.queueHasBackoff).toBe(false);
    expect(snap.blocker?.classification).toBe("BLOCKED_BUSINESS");
    expect(snap.blocker?.lastError).toBe("refund_exceeds_remaining");
    const exported = JSON.stringify(snap);
    expect(exported).not.toContain("eyJ");
    expect(exported).not.toMatch(/Authorization/i);
    expect(exported).not.toContain("2fb42c22-25b6-4771-8bb9-c8bd00e937e2");
  });
});
