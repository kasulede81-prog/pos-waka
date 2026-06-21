import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: true,
  pushResult: { push: { ok: 1, fail: 0 }, queueFailed: 0 },
  recoveryLock: false,
  orgBlocked: false,
  syncInFlight: false,
  queue: [{ id: "1", kind: "pending_sales" as const, createdAt: "2026-01-01T00:00:00Z", attempts: 0, payload: {} }],
  unsyncedSales: 1,
  pushPaused: false,
  meta: {} as Record<string, unknown>,
}));

vi.mock("./deviceOnline", () => ({
  getDeviceOnline: () => mocks.online,
}));

vi.mock("./globalSyncMutex", () => ({
  isGlobalSyncInFlight: () => mocks.syncInFlight,
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
  pushShopPendingToCloud: async () => mocks.pushResult,
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
    ...mocks.meta,
  }),
  writeSyncHealthMeta: (partial: Record<string, unknown>) => {
    Object.assign(mocks.meta, partial);
  },
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
    mocks.pushResult = { push: { ok: 1, fail: 0 }, queueFailed: 0 };
    mocks.meta = {};
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
});
