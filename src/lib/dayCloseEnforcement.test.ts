import { describe, expect, it } from "vitest";
import {
  assertDayClosePreflightPassed,
  buildDayClosePreflightSnapshot,
  collectOpenShifts,
} from "./dayCloseEnforcement";
import { assertBusinessDateNotLocked } from "./businessDateLock";
import { findUnclosedPriorBusinessDays, resolvePrioritizedCloseDateKey } from "./sequentialBusinessDays";
import type { DayCloseSummary, ShiftRecord } from "../types";

const DAY = "2026-06-10";

function shift(partial: Partial<ShiftRecord> & Pick<ShiftRecord, "id" | "actorUserId">): ShiftRecord {
  return {
    actorName: "Cashier",
    role: "cashier",
    startAt: `${DAY}T08:14:00.000Z`,
    endAt: null,
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    ...partial,
  };
}

describe("dayCloseEnforcement", () => {
  it("collectOpenShifts lists active shifts only", () => {
    const rows = collectOpenShifts([
      shift({ id: "s1", actorUserId: "u1", endAt: null }),
      shift({ id: "s2", actorUserId: "u2", endAt: `${DAY}T18:00:00.000Z` }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorName).toBe("Cashier");
  });

  it("blocks close when open shift exists on the same business day", () => {
    const snapshot = buildDayClosePreflightSnapshot({
      state: {
        draftLines: { length: 0 },
        activePendingSaleId: null,
        sales: [],
        preferences: { shifts: [shift({ id: "s1", actorUserId: "u1" })], cashDrawerFormulaVersion: "v2" },
        dayCloses: [],
        dayDrawerOpens: [
          {
            id: "do1",
            dateKey: DAY,
            openingFloatUgx: 50_000,
            status: "open",
          } as never,
        ],
        products: [],
        returnRecords: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        inventoryCountSessions: [],
      },
      dateKey: DAY,
      expectedCashUgx: 100_000,
      countedCashUgx: 100_000,
      queue: [],
    });
    expect(snapshot.canClose).toBe(false);
    expect(snapshot.openShifts).toHaveLength(1);
    const gate = assertDayClosePreflightPassed({ ok: false, snapshot, warnings: [], blockReasons: snapshot.blockReasons });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.errorKey).toBe("dayCloseBlockedOpenShifts");
  });

  it("ignores open shifts from later business days when closing a prior day", () => {
    const snapshot = buildDayClosePreflightSnapshot({
      state: {
        draftLines: { length: 0 },
        activePendingSaleId: null,
        sales: [
          {
            id: "sale1",
            status: "completed",
            createdAt: `${DAY}T10:00:00.000Z`,
            updatedAt: `${DAY}T10:00:00.000Z`,
            subtotalUgx: 1000,
            totalUgx: 1000,
            cashPaidUgx: 1000,
            debtUgx: 0,
            lines: [],
            estimatedProfitUgx: 100,
            pendingSync: false,
            lastSyncError: null,
          },
        ],
        preferences: {
          shifts: [shift({ id: "s-today", actorUserId: "u1", startAt: "2026-06-12T08:14:00.000Z", endAt: null })],
          cashDrawerFormulaVersion: "v2",
        },
        dayCloses: [],
        dayDrawerOpens: [],
        products: [],
        returnRecords: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        inventoryCountSessions: [],
      },
      dateKey: DAY,
      expectedCashUgx: 100_000,
      countedCashUgx: 100_000,
      queue: [],
      cloudPullStale: false,
    });
    expect(snapshot.openShifts).toHaveLength(0);
    expect(snapshot.canClose).toBe(true);
  });

  it("allows retrospective close without day open record when day is in the past", () => {
    const snapshot = buildDayClosePreflightSnapshot({
      state: {
        draftLines: { length: 0 },
        activePendingSaleId: null,
        sales: [
          {
            id: "sale1",
            status: "completed",
            createdAt: `${DAY}T10:00:00.000Z`,
            updatedAt: `${DAY}T10:00:00.000Z`,
            subtotalUgx: 1000,
            totalUgx: 1000,
            cashPaidUgx: 1000,
            debtUgx: 0,
            lines: [],
            estimatedProfitUgx: 100,
            pendingSync: false,
            lastSyncError: null,
          },
        ],
        preferences: { shifts: [], cashDrawerFormulaVersion: "v2" },
        dayCloses: [],
        dayDrawerOpens: [],
        products: [],
        returnRecords: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        inventoryCountSessions: [],
      },
      dateKey: DAY,
      expectedCashUgx: 100_000,
      countedCashUgx: 100_000,
      queue: [],
      cloudPullStale: false,
    });
    const dayOpenItem = snapshot.items.find((i) => i.id === "day_open");
    expect(dayOpenItem?.status).toBe("pass");
    expect(snapshot.canClose).toBe(true);
  });

  it("business date lock after active close", () => {
    const close: DayCloseSummary = {
      id: "c1",
      dateKey: DAY,
      expectedCashUgx: 1,
      countedCashUgx: 1,
      differenceUgx: 0,
      totalSalesUgx: 1,
      totalDebtUgx: 0,
      profitEstimateUgx: 0,
      createdAt: `${DAY}T20:00:00.000Z`,
    };
    expect(assertBusinessDateNotLocked([close], DAY).ok).toBe(false);
  });

  it("finds unclosed prior business days", () => {
    const prior = findUnclosedPriorBusinessDays({
      targetDateKey: "2026-06-11",
      dayCloses: [],
      sales: [
        {
          id: "sale1",
          status: "completed",
          createdAt: "2026-06-10T10:00:00.000Z",
          updatedAt: "2026-06-10T10:00:00.000Z",
          subtotalUgx: 1000,
          totalUgx: 1000,
          cashPaidUgx: 1000,
          debtUgx: 0,
          lines: [],
          estimatedProfitUgx: 100,
          pendingSync: false,
          lastSyncError: null,
        },
      ],
      shifts: [],
      dayDrawerOpens: [],
    });
    expect(prior).toContain("2026-06-10");
  });

  it("resolvePrioritizedCloseDateKey picks oldest unclosed prior day", () => {
    const sales = [
      {
        id: "sale1",
        status: "completed" as const,
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z",
        subtotalUgx: 1000,
        totalUgx: 1000,
        cashPaidUgx: 1000,
        debtUgx: 0,
        lines: [],
        estimatedProfitUgx: 100,
        pendingSync: false,
        lastSyncError: null,
      },
    ];
    const key = resolvePrioritizedCloseDateKey({
      todayDateKey: "2026-06-12",
      dayCloses: [],
      sales,
      shifts: [],
      dayDrawerOpens: [],
    });
    expect(key).toBe("2026-06-10");
  });

  it("cash_counted checklist links to cash drawer for the same business date", () => {
    const snapshot = buildDayClosePreflightSnapshot({
      state: {
        draftLines: { length: 0 },
        activePendingSaleId: null,
        sales: [],
        preferences: { shifts: [], cashDrawerFormulaVersion: "v2" },
        dayCloses: [],
        dayDrawerOpens: [],
        products: [],
        returnRecords: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        inventoryCountSessions: [],
      },
      dateKey: DAY,
      expectedCashUgx: 100_000,
      countedCashUgx: null,
      queue: [],
      cloudPullStale: false,
    });
    const cashItem = snapshot.items.find((i) => i.id === "cash_counted");
    expect(cashItem?.status).toBe("pending");
    expect(cashItem?.navigateTo).toBe(`/office/cash-drawer?date=${DAY}&from=close-day#count`);
  });
});
