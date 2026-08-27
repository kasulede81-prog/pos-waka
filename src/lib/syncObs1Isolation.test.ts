import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OBS-1 isolation: observer failure must not alter sync path outcomes.
 */

const TEST_SHOP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const mocks = vi.hoisted(() => ({
  syncSaleImmediately: vi.fn().mockResolvedValue(true),
  runPosPushOnlyUpload: vi.fn().mockResolvedValue({
    ran: true,
    skipped: false,
    pushOk: 1,
    pushFail: 0,
    queueFailed: 0,
  }),
  scheduleIncrementalCloudPull: vi.fn(),
  processCloudSyncOperation: vi.fn().mockResolvedValue(true),
  readSyncQueue: vi.fn(),
  removeSyncOperation: vi.fn().mockResolvedValue(undefined),
  appendSyncOperation: vi.fn().mockResolvedValue(undefined),
  reportSyncIssue: vi.fn(),
}));

vi.mock("../offline/cloudSync", () => ({
  syncSaleImmediately: mocks.syncSaleImmediately,
  scheduleIncrementalCloudPull: mocks.scheduleIncrementalCloudPull,
  processCloudSyncOperation: mocks.processCloudSyncOperation,
}));

vi.mock("./posPushScheduler", () => ({
  runPosPushOnlyUpload: mocks.runPosPushOnlyUpload,
}));

vi.mock("./syncTiming", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./syncTiming")>();
  return {
    ...actual,
    IMMEDIATE_PUSH_COALESCE_MS: 10,
    SYNC_QUEUE_FLUSH_CONCURRENCY: 1,
  };
});

vi.mock("../offline/localDb", () => ({
  readSyncQueue: mocks.readSyncQueue,
  removeSyncOperation: mocks.removeSyncOperation,
  appendSyncOperation: mocks.appendSyncOperation,
}));

vi.mock("./monitoring", () => ({
  reportSyncIssue: mocks.reportSyncIssue,
}));

vi.mock("./globalSyncMutex", () => ({
  withGlobalSyncMutex: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
    },
  },
}));

describe("OBS-1 isolation + path counters", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { resetActiveShopForTests, setActiveShopId } = await import("../offline/shopScope");
    resetActiveShopForTests();
    setActiveShopId(TEST_SHOP);
    mocks.syncSaleImmediately.mockReset().mockResolvedValue(true);
    mocks.runPosPushOnlyUpload.mockReset().mockResolvedValue({
      ran: true,
      skipped: false,
      pushOk: 1,
      pushFail: 0,
      queueFailed: 0,
    });
    mocks.scheduleIncrementalCloudPull.mockReset();
    mocks.processCloudSyncOperation.mockReset().mockResolvedValue(true);
    mocks.readSyncQueue.mockReset();
    mocks.removeSyncOperation.mockReset().mockResolvedValue(undefined);
    mocks.appendSyncOperation.mockReset().mockResolvedValue(undefined);
    mocks.reportSyncIssue.mockReset();
  });

  it("immediate sale path increments only SALE_PUSH_IMMEDIATE_ATTEMPT", async () => {
    const diag = await import("./syncDiagnostics");
    diag.resetObs1DiagnosticsForTests();
    const { runImmediateSaleSync } = await import("./immediateSync");
    await runImmediateSaleSync("sale-iso-1");
    const { obs1 } = diag.readSyncDiagnosticsSnapshot();
    expect(obs1.salePushImmediateAttempts).toBe(1);
    expect(obs1.salePushQueueAttempts).toBe(0);
    expect(obs1.salePushPendingSyncAttempts).toBe(0);
    expect(mocks.syncSaleImmediately).toHaveBeenCalledWith("sale-iso-1");
  });

  it("thrown immediate observer does not fail or skip sale push", async () => {
    const diag = await import("./syncDiagnostics");
    diag.resetObs1DiagnosticsForTests();
    vi.spyOn(diag, "recordSalePushImmediateAttempt").mockImplementation(() => {
      throw new Error("obs boom");
    });
    const { runImmediateSaleSync } = await import("./immediateSync");
    await expect(runImmediateSaleSync("sale-iso-2")).resolves.toBeUndefined();
    expect(mocks.syncSaleImmediately).toHaveBeenCalledWith("sale-iso-2");
    expect(mocks.runPosPushOnlyUpload).toHaveBeenCalled();
    // no queue mutation from observer failure
    expect(mocks.appendSyncOperation).not.toHaveBeenCalled();
    expect(mocks.removeSyncOperation).not.toHaveBeenCalled();
  });

  it("queue-drain sale path increments only SALE_PUSH_QUEUE_ATTEMPT and still removes on success", async () => {
    const diag = await import("./syncDiagnostics");
    diag.resetObs1DiagnosticsForTests();
    mocks.readSyncQueue
      .mockResolvedValueOnce([
        {
          id: "q-sale-1",
          kind: "pending_sales",
          attempts: 0,
          createdAt: "2026-01-01T00:00:00Z",
          payload: { saleId: "s1" },
          shopId: TEST_SHOP,
        },
      ])
      .mockResolvedValueOnce([]);
    const { flushSyncQueueInner } = await import("../offline/syncEngine");
    const result = await flushSyncQueueInner();
    await vi.waitFor(() => expect(diag.readSyncDiagnosticsSnapshot().obs1.salePushQueueAttempts).toBe(1));
    expect(diag.readSyncDiagnosticsSnapshot().obs1.salePushImmediateAttempts).toBe(0);
    expect(diag.readSyncDiagnosticsSnapshot().obs1.salePushPendingSyncAttempts).toBe(0);
    expect(mocks.processCloudSyncOperation).toHaveBeenCalledTimes(1);
    expect(mocks.removeSyncOperation).toHaveBeenCalledWith("q-sale-1");
    expect(result.failed).toBe(0);
  });

  it("thrown queue observer does not change remove/retry/enqueue behavior", async () => {
    const diag = await import("./syncDiagnostics");
    diag.resetObs1DiagnosticsForTests();
    vi.spyOn(diag, "recordSalePushQueueAttempt").mockImplementation(() => {
      throw new Error("queue obs boom");
    });
    mocks.readSyncQueue
      .mockResolvedValueOnce([
        {
          id: "q-sale-2",
          kind: "sale",
          attempts: 0,
          createdAt: "2026-01-01T00:00:00Z",
          payload: { saleId: "s2" },
          shopId: TEST_SHOP,
        },
      ])
      .mockResolvedValueOnce([]);
    const { flushSyncQueueInner } = await import("../offline/syncEngine");
    const result = await flushSyncQueueInner();
    expect(mocks.processCloudSyncOperation).toHaveBeenCalledTimes(1);
    expect(mocks.removeSyncOperation).toHaveBeenCalledWith("q-sale-2");
    expect(mocks.appendSyncOperation).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
  });

  it("observeCurrentQueueMetrics does not mutate provided rows", async () => {
    const diag = await import("./syncDiagnostics");
    const rows = [
      { kind: "pending_sales", attempts: 3 },
      { kind: "product", attempts: 100 },
    ];
    const frozen = structuredClone(rows);
    diag.observeCurrentQueueMetrics(rows);
    expect(rows).toEqual(frozen);
    expect(diag.readSyncDiagnosticsSnapshot().obs1.softStopRetainedCount).toBe(1);
  });
});
