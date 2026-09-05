import { describe, expect, it } from "vitest";
import type { DayCloseSummary } from "../types";
import { computeExpectedDrawerCashV2 } from "./cashDrawerLedger";
import { classifyCashVariance } from "./cashVarianceExperience";
import { cashPositionVariance } from "./cashPosition";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { applyClosedDayToCashPositionReport, readClosedDayTotals } from "./closedDayAuthority";
import { shiftExpectedCash } from "./saleAdjustments";
import type { CashPositionReport } from "./cashPosition";

const prefs = { cashVarianceThresholdPct: 5, cashVarianceThresholdUgxFixed: 10_000 };

function expected(partial: Partial<Parameters<typeof computeExpectedDrawerCashV2>[0]> = {}) {
  return computeExpectedDrawerCashV2({
    openingFloatUgx: 0,
    cashSalesUgx: 0,
    cashDebtCollectionsUgx: 0,
    adjustmentInflowsUgx: 0,
    adjustmentOutflowsUgx: 0,
    cashExpensesUgx: 0,
    cashSupplierPaymentsUgx: 0,
    cashRefundsUgx: 0,
    ...partial,
  });
}

describe("CASH-POST-06 signed expected cash ledger", () => {
  it("A — positive expected and zero variance at matching count", () => {
    const value = expected({
      openingFloatUgx: 100_000,
      cashSalesUgx: 100_000,
      cashExpensesUgx: 20_000,
    });
    expect(value).toBe(180_000);
    expect(cashPositionVariance(value, 180_000)).toEqual({ varianceUgx: 0, kind: "balanced" });
  });

  it("B — zero expected when opening equals expenses", () => {
    const value = expected({
      openingFloatUgx: 100_000,
      cashExpensesUgx: 100_000,
    });
    expect(value).toBe(0);
    expect(cashPositionVariance(value, 0)).toEqual({ varianceUgx: 0, kind: "balanced" });
  });

  it("C — negative expected is preserved, not floored to 0", () => {
    const value = expected({
      openingFloatUgx: 100_000,
      cashExpensesUgx: 150_000,
    });
    expect(value).toBe(-50_000);
    expect(value).not.toBe(0);
  });

  it("D — variance uses signed expected when count is 0", () => {
    const value = expected({
      openingFloatUgx: 100_000,
      cashExpensesUgx: 150_000,
    });
    const variance = cashPositionVariance(value, 0);
    expect(variance.varianceUgx).toBe(0 - -50_000);
    expect(variance.varianceUgx).toBe(50_000);
    expect(variance.kind).toBe("excess");

    const classified = classifyCashVariance(value, 0, prefs, "day_close");
    expect(classified.expectedCashUgx).toBe(-50_000);
    expect(classified.varianceUgx).toBe(50_000);
  });

  it("E — variance uses signed expected when count is positive", () => {
    const value = expected({
      openingFloatUgx: 100_000,
      cashExpensesUgx: 150_000,
    });
    const variance = cashPositionVariance(value, 20_000);
    expect(variance.varianceUgx).toBe(20_000 - -50_000);
    expect(variance.varianceUgx).toBe(70_000);

    const classified = classifyCashVariance(value, 20_000, prefs, "day_close");
    expect(classified.expectedCashUgx).toBe(-50_000);
    expect(classified.varianceUgx).toBe(70_000);
  });

  it("F — full-day terms unchanged except the zero floor", () => {
    expect(
      expected({
        openingFloatUgx: 50_000,
        cashSalesUgx: 500_000,
        cashDebtCollectionsUgx: 50_000,
        adjustmentInflowsUgx: 100_000,
        adjustmentOutflowsUgx: 300_000,
        cashExpensesUgx: 20_000,
        cashSupplierPaymentsUgx: 80_000,
        cashRefundsUgx: 20_000,
      }),
    ).toBe(280_000);
  });

  it("G — physical cash refunds still subtract", () => {
    expect(
      expected({
        openingFloatUgx: 100_000,
        cashSalesUgx: 50_000,
        cashRefundsUgx: 20_000,
      }),
    ).toBe(130_000);
  });

  it("H — supplier cash payments still subtract", () => {
    expect(
      expected({
        openingFloatUgx: 100_000,
        cashSupplierPaymentsUgx: 40_000,
      }),
    ).toBe(60_000);
  });

  it("I — debt collections still add", () => {
    expect(
      expected({
        openingFloatUgx: 100_000,
        cashDebtCollectionsUgx: 25_000,
      }),
    ).toBe(125_000);
  });

  it("J — newly created close snapshot keeps signed expected", () => {
    const signedExpected = expected({
      openingFloatUgx: 100_000,
      cashExpensesUgx: 150_000,
    });
    expect(signedExpected).toBe(-50_000);
    const counted = 0;
    const differenceUgx = counted - signedExpected;
    const row = {
      id: "close-new",
      dateKey: "2026-09-04",
      expectedCashUgx: signedExpected,
      countedCashUgx: counted,
      differenceUgx,
      totalSalesUgx: 0,
      totalDebtUgx: 0,
      profitEstimateUgx: 0,
      createdAt: "2026-09-04T20:00:00.000Z",
    };
    const snap = buildDayCloseSnapshot({
      closedByUserId: "owner-1",
      closedByLabel: "Owner",
      row,
      drawer: {
        cashFromSalesUgx: 0,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 150_000,
        openingFloatUgx: 100_000,
      },
      transactionCount: 0,
    });
    expect(snap.expectedCashUgx).toBe(-50_000);
    expect(snap.varianceUgx).toBe(50_000);
    expect(readClosedDayTotals({ ...row, documentSnapshot: snap }).expectedCashUgx).toBe(-50_000);
  });

  it("K — historical frozen snapshot is not rewritten", () => {
    const historical: DayCloseSummary = {
      id: "close-old",
      dateKey: "2026-09-03",
      expectedCashUgx: 0,
      countedCashUgx: 0,
      differenceUgx: 0,
      totalSalesUgx: 0,
      totalDebtUgx: 0,
      profitEstimateUgx: 0,
      createdAt: "2026-09-03T20:00:00.000Z",
      documentSnapshot: {
        documentVersion: 2,
        generatedAt: "2026-09-03T20:00:00.000Z",
        closedByUserId: "owner-1",
        closedByLabel: "Owner",
        expectedCashUgx: 0,
        countedCashUgx: 0,
        varianceUgx: 0,
        totalSalesUgx: 0,
        profitEstimateUgx: 0,
        totalDebtUgx: 0,
        cashFromSalesUgx: 0,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 150_000,
        transactionCount: 0,
        openingFloatUgx: 100_000,
      },
    };
    expect(readClosedDayTotals(historical).expectedCashUgx).toBe(0);
    expect(readClosedDayTotals(historical).varianceUgx).toBe(0);

    const liveReport = {
      dayKey: "2026-09-03",
      shopName: "Waka",
      generatedAt: "2026-09-05T08:00:00.000Z",
      summary: { totalSalesUgx: 0, transactionCount: 0 },
      cashPosition: { expectedCashUgx: -50_000 },
    } as unknown as CashPositionReport;
    const frozen = applyClosedDayToCashPositionReport(liveReport, historical);
    expect(frozen.cashPosition.expectedCashUgx).toBe(0);
  });

  it("L — shift expected cash still uses its own floored formula", () => {
    expect(
      shiftExpectedCash(
        {
          id: "sh1",
          actorUserId: "u1",
          role: "cashier",
          startAt: "2026-09-04T08:00:00.000Z",
          salesTotalUgx: 0,
          debtTotalUgx: 0,
          refundsUgx: 0,
          estimatedCashUgx: -10_000,
          openingFloatUgx: 5_000,
          debtPaymentsTotalUgx: 0,
        },
        { formulaVersion: "v1" },
      ),
    ).toBe(0);
  });
});
