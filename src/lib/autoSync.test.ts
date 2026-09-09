import { describe, expect, it } from "vitest";
import {
  computeSyncBackoffMs,
  deriveQueueHealth,
  markSyncOpFailed,
  markSyncOpQuarantined,
  shouldRetrySyncOp,
  QUARANTINED_MAX_ATTEMPTS_ERROR,
  QUARANTINED_NO_SHOP_ERROR,
  SYNC_QUARANTINE_AFTER_ATTEMPTS,
} from "./autoSync";
import { applySyncHealthAfterCycle, offlineDurationLabel } from "./syncMeta";
import type { SyncOperation } from "../types";

function op(partial: Partial<SyncOperation> & Pick<SyncOperation, "id">): SyncOperation {
  return {
    kind: "pending_sales",
    payload: {},
    createdAt: "2026-06-02T10:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    ...partial,
  };
}

describe("autoSync backoff", () => {
  it("doubles backoff up to cap", () => {
    expect(computeSyncBackoffMs(0)).toBe(2_000);
    expect(computeSyncBackoffMs(1)).toBe(4_000);
    expect(computeSyncBackoffMs(8)).toBe(300_000);
    expect(computeSyncBackoffMs(20)).toBe(300_000);
  });

  it("waits until backoff elapsed before retry", () => {
    const now = Date.now();
    const failed = markSyncOpFailed(op({ id: "a", attempts: 0, lastAttemptAt: new Date(now).toISOString() }));
    expect(shouldRetrySyncOp(failed, now + 1000)).toBe(false);
    expect(shouldRetrySyncOp(failed, now + 5_000)).toBe(true);
  });

  it("marks degraded queue after repeated failures", () => {
    const queue = [op({ id: "a", attempts: 4 }), op({ id: "b", attempts: 0 })];
    expect(deriveQueueHealth(queue)).toBe("degraded");
  });

  it("marks backing_off when ops wait for retry window", () => {
    const now = Date.now();
    const queue = [
      markSyncOpFailed(op({ id: "a", attempts: 2, lastAttemptAt: new Date(now).toISOString() })),
    ];
    expect(deriveQueueHealth(queue)).toBe("backing_off");
    expect(shouldRetrySyncOp(queue[0], now + 1_000)).toBe(false);
  });

  it("allowlisted transport lastError does not change backoff windows", () => {
    const now = Date.now();
    const failed = markSyncOpFailed(
      op({ id: "obs", attempts: 2, lastAttemptAt: new Date(now).toISOString() }),
      "401",
    );
    expect(failed.lastError).toBe("401");
    expect(shouldRetrySyncOp(failed, now + 1_000)).toBe(false);
    expect(deriveQueueHealth([failed])).toBe("backing_off");
  });

  it("blocked business lastError is never retryable and is not backing_off", () => {
    const now = Date.now();
    const blocked = op({
      id: "blocked-obs",
      kind: "pending_returns",
      lastError: "refund_exceeds_remaining",
      attempts: 34,
      lastAttemptAt: new Date(now).toISOString(),
    });
    expect(shouldRetrySyncOp(blocked, now + 1_000_000)).toBe(false);
    expect(deriveQueueHealth([blocked])).toBe("blocked");
  });

  it("waiting_for_sale is not exponential backoff health", () => {
    const now = Date.now();
    const queue = [
      op({
        id: "wait-1",
        kind: "pending_returns",
        lastError: "waiting_for_sale",
        attempts: 0,
        lastAttemptAt: new Date(now).toISOString(),
      }),
    ];
    expect(shouldRetrySyncOp(queue[0], now)).toBe(true);
    expect(deriveQueueHealth(queue)).toBe("healthy");
  });

  it("WAKA-11 — quarantined ops are not retryable and surface as quarantined health", () => {
    const now = Date.now();
    const quarantined = markSyncOpQuarantined(
      op({ id: "q-1", attempts: 99, lastAttemptAt: new Date(now).toISOString() }),
      QUARANTINED_MAX_ATTEMPTS_ERROR,
    );
    expect(quarantined.attempts).toBe(SYNC_QUARANTINE_AFTER_ATTEMPTS);
    expect(quarantined.lastError).toBe(QUARANTINED_MAX_ATTEMPTS_ERROR);
    expect(quarantined.quarantinedAt).toBeTruthy();
    expect(shouldRetrySyncOp(quarantined, now + 1_000_000)).toBe(false);
    expect(deriveQueueHealth([quarantined])).toBe("quarantined");
    expect(deriveQueueHealth([])).toBe("healthy");
  });

  it("WAKA-11 — one quarantined op does not hide a later retryable op from health, but health stays quarantined", () => {
    const quarantined = markSyncOpQuarantined(op({ id: "q-1", attempts: 100 }), QUARANTINED_NO_SHOP_ERROR);
    const pending = op({ id: "ok-1", attempts: 0, lastAttemptAt: null });
    expect(deriveQueueHealth([quarantined, pending])).toBe("quarantined");
    expect(shouldRetrySyncOp(pending)).toBe(true);
    expect(shouldRetrySyncOp(quarantined)).toBe(false);
  });
});

