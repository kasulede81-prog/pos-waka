import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncSaleImmediately: vi.fn().mockResolvedValue(true),
  runPosPushOnlyUpload: vi.fn().mockResolvedValue({ ran: true, skipped: false, pushOk: 1, pushFail: 0, queueFailed: 0 }),
  scheduleIncrementalCloudPull: vi.fn(),
}));

vi.mock("../offline/cloudSync", () => ({
  syncSaleImmediately: mocks.syncSaleImmediately,
  scheduleIncrementalCloudPull: mocks.scheduleIncrementalCloudPull,
}));

vi.mock("./posPushScheduler", () => ({
  runPosPushOnlyUpload: mocks.runPosPushOnlyUpload,
}));

vi.mock("./syncTiming", () => ({
  IMMEDIATE_PUSH_COALESCE_MS: 10,
}));

describe("immediateSync", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.syncSaleImmediately.mockReset();
    mocks.syncSaleImmediately.mockResolvedValue(true);
    mocks.runPosPushOnlyUpload.mockReset();
    mocks.runPosPushOnlyUpload.mockResolvedValue({
      ran: true,
      skipped: false,
      pushOk: 1,
      pushFail: 0,
      queueFailed: 0,
    });
    mocks.scheduleIncrementalCloudPull.mockReset();
  });

  it("routes sale enqueue through immediate sale sync", async () => {
    const { scheduleImmediateSyncForKind } = await import("./immediateSync");
    scheduleImmediateSyncForKind("pending_sales", { saleId: "sale-1" });
    await vi.waitFor(() => expect(mocks.syncSaleImmediately).toHaveBeenCalledWith("sale-1"));
    await vi.waitFor(() => expect(mocks.runPosPushOnlyUpload).toHaveBeenCalled());
  });

  it("schedules incremental pull on ack path without force", async () => {
    const { scheduleImmediatePull } = await import("./immediateSync");
    scheduleImmediatePull("sale_ack");
    await vi.waitFor(() =>
      expect(mocks.scheduleIncrementalCloudPull).toHaveBeenCalledWith("sale_ack", undefined),
    );
  });

  it("runs immediate sale push path without a full-bundle force pull", async () => {
    const { runImmediateSaleSync } = await import("./immediateSync");
    await runImmediateSaleSync("sale-2");
    expect(mocks.syncSaleImmediately).toHaveBeenCalledWith("sale-2");
    await vi.waitFor(() => expect(mocks.runPosPushOnlyUpload).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(mocks.scheduleIncrementalCloudPull).toHaveBeenCalledWith("sale_ack", undefined),
    );
    expect(mocks.scheduleIncrementalCloudPull).not.toHaveBeenCalledWith(
      "sale_ack",
      expect.objectContaining({ force: true }),
    );
  });

  it("schedules immediate push for P0 stock updates", async () => {
    vi.useFakeTimers();
    const { scheduleImmediateSyncForKind } = await import("./immediateSync");
    scheduleImmediateSyncForKind("pending_stock_updates", { kind: "adjustment" });
    vi.runAllTimers();
    await vi.waitFor(() => expect(mocks.runPosPushOnlyUpload).toHaveBeenCalled());
    vi.useRealTimers();
  });
});
