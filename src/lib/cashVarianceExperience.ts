/**
 * Unified cash variance UX — classification and diagnostics only.
 * Uses existing tolerance formulas from dayDrawerOpen (no accounting changes).
 */

import type { ShiftRecord, ShopPreferences } from "../types";
import { dayCloseVarianceIsFlagged } from "./dayDrawerOpen";
import type { StatusKind } from "./statusTokens";

export type CashVarianceState =
  | "within_tolerance"
  | "minor_variance"
  | "outside_tolerance"
  | "critical_variance";

export type CashVarianceContext = "shift_open" | "shift_close" | "shift_recovery" | "day_close";

export type CashVarianceAssessment = {
  expectedCashUgx: number;
  countedCashUgx: number;
  varianceUgx: number;
  thresholdUgx: number;
  withinTolerance: boolean;
  flagged: boolean;
  state: CashVarianceState;
  decisionKey: string;
};

export function computeCashVarianceThresholdUgx(
  expectedCashUgx: number,
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">,
): number {
  const pct = preferences.cashVarianceThresholdPct ?? 5;
  const fixed = preferences.cashVarianceThresholdUgxFixed ?? 10_000;
  const exp = Math.max(1, Math.floor(expectedCashUgx));
  return Math.max((pct / 100) * exp, fixed);
}

export function classifyCashVariance(
  expectedCashUgx: number,
  countedCashUgx: number,
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">,
  context: CashVarianceContext = "shift_close",
): CashVarianceAssessment {
  const expected = Math.max(0, Math.floor(expectedCashUgx));
  const counted = Math.max(0, Math.floor(countedCashUgx));
  const varianceUgx = counted - expected;
  const thresholdUgx = computeCashVarianceThresholdUgx(expected, preferences);
  const flagged = dayCloseVarianceIsFlagged(expected, varianceUgx, preferences);
  const absVar = Math.abs(varianceUgx);

  let state: CashVarianceState;
  if (varianceUgx === 0) {
    state = "within_tolerance";
  } else if (!flagged) {
    state = "minor_variance";
  } else if (absVar > thresholdUgx * 2) {
    state = "critical_variance";
  } else {
    state = "outside_tolerance";
  }

  const decisionKey = resolveVarianceDecisionKey(state, context, flagged);

  return {
    expectedCashUgx: expected,
    countedCashUgx: counted,
    varianceUgx,
    thresholdUgx,
    withinTolerance: !flagged,
    flagged,
    state,
    decisionKey,
  };
}

function resolveVarianceDecisionKey(
  state: CashVarianceState,
  context: CashVarianceContext,
  flagged: boolean,
): string {
  if (context === "day_close") {
    if (flagged) return "drawerVarianceDecisionDayCloseBlocked";
    return "drawerVarianceDecisionDayCloseOk";
  }
  if (context === "shift_recovery") {
    if (state === "critical_variance") return "drawerVarianceDecisionRecoveryCritical";
    if (flagged) return "drawerVarianceDecisionRecoveryOutside";
    return "drawerVarianceDecisionRecoveryOk";
  }
  if (context === "shift_open") {
    if (flagged) return "drawerVarianceDecisionShiftOpenOverride";
    return "drawerVarianceDecisionShiftOpenOk";
  }
  // shift_close
  if (state === "critical_variance") return "drawerVarianceDecisionShiftCloseCritical";
  if (flagged) return "drawerVarianceDecisionShiftCloseOutside";
  return "drawerVarianceDecisionShiftCloseOk";
}

export function varianceStateStatusKind(state: CashVarianceState): StatusKind {
  switch (state) {
    case "within_tolerance":
      return "success";
    case "minor_variance":
      return "warning";
    case "outside_tolerance":
      return "danger";
    case "critical_variance":
      return "danger";
  }
}

export function varianceStateLabelKey(state: CashVarianceState): string {
  switch (state) {
    case "within_tolerance":
      return "drawerVarianceStateWithin";
    case "minor_variance":
      return "drawerVarianceStateMinor";
    case "outside_tolerance":
      return "drawerVarianceStateOutside";
    case "critical_variance":
      return "drawerVarianceStateCritical";
  }
}

export type ShiftCashAuditTimelineEntry = {
  id: string;
  labelKey: string;
  value: string;
};

export function buildShiftCashAuditTimeline(
  shift: Pick<
    ShiftRecord,
    | "startAt"
    | "endAt"
    | "countedCashUgx"
    | "cashDifferenceUgx"
    | "recoveredByLabel"
    | "recoveredAt"
    | "recoveredByUserId"
  >,
  expectedCashUgx: number,
  preferences: Pick<ShopPreferences, "cashVarianceThresholdPct" | "cashVarianceThresholdUgxFixed">,
): ShiftCashAuditTimelineEntry[] {
  const counted = shift.countedCashUgx ?? null;
  const variance =
    shift.cashDifferenceUgx ??
    (counted != null ? counted - expectedCashUgx : null);
  const assessment =
    counted != null
      ? classifyCashVariance(expectedCashUgx, counted, preferences, "shift_close")
      : null;

  const fmt = (n: number | null | undefined) =>
    n != null ? `UGX ${Math.floor(n).toLocaleString()}` : "—";

  const entries: ShiftCashAuditTimelineEntry[] = [
    { id: "expected", labelKey: "drawerTimelineExpected", value: fmt(expectedCashUgx) },
    { id: "counted", labelKey: "drawerTimelineCounted", value: fmt(counted) },
    { id: "variance", labelKey: "drawerTimelineVariance", value: variance != null ? fmt(variance) : "—" },
    {
      id: "tolerance",
      labelKey: "drawerTimelineTolerance",
      value: assessment ? `±UGX ${assessment.thresholdUgx.toLocaleString()}` : "—",
    },
  ];

  if (shift.recoveredByLabel || shift.recoveredByUserId) {
    entries.push({
      id: "recovered",
      labelKey: "drawerTimelineRecoveredBy",
      value: shift.recoveredByLabel ?? shift.recoveredByUserId ?? "—",
    });
  }

  entries.push({
    id: "closed",
    labelKey: "drawerTimelineClosed",
    value: shift.endAt ? new Date(shift.endAt).toLocaleString() : "—",
  });

  return entries;
}

export function logDrawerDiagnostic(
  event: string,
  assessment: Pick<
    CashVarianceAssessment,
    "expectedCashUgx" | "countedCashUgx" | "varianceUgx" | "thresholdUgx" | "state" | "decisionKey"
  >,
  extra?: Record<string, unknown>,
): void {
  console.info(`[waka-drawer] ${event}`, {
    expected: assessment.expectedCashUgx,
    counted: assessment.countedCashUgx,
    variance: assessment.varianceUgx,
    tolerance: assessment.thresholdUgx,
    state: assessment.state,
    decision: assessment.decisionKey,
    ...extra,
  });
}
