/**
 * Cash Management hub — reuses existing cash/drawer calculations (no new ledger math).
 */

import type {
  CashDrawerAdjustment,
  DayCloseSummary,
  DayDrawerOpen,
  Language,
  ShiftRecord,
  ShopPreferences,
} from "../types";
import { actorDisplayLabel } from "./activityNarrative";
import { dateKeyKampala } from "./datesUg";
import { resolveDateFilterBounds } from "./dateFilters";
import { activeDayDrawerOpenForDate, dayCloseVarianceIsFlagged, isFormulaV2 } from "./dayDrawerOpen";
import { collectDayDrawerOpenDiagnostics } from "./dayDrawerOpenDiagnostics";
import {
  buildCashControlSnapshot,
  buildShiftAccountabilityRows,
  type CashAdjustmentFeedRow,
  type FloatVerificationFeedRow,
} from "./ownerCommandCenter";
import { buildHistoricalShiftStats } from "./ownerDashboardIntegrityCache";

export type CashManagementSnapshot = {
  dayKey: string;
  drawerOpen: DayDrawerOpen | null;
  isBalanced: boolean;
  periodExpectedCashUgx: number;
  latestCountedCashUgx: number | null;
  latestDayVarianceUgx: number | null;
  shortageShiftCount: number;
  floatMismatchCount: number;
  adjustmentFeed: CashAdjustmentFeedRow[];
  floatVerificationFeed: FloatVerificationFeedRow[];
  varianceHistory: Array<{
    id: string;
    dateKey: string;
    expectedCashUgx: number;
    countedCashUgx: number;
    differenceUgx: number;
    flagged: boolean;
  }>;
  topShortages: Array<{ userId: string; label: string; lifetimeShortageUgx: number; shortageCount30d: number }>;
  drawerConflictCount: number;
};

export function buildCashManagementSnapshot(input: {
  lang: Language;
  preferences: ShopPreferences;
  dayDrawerOpens: DayDrawerOpen[];
  dayCloses: DayCloseSummary[];
  shifts: ShiftRecord[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  expectedCashUgx: number;
}): CashManagementSnapshot {
  const dayKey = dateKeyKampala(new Date());
  const bounds = resolveDateFilterBounds({ kind: "day", dateKey: dayKey }, new Date(`${dayKey}T12:00:00.000Z`));

  const cash = buildCashControlSnapshot({
    bounds,
    primaryDayKey: dayKey,
    dayDrawerOpens: input.dayDrawerOpens,
    dayCloses: input.dayCloses,
    shifts: input.shifts,
    cashDrawerAdjustments: input.cashDrawerAdjustments,
    expectedCashUgx: input.expectedCashUgx,
    lang: input.lang,
  });

  const drawerOpen = activeDayDrawerOpenForDate(input.dayDrawerOpens, dayKey);
  const drawerDiag = collectDayDrawerOpenDiagnostics(input.dayDrawerOpens, input.shifts, dayKey);
  const drawerConflictCount =
    drawerDiag.duplicateOpenCount +
    (drawerDiag.conflictingDeviceCount > 1 ? drawerDiag.conflictingDeviceCount : 0) +
    drawerDiag.verificationMismatchCount;

  const latestVariance = cash.latestDayVarianceUgx;
  const isBalanced =
    latestVariance != null &&
    !dayCloseVarianceIsFlagged(cash.periodExpectedCashUgx, latestVariance, input.preferences) &&
    cash.shortageShiftCount === 0 &&
    cash.floatMismatchCount === 0 &&
    drawerConflictCount === 0;

  const varianceHistory = [...input.dayCloses]
    .filter((c) => !c.supersededAt)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 15)
    .map((c) => ({
      id: c.id,
      dateKey: c.dateKey,
      expectedCashUgx: c.expectedCashUgx,
      countedCashUgx: c.countedCashUgx,
      differenceUgx: c.differenceUgx,
      flagged: dayCloseVarianceIsFlagged(c.expectedCashUgx, c.differenceUgx, input.preferences),
    }));

  const historical = buildHistoricalShiftStats(input.shifts);
  const shiftRows = buildShiftAccountabilityRows(input.shifts, bounds, input.lang, historical);
  const topShortages = shiftRows
    .filter((r) => r.lifetimeShortageUgx > 0 || r.shortageCount30d > 0)
    .slice(0, 5)
    .map((r) => ({
      userId: r.userId,
      label: r.label,
      lifetimeShortageUgx: r.lifetimeShortageUgx,
      shortageCount30d: r.shortageCount30d,
    }));

  void isFormulaV2(input.preferences);

  return {
    dayKey,
    drawerOpen,
    isBalanced,
    periodExpectedCashUgx: cash.periodExpectedCashUgx,
    latestCountedCashUgx: cash.latestCountedCashUgx,
    latestDayVarianceUgx: cash.latestDayVarianceUgx,
    shortageShiftCount: cash.shortageShiftCount,
    floatMismatchCount: cash.floatMismatchCount,
    adjustmentFeed: cash.adjustmentFeed,
    floatVerificationFeed: cash.floatVerificationFeed,
    varianceHistory,
    topShortages,
    drawerConflictCount,
  };
}

export function canAccessCashManagement(role: import("../types").UserRole): boolean {
  return (
    role === "owner" ||
    role === "manager" ||
    role === "supervisor" ||
    role === "cashier" ||
    role === "stock_keeper"
  );
}

export function cashActorLabel(userId: string, lang: Language): string {
  return actorDisplayLabel(userId, lang);
}
