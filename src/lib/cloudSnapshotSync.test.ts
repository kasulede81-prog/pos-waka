import { describe, expect, it } from "vitest";
import type { PersistedSnapshot } from "../offline/localDb";
import { snapshotContainsCoreData } from "./cloudSnapshotSync";

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
});
