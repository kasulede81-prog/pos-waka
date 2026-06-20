import { describe, expect, it } from "vitest";
import type { InventoryCountSession, ShiftRecord, DayCloseSummary } from "../types";
import { mergeInventoryCountSessionPair } from "./inventoryCountRecovery";
import { mergeShiftPair } from "./shiftRecovery";
import { mergeDayClosePair } from "./dayCloseRecovery";
import { normalizeInventoryCountSession } from "./inventoryCount";

describe("operational sync merge — inventory count", () => {
  const base = normalizeInventoryCountSession({
    id: "sess-1",
    sessionNumber: 1,
    status: "counting",
    startedAt: "2026-06-01T08:00:00.000Z",
    startedBy: "u1",
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    appliedAt: null,
    appliedBy: null,
    snapshotCreatedAt: "2026-06-01T08:00:00.000Z",
    notes: "",
    lines: [
      {
        id: "line-1",
        sessionId: "sess-1",
        productId: "p1",
        expectedQtySnapshot: 10,
        countedQty: 10,
        varianceQty: 0,
        varianceCostUgx: 0,
        varianceRetailUgx: 0,
        reason: "",
        updatedAt: "2026-06-01T08:00:00.000Z",
      },
    ],
    pendingSync: true,
    updatedAt: "2026-06-01T08:00:00.000Z",
  });

  it("prefers approved status from cloud over local counting", () => {
    const remote: InventoryCountSession = {
      ...base,
      status: "approved",
      updatedAt: "2026-06-01T09:00:00.000Z",
      pendingSync: false,
    };
    const merged = mergeInventoryCountSessionPair(base, remote);
    expect(merged.status).toBe("approved");
    expect(merged.pendingSync).toBe(false);
  });
});

describe("operational sync merge — shift", () => {
  const open: ShiftRecord = {
    id: "sh-1",
    actorUserId: "u1",
    role: "cashier",
    startAt: "2026-06-01T08:00:00.000Z",
    endAt: null,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    pendingSync: true,
  };

  it("prefers closed shift with counted cash from cloud", () => {
    const closed: ShiftRecord = {
      ...open,
      endAt: "2026-06-01T17:00:00.000Z",
      countedCashUgx: 50000,
      cashDifferenceUgx: -500,
      pendingSync: false,
      updatedAt: "2026-06-01T17:00:00.000Z",
    };
    const merged = mergeShiftPair(open, closed);
    expect(merged.endAt).toBe(closed.endAt);
    expect(merged.countedCashUgx).toBe(50000);
    expect(merged.cashDifferenceUgx).toBe(-500);
  });
});

describe("operational sync merge — day close", () => {
  const local: DayCloseSummary = {
    id: "dc-1",
    dateKey: "2026-06-01",
    expectedCashUgx: 100000,
    countedCashUgx: 99000,
    differenceUgx: -1000,
    totalSalesUgx: 80000,
    totalDebtUgx: 0,
    profitEstimateUgx: 20000,
    createdAt: "2026-06-01T18:00:00.000Z",
    pendingSync: true,
    updatedAt: "2026-06-01T18:00:00.000Z",
  };

  it("duplicate active closes keep newer remote", () => {
    const remote: DayCloseSummary = {
      ...local,
      id: "dc-2",
      countedCashUgx: 100000,
      differenceUgx: 0,
      createdAt: "2026-06-01T19:00:00.000Z",
      updatedAt: "2026-06-01T19:00:00.000Z",
      pendingSync: false,
    };
    const merged = mergeDayClosePair(local, remote);
    expect(merged.id).toBe("dc-2");
    expect(merged.countedCashUgx).toBe(100000);
  });
});
