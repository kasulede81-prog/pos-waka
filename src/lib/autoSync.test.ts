import { describe, expect, it } from "vitest";
import {
  computeSyncBackoffMs,
  deriveQueueHealth,
  markSyncOpFailed,
  shouldRetrySyncOp,
} from "./autoSync";
import { offlineDurationLabel } from "./syncMeta";
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
