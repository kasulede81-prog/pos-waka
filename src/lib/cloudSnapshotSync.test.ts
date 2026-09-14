import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedSnapshot } from "../offline/localDb";
import { isAbsentCloudSnapshotTableError, snapshotContainsCoreData } from "./cloudSnapshotSync";
import { reportSwallowedSyncFailure } from "./monitoring";

const mockGetState = vi.fn();
const mockCanPublishShopCloudSnapshot = vi.fn();
const mockIsCloudRecoveryLockActive = vi.fn().mockReturnValue(false);
const mockAssertOrganizationOperationsAllowed = vi.fn().mockResolvedValue(undefined);
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockGetSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
const mockSnapshotSelect = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("../store/usePosStore", () => ({
  usePosStore: { getState: () => mockGetState() },
  applyRestoredSnapshotFromBackup: vi.fn(),
  persistRestoredSnapshotToDisk: vi.fn(),
}));

vi.mock("./shopRecoverySignals", () => ({
  canPublishShopCloudSnapshot: (...args: unknown[]) => mockCanPublishShopCloudSnapshot(...args),
}));

vi.mock("./cloudRecoverySession", () => ({
  isCloudRecoveryLockActive: (...args: unknown[]) => mockIsCloudRecoveryLockActive(...args),
}));

vi.mock("./organizationDeletionState", () => ({
  assertOrganizationOperationsAllowed: (...args: unknown[]) => mockAssertOrganizationOperationsAllowed(...args),
}));

const mockResolvePrimaryOrganizationForUser = vi
  .fn()
  .mockResolvedValue({ organizationId: "org-1", shopId: "shop-1" });

vi.mock("./fetchShopSubscription", () => ({
  resolvePrimaryOrganizationForUser: (...args: unknown[]) => mockResolvePrimaryOrganizationForUser(...args),
}));

vi.mock("../offline/entityStore", () => ({
  readEntityManifest: vi.fn().mockResolvedValue(null),
}));

vi.mock("./supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    from: (table: string) => ({
      upsert: (...args: unknown[]) => mockUpsert(table, ...args),
      select: () => ({
        eq: () => ({
          maybeSingle: () => mockSnapshotSelect(table),
        }),
      }),
    }),
  },
}));

function emptySnapshot(): PersistedSnapshot {
  return {
    products: [],
    customers: [],
    sales: [],
    preferences: {} as never,
    debtPayments: [],
    dayCloses: [],
    auditLogs: [],
    suppliers: [],
    purchases: [],
    supplierPayments: [],
    stockMovements: [],
    voidRecords: [],
    returnRecords: [],
    cashExpenses: [],
    cashDrawerAdjustments: [],
    dayDrawerOpens: [],
    inventoryCountSessions: [],
    archivedSales: [],
    archivedAuditLogs: [],
    archivedDayCloses: [],
    archivedVoidRecords: [],
    archivedReturnRecords: [],
    updatedAt: new Date().toISOString(),
  };
}

describe("cloudSnapshotSync core data helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("snapshotContainsCoreData is false when all core arrays are empty", () => {
    expect(snapshotContainsCoreData(emptySnapshot())).toBe(false);
  });

  it("snapshotContainsCoreData is true when products exist", () => {
    const snap = emptySnapshot();
    snap.products = [{ id: "p1" } as never];
    expect(snapshotContainsCoreData(snap)).toBe(true);
  });

  it("snapshotContainsCoreData is true when only sales exist", () => {
    const snap = emptySnapshot();
    snap.sales = [{ id: "s1" } as never];
    expect(snapshotContainsCoreData(snap)).toBe(true);
  });

  it("missing snapshot table stays intentionally silent; other restore errors are reported", () => {
    expect(isAbsentCloudSnapshotTableError({ code: "PGRST205" })).toBe(true);
    expect(isAbsentCloudSnapshotTableError({ code: "42P01" })).toBe(true);
    expect(isAbsentCloudSnapshotTableError({ code: "42501" })).toBe(false);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    if (!isAbsentCloudSnapshotTableError({ code: "PGRST205" })) {
      reportSwallowedSyncFailure("cloud_snapshot_restore_failed", "missing");
    }
    expect(warn).not.toHaveBeenCalled();

    reportSwallowedSyncFailure("cloud_snapshot_restore_failed", "permission denied", { code: "42501" });
    expect(JSON.stringify(warn.mock.calls)).toContain("cloud_snapshot_restore_failed");
  });
});