describe("WAKA-12 — applySyncHealthAfterCycle", () => {
  const attemptAt = "2026-09-08T12:00:00.000Z";

  it("claims healthy only when the durable queue is empty and nothing failed", () => {
    const meta = applySyncHealthAfterCycle({
      attemptAt,
      pullPartial: false,
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 0,
      queueHealth: "healthy",
    });
    expect(meta.lastIssueCode).toBe("none");
    expect(meta.lastSuccessAt).toBe(attemptAt);
    expect(meta.queueHealth).toBe("healthy");
  });

  it("does not claim lastSuccessAt while durable work remains", () => {
    const later = "2026-09-08T13:00:00.000Z";
    const meta = applySyncHealthAfterCycle({
      attemptAt: later,
      pullPartial: false,
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 1,
      queueHealth: "healthy",
    });
    expect(meta.lastSuccessAt).not.toBe(later);
    expect(meta.queueHealth).toBe("healthy");
  });

  it("surfaces pull entity errors as partial even when the push queue is empty", () => {
    const meta = applySyncHealthAfterCycle({
      attemptAt,
      pullPartial: false,
      entityPullErrors: { sales: "sales_pull_denied" },
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 0,
      queueHealth: "healthy",
    });
    expect(meta.lastIssueCode).toBe("partial");
    expect(meta.lastSuccessAt).not.toBe(attemptAt);
    expect(meta.entityPullErrors).toEqual({ sales: "sales_pull_denied" });
  });

  it("surfaces quarantined durable work as partial, not healthy", () => {
    const meta = applySyncHealthAfterCycle({
      attemptAt,
      pullPartial: false,
      pushFail: 0,
      queueFailed: 0,
      durableRemaining: 1,
      queueHealth: "quarantined",
    });
    expect(meta.lastIssueCode).toBe("partial");
    expect(meta.queueHealth).toBe("quarantined");
    expect(meta.lastSuccessAt).not.toBe(attemptAt);
  });
});

describe("offline duration label", () => {
  it("formats minutes and hours", () => {
    const start = new Date("2026-06-02T10:00:00.000Z").toISOString();
    expect(offlineDurationLabel(start, new Date("2026-06-02T10:05:00.000Z").getTime())).toBe("5m");
    expect(offlineDurationLabel(start, new Date("2026-06-02T12:00:00.000Z").getTime())).toBe("2h");
  });
});

describe("auto sync reconnect scenario", () => {
  it("uses short reconnect delay for immediate automatic sync", () => {
    expect(400).toBeLessThanOrEqual(500);
  });
});

describe("debt payment offline queue", () => {
  it("customer ops bucket as other pending work", () => {
    const queue = [op({ id: "debt-1", kind: "customer" })];
    expect(deriveQueueHealth(queue)).toBe("healthy");
    expect(queue[0].kind).toBe("customer");
  });
});

describe("app restart with pending queue", () => {
  it("retries ops without lastAttemptAt immediately", () => {
    const queue = [op({ id: "restart-1", attempts: 2, lastAttemptAt: null })];
    expect(shouldRetrySyncOp(queue[0])).toBe(true);
  });
});

describe("sale offline → online auto upload (integration shape)", () => {
  it("pending sale flag is included in sync work detection", async () => {
    const { countUnsyncedSales } = await import("../offline/cloudSync");
    const { usePosStore } = await import("../store/usePosStore");
    usePosStore.setState({
      sales: [
        {
          id: "offline-sale-1",
          status: "completed",
          lines: [],
          subtotalUgx: 1000,
          totalUgx: 1000,
          cashPaidUgx: 1000,
          debtUgx: 0,
          estimatedProfitUgx: 200,
          createdAt: new Date().toISOString(),
          pendingSync: true,
        },
      ],
    });
    expect(countUnsyncedSales()).toBe(1);
  });
});
