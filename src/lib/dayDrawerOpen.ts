/**
 * Day-owned opening float — authoritative drawer open for formula v2.
 */

import type {
  CashDrawerAdjustment,
  CashDrawerFormulaVersion,
  DayDrawerOpen,
  Sale,
  ShiftRecord,
  ShopPreferences,
} from "../types";
import { dateKeyKampala } from "./datesUg";
import { revenueSalesOnDay } from "./financialMetrics";
import { sumAdjustmentsByType } from "./cashDrawerLedger";

export function resolveCashDrawerFormulaVersion(
  preferences: Pick<ShopPreferences, "cashDrawerFormulaVersion">,
): CashDrawerFormulaVersion {
  return preferences.cashDrawerFormulaVersion ?? "v1";
}

export function isFormulaV2(preferences: Pick<ShopPreferences, "cashDrawerFormulaVersion">): boolean {
  return resolveCashDrawerFormulaVersion(preferences) === "v2";
}

export function activeDayDrawerOpenForDate(
  dayDrawerOpens: DayDrawerOpen[],
  dateKey: string,
): DayDrawerOpen | null {
  return (
    dayDrawerOpens.find(
      (row) => !row.deletedAt && row.dateKey === dateKey && row.status === "open",
    ) ?? null
  );
}

export function completedSalesCountOnDay(sales: Sale[], day: string): number {
  return revenueSalesOnDay(sales, day).length;
}

export function isDayDrawerOpenMutable(sales: Sale[], dateKey: string): boolean {
  return completedSalesCountOnDay(sales, dateKey) === 0;
}

/** Legacy v1: adjustments + shift floats. v2: active DayDrawerOpen only. */
export function resolveOpeningFloatUgx(
  day: string,
  adjustments: CashDrawerAdjustment[],
  shifts: ShiftRecord[],
  opts?: {
    dayDrawerOpens?: DayDrawerOpen[];
    formulaVersion?: CashDrawerFormulaVersion;
  },
): number {
  const formulaVersion = opts?.formulaVersion ?? "v1";
  if (formulaVersion === "v2") {
    const active = activeDayDrawerOpenForDate(opts?.dayDrawerOpens ?? [], day);
    return active ? Math.max(0, Math.floor(active.openingFloatUgx)) : 0;
  }
  let total = sumAdjustmentsByType(adjustments, day, ["opening_float"]);
  for (const sh of shifts) {
    if (dateKeyKampala(sh.startAt) !== day) continue;
    const f = sh.openingFloatUgx ?? 0;
    if (f > 0) total += f;
  }
  return total;
}

export function floatVerificationWithinTolerance(
  expectedUgx: number,
  actualUgx: number,
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">,
): boolean {
  const expected = Math.max(0, Math.floor(expectedUgx));
  const actual = Math.max(0, Math.floor(actualUgx));
  if (expected === actual) return true;
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;
  const threshold = Math.max(Math.floor((pct / 100) * Math.max(1, expected)), fixed);
  return Math.abs(actual - expected) <= threshold;
}

/** Most recent closed shift on the same Kampala day (for handoff). */
export function latestClosedShiftForDay(shifts: ShiftRecord[], day: string): ShiftRecord | null {
  let best: ShiftRecord | null = null;
  let bestEnd = 0;
  for (const sh of shifts) {
    if (!sh.endAt) continue;
    if (dateKeyKampala(sh.startAt) !== day) continue;
    const endMs = new Date(sh.endAt).getTime();
    if (Number.isNaN(endMs)) continue;
    if (!best || endMs > bestEnd) {
      best = sh;
      bestEnd = endMs;
    }
  }
  return best;
}

export function shiftVerificationBaselineUgx(
  _day: string,
  _shifts: ShiftRecord[],
  dayOpen: DayDrawerOpen | null,
  priorShift: ShiftRecord | null,
): number {
  if (priorShift?.handoffFloatUgx != null && priorShift.handoffFloatUgx >= 0) {
    return Math.max(0, Math.floor(priorShift.handoffFloatUgx));
  }
  return dayOpen ? Math.max(0, Math.floor(dayOpen.openingFloatUgx)) : 0;
}

export function hasLegacyShiftFloatsOnDay(shifts: ShiftRecord[], day: string): boolean {
  return shifts.some(
    (sh) => dateKeyKampala(sh.startAt) === day && (sh.openingFloatUgx ?? 0) > 0,
  );
}

export function hasDuplicateOpeningFloatRisk(
  formulaVersion: CashDrawerFormulaVersion,
  day: string,
  adjustments: CashDrawerAdjustment[],
  shifts: ShiftRecord[],
  dayDrawerOpens: DayDrawerOpen[],
): boolean {
  if (formulaVersion !== "v2") return false;
  const dayOpen = activeDayDrawerOpenForDate(dayDrawerOpens, day);
  const legacyShift = hasLegacyShiftFloatsOnDay(shifts, day);
  const legacyAdj = sumAdjustmentsByType(adjustments, day, ["opening_float"]) > 0;
  return Boolean(dayOpen && (legacyShift || legacyAdj));
}

export function normalizeDayDrawerOpen(row: DayDrawerOpen): DayDrawerOpen {
  return {
    ...row,
    openingFloatUgx: Math.max(0, Math.floor(row.openingFloatUgx)),
    note: row.note?.trim() ?? "",
    countedByLabel: row.countedByLabel?.trim() || row.countedByUserId,
    pendingSync: row.pendingSync ?? false,
    cloudSyncedAt: row.cloudSyncedAt ?? null,
    deletedAt: row.deletedAt ?? null,
  };
}
