import { describe, expect, it } from "vitest";
import { buildDayClosePdfBlob, buildDayCloseSnapshot } from "./dayCloseDocument";
import type { DayCloseSummary } from "../types";

describe("dayClosePdf", () => {
  it("builds snapshot metadata", () => {
    const snap = buildDayCloseSnapshot({
      closedByUserId: "u1",
      closedByLabel: "Owner",
      row: {
        id: "c1",
        dateKey: "2026-06-02",
        expectedCashUgx: 100_000,
        countedCashUgx: 99_000,
        differenceUgx: -1000,
        totalSalesUgx: 150_000,
        totalDebtUgx: 10_000,
        profitEstimateUgx: 40_000,
        createdAt: "2026-06-02T18:00:00.000Z",
      },
      drawer: {
        cashFromSalesUgx: 80_000,
        debtCollectedUgx: 20_000,
        refundsUgx: 5000,
        expenseUgx: 2000,
      },
      transactionCount: 12,
    });
    expect(snap.documentVersion).toBe(1);
    expect(snap.transactionCount).toBe(12);
    expect(snap.varianceUgx).toBe(-1000);
  });

  it("builds day close PDF blob", () => {
    const close: DayCloseSummary = {
      id: "c1",
      dateKey: "2026-06-02",
      expectedCashUgx: 50_000,
      countedCashUgx: 50_000,
      differenceUgx: 0,
      totalSalesUgx: 60_000,
      totalDebtUgx: 0,
      profitEstimateUgx: 15_000,
      createdAt: "2026-06-02T18:00:00.000Z",
      documentSnapshot: {
        documentVersion: 1,
        generatedAt: "2026-06-02T18:00:00.000Z",
        closedByUserId: null,
        closedByLabel: "Owner",
        expectedCashUgx: 50_000,
        countedCashUgx: 50_000,
        varianceUgx: 0,
        totalSalesUgx: 60_000,
        profitEstimateUgx: 15_000,
        totalDebtUgx: 0,
        cashFromSalesUgx: 50_000,
        debtCollectedUgx: 0,
        refundsUgx: 0,
        expenseUgx: 0,
        transactionCount: 5,
      },
    };
    const blob = buildDayClosePdfBlob("en", close, "Test Shop");
    expect(blob.size).toBeGreaterThan(400);
  });
});