function hydratedStoreStateWithOneProduct(): Record<string, unknown> {
  return {
    _hydrated: true,
    products: [{ id: "p1", name: "Beans 1kg" }],
    customers: [],
    sales: [],
    preferences: {},
    debtPayments: [],
    dayCloses: [],
    auditLogs: [],
    suppliers: [],
    purchases: [],
    supplierPayments: [],
    stockMovements: [],
    voidRecords: [],
    returnRecords: [],
    cashExpenses: [],
    cashDrawerAdjustments: [],
    dayDrawerOpens: [],
    inventoryCountSessions: [],
    archivedSales: [],
    archivedAuditLogs: [],
    archivedDayCloses: [],
    archivedVoidRecords: [],
    archivedReturnRecords: [],
    pharmacyPrescriptions: [],
    pharmacyDoctors: [],
    pharmacyControlledRegister: [],
  };
}

describe("uploadShopCloudSnapshot — admin-reset safety net (TEST 7 / TEST 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue(hydratedStoreStateWithOneProduct());
    mockIsCloudRecoveryLockActive.mockReturnValue(false);
    mockAssertOrganizationOperationsAllowed.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    mockUpsert.mockResolvedValue({ error: null });
    mockSnapshotSelect.mockResolvedValue({ data: null, error: null });
    mockResolvePrimaryOrganizationForUser.mockResolvedValue({ organizationId: "org-1", shopId: "shop-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TEST 7 — refuses to publish this device's snapshot while a reset signal is unacknowledged", async () => {
    mockCanPublishShopCloudSnapshot.mockResolvedValue(false);

    const { uploadShopCloudSnapshot } = await import("./cloudSnapshotSync");
    await expect(uploadShopCloudSnapshot({ force: true })).resolves.toBe(false);

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("TEST 8 — publishes normally once there is no outstanding (or already-acknowledged) reset signal", async () => {
    mockCanPublishShopCloudSnapshot.mockResolvedValue(true);

    const { uploadShopCloudSnapshot } = await import("./cloudSnapshotSync");
    await expect(uploadShopCloudSnapshot({ force: true })).resolves.toBe(true);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0]?.[0]).toBe("shop_cloud_snapshots");
  });

  it("fails CLOSED (does not publish) when the reset-signal check itself cannot be resolved", async () => {
    // `canPublishShopCloudSnapshot` never rejects (it swallows its own
    // errors internally and resolves `false`) — this simulates that by
    // mocking the resolved value directly, proving `uploadShopCloudSnapshot`
    // treats "cannot confirm safe" as "refuse to publish," not the reverse.
    mockCanPublishShopCloudSnapshot.mockResolvedValue(false);

    const { uploadShopCloudSnapshot } = await import("./cloudSnapshotSync");
    await expect(uploadShopCloudSnapshot({ force: true })).resolves.toBe(false);

    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("restoreShopFromCloudSnapshot — admin-reset safety net", () => {
  // INCIDENT: a device recovering right after an admin reset restored from a
  // snapshot that still contained stale sales (the real `sales` table was
  // correctly empty, but the snapshot row — uploaded by a device that hadn't
  // yet reconciled the reset — was not). `restoreShopFromCloudSnapshot`
  // applies whatever the snapshot contains directly, with none of the
  // authoritative-replace protection `pullCloudAndMergeIntoStore` has.
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCloudRecoveryLockActive.mockReturnValue(false);
    mockAssertOrganizationOperationsAllowed.mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
    mockSnapshotSelect.mockResolvedValue({ data: null, error: null });
    mockResolvePrimaryOrganizationForUser.mockResolvedValue({ organizationId: "org-1", shopId: "shop-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to trust a downloaded snapshot while a reset signal is unacknowledged — never even queries shop_cloud_snapshots", async () => {
    mockCanPublishShopCloudSnapshot.mockResolvedValue(false);

    const { restoreShopFromCloudSnapshot } = await import("./cloudSnapshotSync");
    await expect(restoreShopFromCloudSnapshot()).resolves.toBe(false);

    // Proves the guard short-circuits BEFORE the snapshot fast path can
    // apply unverified content — the caller (runCloudDataRestore) sees
    // "no usable snapshot" and correctly falls through to the
    // authoritative-replace-protected full pull instead.
    expect(mockSnapshotSelect).not.toHaveBeenCalled();
  });

  it("proceeds to check for a snapshot normally once there is no outstanding (or already-acknowledged) reset signal", async () => {
    mockCanPublishShopCloudSnapshot.mockResolvedValue(true);

    const { restoreShopFromCloudSnapshot } = await import("./cloudSnapshotSync");
    // No snapshot row configured (mockSnapshotSelect resolves null) — this
    // just proves the guard let the function proceed to actually look.
    await expect(restoreShopFromCloudSnapshot()).resolves.toBe(false);

    expect(mockSnapshotSelect).toHaveBeenCalledTimes(1);
    expect(mockSnapshotSelect.mock.calls[0]?.[0]).toBe("shop_cloud_snapshots");
  });
});
