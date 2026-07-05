import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateDayClosePreflightSync } from "./dayCloseEnforcement";

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => false,
}));

vi.mock("./syncMeta", () => ({
  readSyncHealthMeta: () => ({
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastPullAt: null,
    lastPushAt: null,
    lastIssueAt: null,
    lastIssueCode: "none" as const,
    offlineSinceAt: null,
    lastOnlineAt: null,
    queueHealth: "healthy" as const,
  }),
}));

describe("dayClosePreflight adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags pending sync in snapshot", () => {
    const result = evaluateDayClosePreflightSync({
      state: {
        draftLines: { length: 0 },
        activePendingSaleId: null,
        sales: [{ id: "s", pendingSync: true } as never],
        preferences: { shifts: [], cashDrawerFormulaVersion: "v2" },
        dayCloses: [{ id: "1", pendingSync: true } as never],
        dayDrawerOpens: [{ id: "d", pendingSync: true, dateKey: "2026-06-10", status: "open" } as never],
        products: [],
        returnRecords: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        inventoryCountSessions: [],
      },
      dateKey: "2026-06-10",
      expectedCashUgx: 50_000,
      countedCashUgx: 50_000,
      queue: [],
    });
    expect(result.snapshot.pendingSync.total).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.startsWith("pending_sync_total:"))).toBe(true);
  });
});
