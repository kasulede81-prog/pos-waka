import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: true,
  pushResult: { push: { ok: 1, fail: 0 }, queueFailed: 0, hadOutboundWork: true },
  recoveryLock: false,
  orgBlocked: false,
  syncInFlight: false,
  queue: [{ id: "1", kind: "pending_sales" as const, createdAt: "2026-01-01T00:00:00Z", attempts: 0, payload: {} }],
  unsyncedSales: 1,
  pushPaused: false,
  throwOnPush: false,
  meta: {} as Record<string, unknown>,
  publish: vi.fn(),
  publishAfterCycle: vi.fn(),
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => mocks.online,
}));

vi.mock("./globalSyncMutex", () => ({
  isPullSyncInFlight: () => mocks.syncInFlight,
}));

vi.mock("./backgroundWorkPolicy", () => ({
  shouldPausePosBackgroundPush: () => mocks.pushPaused,
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
    },
  },
}));

vi.mock("./cloudRecoverySession", () => ({
  isCloudRecoveryLockActive: () => mocks.recoveryLock,
}));

vi.mock("./organizationDeletionState", () => ({
  assertOrganizationOperationsAllowed: async () => {
    if (mocks.orgBlocked) throw new Error("blocked");
  },
}));

vi.mock("../offline/localDb", () => ({
  readSyncQueue: async () => mocks.queue,
}));

vi.mock("../offline/cloudSync", () => ({
  countUnsyncedSales: () => mocks.unsyncedSales,
  pushShopPendingToCloud: async () => {
    if (mocks.throwOnPush) throw new Error("upload exploded");
    return mocks.pushResult;
  },
}));

vi.mock("./syncMeta", () => ({
  readSyncHealthMeta: () => ({
    posPushAttempts: 0,
    posPushSuccesses: 0,
    posPushFailures: 0,
    lastPosPushAt: null,
    lastPosPushSuccessAt: null,
    lastPosPushSkipReason: null,
    posPushUploadActive: false,
    lastIssueCode: "none",
    entityPullErrors: {},
    ...mocks.meta,
  }),
  writeSyncHealthMeta: (partial: Record<string, unknown>) => {
    Object.assign(mocks.meta, partial);
  },
  publishShopSyncHealth: (...args: unknown[]) => mocks.publish(...args),
  publishShopSyncHealthAfterPushCycle: (...args: unknown[]) => mocks.publishAfterCycle(...args),
  formatCloudSyncLastError: () =>
    mocks.meta.lastIssueCode === "error"
      ? "error"
      : mocks.meta.lastIssueCode === "partial"
        ? "partial"
        : null,
  countPendingOutboundFromKnown: (queue: number, unsynced: number) => (queue > 0 ? queue : unsynced),
}));

vi.mock("./nativeApp", () => ({
  isNativeApp: () => false,
}));

describe("posPushScheduler", () => {
  beforeEach(() => {
    mocks.online = true;
    mocks.recoveryLock = false;
    mocks.orgBlocked = false;
    mocks.syncInFlight = false;
    mocks.pushPaused = false;
    mocks.queue = [{ id: "1", kind: "pending_sales", createdAt: "2026-01-01T00:00:00Z", attempts: 0, payload: {} }];
    mocks.unsyncedSales = 1;
    mocks.pushResult = { push: { ok: 1, fail: 0 }, queueFailed: 0, hadOutboundWork: true };
    mocks.throwOnPush = false;
    mocks.meta = {};
    mocks.publish.mockClear();
    mocks.publishAfterCycle.mockClear();
    vi.resetModules();
  });

  it("skips upload when offline", async () => {
    mocks.online = false;
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    const result = await runPosPushOnlyUpload({ force: true });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("offline");
  });

  it("skips upload when recovery lock is active", async () => {
    mocks.recoveryLock = true;
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    const result = await runPosPushOnlyUpload({ force: true });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("recovery_lock");
  });

  it("pushes pending sales when allowed", async () => {
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    const result = await runPosPushOnlyUpload({ force: true });
    expect(result.ran).toBe(true);
    expect(result.pushOk).toBe(1);
    expect(mocks.meta.posPushUploadActive).toBe(false);
  });

  it("records success diagnostics", async () => {
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    await runPosPushOnlyUpload({ force: true });
    expect(mocks.meta.posPushSuccesses).toBe(1);
    expect(mocks.meta.lastPosPushAt).toBeTruthy();
  });

  it("does not publish sync health on no_pending skip", async () => {
    mocks.queue = [];
    mocks.unsyncedSales = 0;
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    const result = await runPosPushOnlyUpload();
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_pending");
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.publishAfterCycle).not.toHaveBeenCalled();
  });

  it("publishes sync health after a completed push cycle", async () => {
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    await runPosPushOnlyUpload({ force: true });
    expect(mocks.publishAfterCycle).toHaveBeenCalledTimes(1);
    expect(mocks.publishAfterCycle.mock.calls[0]![0]).toMatchObject({
      pushFail: 0,
      queueFailed: 0,
      pushOk: 1,
      hadOutboundWork: true,
    });
  });

  it("publishes error without claiming push success when the upload throws", async () => {
    mocks.throwOnPush = true;
    const { runPosPushOnlyUpload } = await import("./posPushScheduler");
    const result = await runPosPushOnlyUpload({ force: true });
    expect(result.ran).toBe(true);
    expect(result.pushFail).toBe(1);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: "error", includeLastError: true }),
    );
    expect(mocks.publishAfterCycle).not.toHaveBeenCalled();
  });
});
