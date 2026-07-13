import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccount } from "../types";

const mockPushStaffToCloud = vi.fn();
const mockEnqueueSync = vi.fn();
const mockAfterStaffCloudAck = vi.fn();
const mockRefreshStaffCache = vi.fn();
const mockScheduleImmediateStaffPull = vi.fn();
const mockUpsertStaffAccountInStore = vi.fn();
const mockGetState = vi.fn();
const mockDeleteCloudStaff = vi.fn();
const mockResolveShopCtx = vi.fn();

vi.mock("./shopStaffCloud", () => ({
  pushStaffToCloud: (...args: unknown[]) => mockPushStaffToCloud(...args),
  deleteCloudStaff: (...args: unknown[]) => mockDeleteCloudStaff(...args),
}));

vi.mock("../offline/syncEngine", () => ({
  enqueueSync: (...args: unknown[]) => mockEnqueueSync(...args),
}));

vi.mock("./staffCacheSync", () => ({
  refreshStaffCacheAfterOwnerMutation: () => mockRefreshStaffCache(),
}));

vi.mock("./immediateSync", () => ({
  scheduleImmediateStaffPull: (...args: unknown[]) => mockScheduleImmediateStaffPull(...args),
}));

vi.mock("./staffSyncApply", () => ({
  upsertStaffAccountInStore: (...args: unknown[]) => mockUpsertStaffAccountInStore(...args),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => mockGetState(),
  },
}));

vi.mock("../offline/cloudSync", () => ({
  resolveShopCtx: () => mockResolveShopCtx(),
}));

vi.mock("../offline/localDb", () => ({
  readSyncQueue: vi.fn(async () => []),
}));

function staff(id: string, updatedAt: string, extra?: Partial<StaffAccount>): StaffAccount {
  return {
    id,
    name: "John",
    role: "cashier",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    pinHash: "hash-v1",
    ...extra,
  };
}

describe("staffSyncQueue — PIN reset reliability (25.1A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPushStaffToCloud.mockResolvedValue(true);
    mockAfterStaffCloudAck.mockResolvedValue(undefined);
    mockRefreshStaffCache.mockResolvedValue(undefined);
    mockUpsertStaffAccountInStore.mockResolvedValue(undefined);
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [] } });
    mockResolveShopCtx.mockResolvedValue({ shopId: "shop-1" });
    mockDeleteCloudStaff.mockResolvedValue(true);
  });

  it("scenario 1: online PIN reset pushes immediately and ACKs", async () => {
    const row = staff("staff-1", "2026-07-13T10:00:00.000Z");
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [row] } });

    const { syncStaffSecretResetInCloud } = await import("./staffSyncQueue");
    const result = await syncStaffSecretResetInCloud(row, { isOnline: true, field: "pin" });

    expect(result).toEqual({ ok: true });
    expect(mockPushStaffToCloud).toHaveBeenCalledWith(row);
    expect(mockEnqueueSync).not.toHaveBeenCalled();
    expect(mockRefreshStaffCache).toHaveBeenCalled();
    expect(mockScheduleImmediateStaffPull).toHaveBeenCalledWith("staff_ack");
  });

  it("scenario 2: offline PIN reset is queued for reconnect", async () => {
    const row = staff("staff-1", "2026-07-13T10:00:00.000Z");
    mockEnqueueSync.mockResolvedValue(undefined);

    const { syncStaffSecretResetInCloud } = await import("./staffSyncQueue");
    const result = await syncStaffSecretResetInCloud(row, { isOnline: false, field: "pin" });

    expect(result).toEqual({ ok: false, queued: true });
    expect(mockPushStaffToCloud).not.toHaveBeenCalled();
    expect(mockEnqueueSync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "staff:reset_secret:staff-1",
        kind: "pending_staff",
        payload: { action: "reset_secret", staff: row },
      }),
    );
  });

  it("scenario 3: multiple queue retries coalesce to single op id and use newest live row", async () => {
    const queued = staff("staff-1", "2026-07-13T10:00:00.000Z", { pinHash: "hash-old" });
    const live = staff("staff-1", "2026-07-13T10:05:00.000Z", { pinHash: "hash-new" });
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [live] } });

    const { processPendingStaffSync } = await import("./staffSyncQueue");
    const ok = await processPendingStaffSync({ action: "reset_secret", staff: queued });

    expect(ok).toBe(true);
    expect(mockPushStaffToCloud).toHaveBeenCalledWith(live);
    expect(mockPushStaffToCloud).toHaveBeenCalledTimes(1);
  });

  it("scenario 4: cloud ACK triggers cache refresh and immediate staff pull", async () => {
    const row = staff("staff-1", "2026-07-13T10:00:00.000Z");
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [row] } });

    const { processPendingStaffSync } = await import("./staffSyncQueue");
    await processPendingStaffSync({ action: "reset_secret", staff: row });

    expect(mockRefreshStaffCache).toHaveBeenCalled();
    expect(mockScheduleImmediateStaffPull).toHaveBeenCalledWith("staff_ack");
    expect(mockUpsertStaffAccountInStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: "staff-1", pendingCloudSync: false }),
    );
  });

  it("scenario 5: concurrent update — live store newer version wins over queued payload", async () => {
    const queued = staff("staff-1", "2026-07-13T10:00:00.000Z", { name: "John", pinHash: "hash-a" });
    const live = staff("staff-1", "2026-07-13T10:10:00.000Z", { name: "John Smith", pinHash: "hash-b" });
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [live] } });

    const { processPendingStaffSync } = await import("./staffSyncQueue");
    await processPendingStaffSync({ action: "reset_secret", staff: queued });

    expect(mockPushStaffToCloud).toHaveBeenCalledWith(live);
  });

  it("scenario 6: deleted staff — queued PIN reset is ignored safely", async () => {
    const queued = staff("staff-1", "2026-07-13T10:00:00.000Z");
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [] } });

    const { processPendingStaffSync } = await import("./staffSyncQueue");
    const ok = await processPendingStaffSync({ action: "reset_secret", staff: queued });

    expect(ok).toBe(true);
    expect(mockPushStaffToCloud).not.toHaveBeenCalled();
  });

  it("queues on push failure when online", async () => {
    const row = staff("staff-1", "2026-07-13T10:00:00.000Z");
    mockPushStaffToCloud.mockResolvedValue(false);
    mockEnqueueSync.mockResolvedValue(undefined);

    const { syncStaffSecretResetInCloud } = await import("./staffSyncQueue");
    const result = await syncStaffSecretResetInCloud(row, { isOnline: true, field: "pin" });

    expect(result).toEqual({ ok: false, queued: true });
    expect(mockEnqueueSync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "staff:reset_secret:staff-1" }),
    );
  });

  it("processPendingStaffSync returns false on push failure for retry", async () => {
    const row = staff("staff-1", "2026-07-13T10:00:00.000Z");
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [row] } });
    mockPushStaffToCloud.mockResolvedValue(false);

    const { processPendingStaffSync } = await import("./staffSyncQueue");
    const ok = await processPendingStaffSync({ action: "reset_secret", staff: row });

    expect(ok).toBe(false);
  });
});
