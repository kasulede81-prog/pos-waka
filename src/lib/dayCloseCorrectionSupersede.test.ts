import { describe, expect, it } from "vitest";
import type { DayCloseSummary } from "../types";
import { activeDayCloseForDate } from "./dayCloseIdempotency";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { regenerateDayCloseForCorrection } from "./dayCloseCorrectionSupersede";

const DATE_KEY = "2026-01-01";

function originalClose(): DayCloseSummary {
  const row: Omit<DayCloseSummary, "documentSnapshot"> = {
    id: "close-A",
    dateKey: DATE_KEY,
    expectedCashUgx: 100000,
    countedCashUgx: 100000,
    differenceUgx: 0,
    totalSalesUgx: 100000,
    totalDebtUgx: 0,
    profitEstimateUgx: 40000,
    createdAt: "2026-01-01T20:00:00.000Z",
    supersededAt: null,
    closedByUserId: "user-1",
    closedByLabel: "Owner",
  };
  const documentSnapshot = buildDayCloseSnapshot({
    closedByUserId: "user-1",
    closedByLabel: "Owner",
    row,
    drawer: { cashFromSalesUgx: 100000, debtCollectedUgx: 0, refundsUgx: 0, expenseUgx: 0 },
    transactionCount: 12,
  });
  return { ...row, documentSnapshot };
}

describe("regenerateDayCloseForCorrection", () => {
  it("is a no-op on an open day (no active close)", () => {
    const result = regenerateDayCloseForCorrection({
      dateKey: "2026-02-02",
      dayCloses: [],
      delta: { correctionRecordId: "corr-1", cogsDeltaUgx: -2000, profitDeltaUgx: 2000 },
      now: "2026-02-02T10:00:00.000Z",
      closedByUserId: "admin-1",
      closedByLabel: "Finance Admin",
      newCloseId: "close-B",
    });
    expect(result.kind).toBe("no_active_close");
  });

  it("supersedes a closed day exactly as specified in the worked example", () => {
    const closeA = originalClose();
    const result = regenerateDayCloseForCorrection({
      dateKey: DATE_KEY,
      dayCloses: [closeA],
      delta: { correctionRecordId: "corr-1", cogsDeltaUgx: -2000, profitDeltaUgx: 2000 },
      now: "2026-01-02T09:00:00.000Z",
      closedByUserId: "admin-1",
      closedByLabel: "Finance Admin",
      newCloseId: "close-B",
    });
    expect(result.kind).toBe("superseded");
    if (result.kind !== "superseded") throw new Error("unreachable");

    // Original close A: preserved, remains historically inspectable, is superseded,
    // original snapshot unchanged.
    expect(result.supersededClose.id).toBe("close-A");
    expect(result.supersededClose.supersededAt).toBe("2026-01-02T09:00:00.000Z");
    expect(result.supersededClose.documentSnapshot!.profitEstimateUgx).toBe(40000);
    expect(result.supersededClose.documentSnapshot!.totalSalesUgx).toBe(100000);
    expect(result.supersededClose.totalSalesUgx).toBe(100000);

    // New close B: active, corrected totals, replacesCloseId, priorPeriodAdjustment.
    expect(result.newClose.id).toBe("close-B");
    expect(result.newClose.supersededAt).toBeNull();
    expect(result.newClose.replacesCloseId).toBe("close-A");
    expect(result.newClose.totalSalesUgx).toBe(100000);
    expect(result.newClose.profitEstimateUgx).toBe(42000);
    expect(result.newClose.documentSnapshot!.totalSalesUgx).toBe(100000);
    expect(result.newClose.documentSnapshot!.profitEstimateUgx).toBe(42000);
    expect(result.newClose.documentSnapshot!.priorPeriodAdjustment).toEqual({
      cogsDeltaUgx: -2000,
      profitDeltaUgx: 2000,
      correctionRecordIds: ["corr-1"],
    });

    // activeDayCloseForDate resolves to the new close once both rows are in the array.
    const updated = [result.supersededClose, result.newClose];
    expect(activeDayCloseForDate(updated, DATE_KEY)?.id).toBe("close-B");
  });

  it("does not double-count when the same correction is regenerated twice", () => {
    const closeA = originalClose();
    const first = regenerateDayCloseForCorrection({
      dateKey: DATE_KEY,
      dayCloses: [closeA],
      delta: { correctionRecordId: "corr-1", cogsDeltaUgx: -2000, profitDeltaUgx: 2000 },
      now: "2026-01-02T09:00:00.000Z",
      closedByUserId: "admin-1",
      closedByLabel: "Finance Admin",
      newCloseId: "close-B",
    });
    if (first.kind !== "superseded") throw new Error("unreachable");
    const afterFirst = [first.supersededClose, first.newClose];

    // Same correction id regenerated again (e.g. a retried job, or an idempotent replay).
    const second = regenerateDayCloseForCorrection({
      dateKey: DATE_KEY,
      dayCloses: afterFirst,
      delta: { correctionRecordId: "corr-1", cogsDeltaUgx: -2000, profitDeltaUgx: 2000 },
      now: "2026-01-02T10:00:00.000Z",
      closedByUserId: "admin-1",
      closedByLabel: "Finance Admin",
      newCloseId: "close-C-should-not-exist",
    });
    expect(second.kind).toBe("already_reflected");
    if (second.kind !== "already_reflected") throw new Error("unreachable");
    expect(second.activeCloseId).toBe("close-B");

    // No close with the double-applied 56000/44000 values was ever produced, and the
    // active close is still exactly close-B.
    const activeStill = activeDayCloseForDate(afterFirst, DATE_KEY);
    expect(activeStill?.id).toBe("close-B");
    expect(activeStill?.profitEstimateUgx).toBe(42000);
    expect(activeStill?.documentSnapshot!.profitEstimateUgx).not.toBe(44000);
  });

  it("correctly chains a second, DIFFERENT correction on top of an already-corrected close", () => {
    const closeA = originalClose();
    const first = regenerateDayCloseForCorrection({
      dateKey: DATE_KEY,
      dayCloses: [closeA],
      delta: { correctionRecordId: "corr-1", cogsDeltaUgx: -2000, profitDeltaUgx: 2000 },
      now: "2026-01-02T09:00:00.000Z",
      closedByUserId: "admin-1",
      closedByLabel: "Finance Admin",
      newCloseId: "close-B",
    });
    if (first.kind !== "superseded") throw new Error("unreachable");
    const afterFirst = [first.supersededClose, first.newClose];

    const second = regenerateDayCloseForCorrection({
      dateKey: DATE_KEY,
      dayCloses: afterFirst,
      delta: { correctionRecordId: "corr-2", cogsDeltaUgx: -500, profitDeltaUgx: 500 },
      now: "2026-01-03T09:00:00.000Z",
      closedByUserId: "admin-1",
      closedByLabel: "Finance Admin",
      newCloseId: "close-C",
    });
    expect(second.kind).toBe("superseded");
    if (second.kind !== "superseded") throw new Error("unreachable");

    expect(second.newClose.id).toBe("close-C");
    expect(second.newClose.replacesCloseId).toBe("close-B");
    expect(second.newClose.profitEstimateUgx).toBe(42500);
    expect(second.newClose.documentSnapshot!.priorPeriodAdjustment).toEqual({
      cogsDeltaUgx: -2500,
      profitDeltaUgx: 2500,
      correctionRecordIds: ["corr-1", "corr-2"],
    });

    // close-A's original snapshot is still exactly as it was on day 1, unaffected by
    // either correction.
    expect(afterFirst[0]!.documentSnapshot!.profitEstimateUgx).toBe(40000);
  });
});
