import { describe, expect, it } from "vitest";
import type { HospitalityFloorState, Sale, StaffAccount } from "../types";
import { computeHospitalityReports } from "./hospitalityReports";
import { resolveSaleWaiterAttribution } from "./waiterAttribution";

const staff: StaffAccount[] = [
  {
    id: "waiter-1",
    name: "James",
    role: "cashier",
    pinHash: "x",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "cashier-1",
    name: "Mary",
    role: "cashier",
    pinHash: "x",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function floorWithWaiter(sessionId: string, saleId: string): HospitalityFloorState {
  return {
    areas: [],
    tables: [],
    stations: [],
    sessions: [
      {
        id: sessionId,
        sessionKind: "table",
        tableId: "t1",
        saleId,
        guestCount: 2,
        waiterStaffId: "waiter-1",
        waiterLabel: "James",
        status: "closed",
        openedAt: "2026-06-02T10:00:00.000Z",
        updatedAt: "2026-06-02T11:00:00.000Z",
        pendingSync: false,
      },
    ],
  };
}

function completedSale(overrides: Partial<Sale> & Pick<Sale, "id">): Sale {
  return {
    id: overrides.id,
    status: "completed",
    lines: [],
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 10_000,
    debtUgx: 0,
    estimatedProfitUgx: 2_000,
    createdAt: overrides.createdAt ?? "2026-06-02T12:00:00.000Z",
    pendingSync: false,
    soldByUserId: overrides.soldByUserId ?? "cashier-1",
    waiterStaffId: overrides.waiterStaffId ?? null,
    waiterName: overrides.waiterName ?? null,
    tableSessionId: overrides.tableSessionId ?? null,
    referenceLabel: overrides.referenceLabel ?? "Table 1",
  };
}

describe("waiter attribution", () => {
  it("attributes revenue to waiter when cashier settles", () => {
    const sessionId = "sess-1";
    const sale = completedSale({
      id: "sale-1",
      tableSessionId: sessionId,
      waiterStaffId: "waiter-1",
      waiterName: "James",
      soldByUserId: "cashier-1",
    });
    const floor = floorWithWaiter(sessionId, sale.id);
    const attr = resolveSaleWaiterAttribution(sale, floor, staff);
    expect(attr.reportLabel).toBe("James");
    expect(attr.waiterStaffId).toBe("waiter-1");

    const report = computeHospitalityReports([sale], [], { fromKey: "2026-06-02", toKey: "2026-06-02" }, {
      floor,
      staffAccounts: staff,
    });
    expect(report.waiters[0]?.label).toBe("James");
    expect(report.waiters[0]?.revenueUgx).toBe(10_000);
  });

  it("attributes revenue to waiter when manager settles", () => {
    const sessionId = "sess-2";
    const sale = completedSale({
      id: "sale-2",
      tableSessionId: sessionId,
      waiterStaffId: "waiter-1",
      waiterName: "James",
      soldByUserId: "manager-1",
    });
    const report = computeHospitalityReports([sale], [], { fromKey: "2026-06-02", toKey: "2026-06-02" }, {
      floor: floorWithWaiter(sessionId, sale.id),
      staffAccounts: staff,
    });
    expect(report.waiters[0]?.waiterId).toBe("waiter-1");
    expect(report.waiters[0]?.label).toBe("James");
  });

  it("falls back to soldByUserId for legacy sales without waiter metadata", () => {
    const sale = completedSale({
      id: "legacy-1",
      soldByUserId: "cashier-1",
      waiterStaffId: null,
      waiterName: null,
      tableSessionId: null,
    });
    const attr = resolveSaleWaiterAttribution(sale, null, staff);
    expect(attr.reportLabel).toBe("Mary");
    const report = computeHospitalityReports([sale], [], { fromKey: "2026-06-02", toKey: "2026-06-02" }, {
      staffAccounts: staff,
    });
    expect(report.waiters[0]?.label).toBe("Mary");
  });
});
