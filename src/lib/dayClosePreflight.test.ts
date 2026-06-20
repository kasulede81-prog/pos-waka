import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDayClosePreflight } from "./dayClosePreflight";

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

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({
      dayCloses: [{ id: "1", pendingSync: true }],
      cashExpenses: [],
      cashDrawerAdjustments: [],
      dayDrawerOpens: [],
    }),
  },
}));

describe("dayClosePreflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("warns about pending cash sync", async () => {
    const result = await runDayClosePreflight();
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("pending_cash_sync:"))).toBe(true);
  });
});
