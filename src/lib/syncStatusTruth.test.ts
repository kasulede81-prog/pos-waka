import { describe, expect, it } from "vitest";
import type { SyncOperation } from "../types";
import { markSyncOpFailed, summarizeSyncQueue } from "./autoSync";
import {
  classifySaleUploadError,
  isBlockedBusinessSyncError,
  syncErrorOwnerMessageKey,
} from "./saleAdjustmentSync";
import { formatSyncFlushSummary, type SyncFlushSummary } from "./syncFlushSummary";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, "id">): SyncOperation {
  return {
    kind: "pending_sales",
    payload: { saleId: partial.id },
    createdAt: "2026-10-17T10:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    ...partial,
  };
}

describe("truthful sync queue summary", () => {
  it("separates ready, backing off, failed, blocked and quarantined rows", () => {
    const queue = [
      op({ id: "ready" }),
      op({ id: "backoff", attempts: 8, lastAttemptAt: "2026-10-20T11:59:00.000Z" }),
      op({ id: "failed", attempts: 8, lastAttemptAt: "2026-10-20T11:59:00.000Z", lastError: "rpc_failed" }),
      op({ id: "blocked", lastError: "already_completed" }),
      op({
        id: "quarantined",
        attempts: 100,
        lastAttemptAt: "2026-10-19T10:00:00.000Z",
        lastError: "quarantined_max_attempts",
        quarantinedAt: "2026-10-19T10:00:00.000Z",
      }),
    ];
    const summary = summarizeSyncQueue(queue, NOW);
    expect(summary.pending).toBe(5);
    expect(summary.ready).toBe(1);
    expect(summary.backingOff).toBe(2);
    expect(summary.blocked).toBe(1);
    expect(summary.quarantined).toBe(1);
    // blocked + quarantined + the retryable row carrying an error
    expect(summary.failed).toBe(3);
  });

  it("does not count waiting_for_sale as a failure or ordinary backoff", () => {
    const summary = summarizeSyncQueue(
      [op({ id: "wait", lastError: "waiting_for_sale" })],
      NOW,
    );
    expect(summary.ready).toBe(1);
    expect(summary.backingOff).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it("classifies closed-date parks separately from ordinary backoff", () => {
    const summary = summarizeSyncQueue(
      [
        op({
          id: "parked",
          lastError: "closed_business_date",
          closedDateKey: "2026-10-17",
          lastAttemptAt: "2026-10-17T10:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(summary.parkedClosedDate).toBe(1);
    expect(summary.backingOff).toBe(0);
    expect(summary.failed).toBe(1);
  });
});

describe("safe sale upload errors", () => {
  it("classifies a raw SQL failure without exposing the raw text", () => {
    const raw =
      'insert or update on table "sale_line_items" violates foreign key constraint "sale_line_items_product_id_fkey"';
    const safe = classifySaleUploadError(raw);
    expect(safe).toBe("constraint_violation");
    expect(safe).not.toContain("sale_line_items");
    expect(isBlockedBusinessSyncError(safe)).toBe(true);
  });

  it("keeps permanent outcomes permanent", () => {
    expect(classifySaleUploadError("already_completed")).toBe("already_completed");
    expect(isBlockedBusinessSyncError("already_completed")).toBe(true);
    expect(classifySaleUploadError("sale_missing_locally")).toBe("sale_missing_locally");
    expect(isBlockedBusinessSyncError("sale_missing_locally")).toBe(true);
  });

  it("maps PostgREST and unknown failures to safe retryable tokens", () => {
    expect(classifySaleUploadError("PGRST202")).toBe("PGRST");
    expect(classifySaleUploadError("42P01")).toBe("42P01");
    expect(classifySaleUploadError("23503")).toBe("constraint_violation");
    expect(classifySaleUploadError("some raw server text with customer 0777")).toBe("rpc_failed");
  });

  it("persists a classified reason on the durable queue row", () => {
    const failed = markSyncOpFailed(
      op({ id: "sale-row" }),
      'duplicate key value violates unique constraint "sales_pkey"',
    );
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe("constraint_violation");
  });

  it("never returns a raw error string as an owner message key", () => {
    const key = syncErrorOwnerMessageKey(
      'insert or update on table "sales" violates foreign key constraint',
    );
    expect(key).toBe("syncErrorSaleDataRejected");
    expect(key.startsWith("syncError")).toBe(true);
    expect(key).not.toContain("sales");
  });
});

describe("sync run feedback", () => {
  const base: SyncFlushSummary = {
    uploaded: 0,
    pending: 0,
    pendingSales: 0,
    backingOff: 0,
    failed: 0,
    blocked: 0,
    quarantined: 0,
  };

  it("claims upload success only with an acknowledgement and an empty backlog", () => {
    expect(formatSyncFlushSummary("en", { ...base, uploaded: 2 })).toContain("2 item(s) uploaded");
    expect(formatSyncFlushSummary("en", base)).toContain("nothing pending");
  });

  it("reports real pending/backoff/failed counts instead of 'complete'", () => {
    const msg = formatSyncFlushSummary("en", {
      ...base,
      uploaded: 1,
      pending: 3,
      pendingSales: 1,
      backingOff: 2,
      failed: 1,
      blocked: 1,
    });
    expect(msg).toContain("3 pending");
    expect(msg).toContain("1 sale(s)");
    expect(msg).toContain("2 backing off");
    expect(msg).toContain("1 failed");
    expect(msg).toContain("1 uploaded");
    expect(msg).not.toBe("Sync complete.");
  });

  it("does not claim success when only a sale remains unsynced without a queue row", () => {
    const msg = formatSyncFlushSummary("en", { ...base, pendingSales: 1 });
    expect(msg).toContain("1 sale(s)");
  });
});
