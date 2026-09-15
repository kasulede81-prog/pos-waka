import type { DayCloseSummary } from "../types";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import { buildDayCloseSnapshot } from "./dayCloseDocument";

/**
 * Correction-driven closed-day regeneration (Phase 8 of the historical financial
 * correction design).
 *
 * A financial correction never touches revenue, cash, payments, or any drawer figure —
 * only COGS/profit. So regenerating a closed day for a correction applies the correction's
 * own known deltas on top of the frozen original snapshot, rather than recomputing the
 * whole day from live data (which could silently absorb unrelated drift — e.g. a stock
 * count fix made after close — into what should be a narrowly-scoped, fully-audited
 * prior-period adjustment). This deliberately does NOT call getCompletedFinancials.
 *
 * Reuses the existing, unmodified activeDayCloseForDate/buildDayCloseSnapshot — the
 * same functions proven correct in the isolated synthetic supersede test. This module
 * adds no new persistence mechanism; the caller is responsible for writing the returned
 * rows into `dayCloses` (mirroring exactly how usePosStore's recordDayClose already
 * marks a superseded row) and pushing them via the existing pushDayCloseToCloud/
 * queueRemote("pending_day_closes", ...) path — unchanged.
 */
export type CorrectionDayCloseDelta = {
  correctionRecordId: string;
  cogsDeltaUgx: number;
  profitDeltaUgx: number;
};

export type RegenerateDayCloseForCorrectionResult =
  | { kind: "no_active_close"; dateKey: string }
  | { kind: "already_reflected"; activeCloseId: string }
  | { kind: "superseded"; supersededClose: DayCloseSummary; newClose: DayCloseSummary };

/**
 * Idempotently regenerate the active close for `dateKey`, if one exists, to reflect
 * `delta`. Pass the FULL current `dayCloses` array for the shop — this function does not
 * mutate it, it returns the two rows the caller should write back (the superseded
 * original, unchanged except for supersededAt, and the new active close).
 *
 * Idempotency: if the currently-active close's documentSnapshot.priorPeriodAdjustment
 * already lists this correctionRecordId, this is a no-op — calling this twice with the
 * same correction never double-applies the delta or creates a second superseding close.
 */
export function regenerateDayCloseForCorrection(params: {
  dateKey: string;
  dayCloses: DayCloseSummary[];
  delta: CorrectionDayCloseDelta;
  now: string;
  closedByUserId: string | null;
  closedByLabel: string;
  newCloseId: string;
}): RegenerateDayCloseForCorrectionResult {
  const { dateKey, dayCloses, delta, now, closedByUserId, closedByLabel, newCloseId } = params;

  const active = activeDayCloseForDate(dayCloses, dateKey);
  if (!active) {
    // Open day (or never closed at all) — nothing to regenerate. Live reports already
    // read straight from sale_line_items, so the correction is visible automatically.
    return { kind: "no_active_close", dateKey };
  }

  const alreadyReflected = active.documentSnapshot?.priorPeriodAdjustment?.correctionRecordIds?.includes(
    delta.correctionRecordId,
  );
  if (alreadyReflected) {
    return { kind: "already_reflected", activeCloseId: active.id };
  }

  const priorCorrectionIds = active.documentSnapshot?.priorPeriodAdjustment?.correctionRecordIds ?? [];
  const priorCogsDelta = active.documentSnapshot?.priorPeriodAdjustment?.cogsDeltaUgx ?? 0;
  const priorProfitDelta = active.documentSnapshot?.priorPeriodAdjustment?.profitDeltaUgx ?? 0;

  const supersededClose: DayCloseSummary = {
    ...active,
    supersededAt: now,
    pendingSync: true,
    updatedAt: now,
  };

  const newProfitEstimateUgx = active.profitEstimateUgx + delta.profitDeltaUgx;
  const newRow: Omit<DayCloseSummary, "documentSnapshot"> = {
    ...active,
    id: newCloseId,
    profitEstimateUgx: newProfitEstimateUgx,
    // Revenue, expected/counted cash, and variance are untouched by a financial
    // correction by design — carried forward from the original close verbatim.
    createdAt: now,
    supersededAt: null,
    overrideReason: null,
    replacesCloseId: active.id,
    pendingSync: true,
    updatedAt: now,
    closedByUserId,
    closedByLabel,
  };

  const documentSnapshot = buildDayCloseSnapshot({
    closedByUserId,
    closedByLabel,
    row: newRow,
    drawer: {
      // Cash/drawer figures are never affected by a financial correction — carried
      // forward unchanged from the original frozen snapshot, not recomputed.
      cashFromSalesUgx: active.documentSnapshot?.cashFromSalesUgx ?? 0,
      debtCollectedUgx: active.documentSnapshot?.debtCollectedUgx ?? 0,
      refundsUgx: active.documentSnapshot?.refundsUgx ?? 0,
      expenseUgx: active.documentSnapshot?.expenseUgx ?? 0,
      openingFloatUgx: active.documentSnapshot?.openingFloatUgx,
      cashSalesUgx: active.documentSnapshot?.cashSalesUgx,
      supplierPaymentsUgx: active.documentSnapshot?.supplierPaymentsUgx,
      adjustmentInflowsUgx: active.documentSnapshot?.adjustmentInflowsUgx,
      adjustmentOutflowsUgx: active.documentSnapshot?.adjustmentOutflowsUgx,
      cashRefundsUgx: active.documentSnapshot?.cashRefundsUgx,
    },
    transactionCount: active.documentSnapshot?.transactionCount ?? 0,
  });

  const newClose: DayCloseSummary = {
    ...newRow,
    documentSnapshot: {
      ...documentSnapshot,
      priorPeriodAdjustment: {
        cogsDeltaUgx: priorCogsDelta + delta.cogsDeltaUgx,
        profitDeltaUgx: priorProfitDelta + delta.profitDeltaUgx,
        correctionRecordIds: [...priorCorrectionIds, delta.correctionRecordId],
      },
    },
  };

  return { kind: "superseded", supersededClose, newClose };
}
