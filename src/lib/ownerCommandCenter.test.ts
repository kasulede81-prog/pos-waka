import { describe, expect, it } from "vitest";
import type { ShiftRecord } from "../types";
import {
  buildAttentionCenter,
  buildShiftAccountabilityRows,
  buildShiftShortageAttentionItems,
} from "./ownerCommandCenter";
import { buildHistoricalShiftStats, buildOwnerDashboardIntegritySnapshot } from "./ownerDashboardIntegrityCache";
import type { DateFilterBounds } from "./dateFilters";

const DAY = "2026-06-11";

const bounds: DateFilterBounds = {
  fromKey: DAY,
  toKey: DAY,
  isSingleDay: true,
};

function shift(partial: Partial<ShiftRecord> & Pick<ShiftRecord, "id" | "actorUserId" | "startAt">): ShiftRecord {
  return {
    role: "cashier",
    salesTotalUgx: 0,
    debtTotalUgx: 0,
    refundsUgx: 0,
    estimatedCashUgx: 0,
    actorName: "Sarah",
    endAt: `${DAY}T18:00:00.000Z`,
    openingFloatUgx: 50_000,
    cashDifferenceUgx: null,
    verificationVarianceUgx: null,
    verifiedAt: null,
    verifiedByLabel: null,
    ...partial,
  };
}

function emptyIntegrity() {
  return buildOwnerDashboardIntegritySnapshot({
    bounds,
    customers: [],
    sales: [],
    debtPayments: [],
    products: [],
    stockMovements: [],
    dayDrawerOpens: [],
    shifts: [],
    syncPendingCount: 0,
    syncErrorCount: 0,
  });
}

describe("ownerCommandCenter", () => {
  it("groups shift shortages into critical vs warning by amount", () => {
    const shifts = [
      shift({ id: "s1", actorUserId: "u1", startAt: `${DAY}T08:00:00.000Z`, cashDifferenceUgx: -1_000 }),
      shift({ id: "s2", actorUserId: "u2", startAt: `${DAY}T09:00:00.000Z`, cashDifferenceUgx: -15_000 }),
    ];
    const items = buildShiftShortageAttentionItems(shifts, bounds, "en");
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === "shift-short-s1")?.severity).toBe("warning");
    expect(items.find((i) => i.id === "shift-short-s2")?.severity).toBe("critical");
  });

  it("flags repeat offenders using historical shift stats", () => {
    const shifts = [
      shift({ id: "s1", actorUserId: "u1", startAt: `${DAY}T08:00:00.000Z`, cashDifferenceUgx: -5_000 }),
      shift({ id: "s2", actorUserId: "u1", startAt: `${DAY}T14:00:00.000Z`, cashDifferenceUgx: -6_000 }),
      shift({ id: "s3", actorUserId: "u2", startAt: `${DAY}T08:00:00.000Z`, cashDifferenceUgx: 2_000 }),
    ];
    const historicalStats = buildHistoricalShiftStats(shifts);
    const rows = buildShiftAccountabilityRows(shifts, bounds, "en", historicalStats);
    const offender = rows.find((r) => r.userId === "u1");
    const clean = rows.find((r) => r.userId === "u2");
    expect(offender?.isRepeatOffender).toBe(true);
    expect(offender?.shortageCount).toBe(2);
    expect(offender?.cumulativeShortageUgx).toBe(11_000);
    expect(offender?.lifetimeShortageCount).toBe(2);
    expect(clean?.isRepeatOffender).toBe(false);
  });

  it("deduplicates attention items by id", () => {
    const integrity = emptyIntegrity();
    const result = buildAttentionCenter(
      {
        lang: "en",
        bounds,
        sales: [],
        products: [],
        customers: [],
        suppliers: [],
        shifts: [],
        dayCloses: [],
        dayDrawerOpens: [],
        cashDrawerAdjustments: [],
        cashExpenses: [],
        debtPayments: [],
        stockMovements: [],
        purchases: [],
        supplierPayments: [],
        inventoryCountSessions: [],
        auditLogs: [],
        voidRecords: [],
        returnRecords: [],
        preferences: {
          businessType: "kiosk_duka",
          kioskQuickSell: true,
          onboardingDone: true,
          schemaVersion: 2,
        } as never,
        ownerAlertsResolved: [],
        riskCards: [],
        acknowledgements: [],
        expectedCashUgx: 0,
        pharmacyMode: false,
        syncPendingCount: 0,
        syncErrorCount: 0,
      },
      integrity,
    );
    const allIds = [...result.critical, ...result.warnings, ...result.information].map((i) => i.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
