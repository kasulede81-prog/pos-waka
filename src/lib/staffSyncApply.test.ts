import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccount } from "../types";

const mockSetState = vi.fn();
const mockGetState = vi.fn();

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => mockGetState(),
    setState: (...args: unknown[]) => mockSetState(...args),
  },
}));

function staff(id: string, name: string, updatedAt: string, extra?: Partial<StaffAccount>): StaffAccount {
  return {
    id,
    name,
    role: "cashier",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
    ...extra,
  };
}

describe("staffSyncApply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [] } });
  });

  it("scenario 1: create cashier then manager yields 2 unique staff", async () => {
    const { dedupeStaffAccountsById, upsertStaffAccountInStore } = await import("./staffSyncApply");

    mockGetState.mockReturnValue({
      preferences: { staffAccounts: [staff("cashier-1", "Cashier", "2026-07-01T10:00:00.000Z")] },
    });

    await upsertStaffAccountInStore(staff("manager-1", "Manager", "2026-07-01T11:00:00.000Z", { role: "manager" }));

    const lastCall = mockSetState.mock.calls.at(-1)?.[0] as {
      preferences: { staffAccounts: StaffAccount[] };
    };
    const ids = lastCall.preferences.staffAccounts.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(dedupeStaffAccountsById(lastCall.preferences.staffAccounts)).toHaveLength(2);
  });

  it("scenario 2: partial cloud payload merge preserves local-only staff", async () => {
    const { mergeStaffAccountsWithDedupe } = await import("./staffSyncApply");

    const local = [
      staff("local-only", "Local", "2026-07-01T09:00:00.000Z", { pendingCloudSync: true }),
      staff("shared", "Shared Local", "2026-07-01T10:00:00.000Z"),
    ];
    const cloud = [staff("shared", "Shared Cloud", "2026-07-01T11:00:00.000Z")];

    const merged = mergeStaffAccountsWithDedupe(local, cloud);
    expect(merged).toHaveLength(2);
    expect(merged.some((s) => s.id === "local-only")).toBe(true);
    expect(merged.find((s) => s.id === "shared")?.name).toBe("Shared Cloud");
  });

  it("scenario 3: empty cloud payload does not delete local staff", async () => {
    const { mergeStaffAccountsWithDedupe } = await import("./staffSyncApply");

    const local = [staff("a", "Alice", "2026-07-01T10:00:00.000Z")];
    const merged = mergeStaffAccountsWithDedupe(local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("a");
  });

  it("scenario 4: duplicate cloud row merges to single record", async () => {
    const { dedupeStaffAccountsById } = await import("./staffSyncApply");

    const rows = [
      staff("dup", "First", "2026-07-01T10:00:00.000Z"),
      staff("dup", "Second", "2026-07-01T11:00:00.000Z"),
    ];
    const deduped = dedupeStaffAccountsById(rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.name).toBe("Second");
  });

  it("scenario 5: upsert after cache mirror does not duplicate same id", async () => {
    const { upsertStaffAccountInStore } = await import("./staffSyncApply");

    const row = staff("same-id", "Cashier", "2026-07-01T10:00:00.000Z");
    mockGetState.mockReturnValue({ preferences: { staffAccounts: [row] } });

    await upsertStaffAccountInStore({ ...row, name: "Cashier", pendingCloudSync: false });

    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("applyStaffAccountsMergeToStore merges without shrinking local list", async () => {
    mockGetState.mockReturnValue({
      preferences: {
        staffAccounts: [staff("keep", "Keep", "2026-07-01T10:00:00.000Z", { pendingCloudSync: true })],
      },
    });

    const { applyStaffAccountsMergeToStore } = await import("./staffSyncApply");
    const stats = await applyStaffAccountsMergeToStore([], { source: "test" });

    expect(stats.preservedLocal).toBe(1);
    expect(stats.mergedCount).toBe(1);
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("applyStaffAccountsMergeToStore applies cloud tombstones", async () => {
    mockGetState.mockReturnValue({
      preferences: {
        staffAccounts: [
          staff("gone", "Deleted", "2026-07-01T10:00:00.000Z"),
          staff("keep", "Keep", "2026-07-01T10:00:00.000Z"),
        ],
      },
    });

    const { applyStaffAccountsMergeToStore } = await import("./staffSyncApply");
    await applyStaffAccountsMergeToStore([], {
      source: "test",
      removedIds: ["gone"],
    });

    const lastCall = mockSetState.mock.calls.at(-1)?.[0] as {
      preferences: { staffAccounts: StaffAccount[] };
    };
    expect(lastCall.preferences.staffAccounts.map((s) => s.id)).toEqual(["keep"]);
  });

  it("computeImplicitStaffTombstones removes non-pending staff missing from cache", async () => {
    const { computeImplicitStaffTombstones } = await import("./staffSyncApply");
    const local = [
      staff("gone", "Gone", "2026-07-01T10:00:00.000Z"),
      staff("b", "B", "2026-07-01T10:00:00.000Z", { pendingCloudSync: true }),
    ];
    const cache = [staff("a", "A", "2026-07-01T11:00:00.000Z")];
    expect(computeImplicitStaffTombstones(local, cache)).toEqual(["gone"]);
  });
});

describe("mergeStaffAccountsForCloudSync regression", () => {
  it("cross-device: phone B receives phone A staff via cloud merge", async () => {
    const { mergeStaffAccountsWithDedupe } = await import("./staffSyncApply");
    const phoneA = [staff("cashier", "Cashier", "2026-07-01T10:00:00.000Z")];
    const phoneBLocal: StaffAccount[] = [];
    const cloudFromA = phoneA;

    const onB = mergeStaffAccountsWithDedupe(phoneBLocal, cloudFromA);
    expect(onB).toHaveLength(1);

    const onA = mergeStaffAccountsWithDedupe(phoneA, [
      staff("manager", "Manager", "2026-07-01T11:00:00.000Z", { role: "manager" }),
    ]);
    expect(onA).toHaveLength(2);
    expect(onA.some((s) => s.id === "cashier")).toBe(true);
    expect(onA.some((s) => s.id === "manager")).toBe(true);
  });
});
