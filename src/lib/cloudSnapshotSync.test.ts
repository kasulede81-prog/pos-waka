import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedSnapshot } from "../offline/localDb";
import { isAbsentCloudSnapshotTableError, snapshotContainsCoreData } from "./cloudSnapshotSync";
import { reportSwallowedSyncFailure } from "./monitoring";

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
