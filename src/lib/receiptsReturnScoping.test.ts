import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale } from "../types";
import type { DateFilterBounds } from "./dateFilters";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { getCompletedFinancials, getCompletedFinancialsFromScoped, getCompletedRevenue } from "./financialMetrics";
import { partitionReceiptsSales } from "./receiptsGrouping";
import { returnMatchesFilter, saleMatchesFilter } from "./dateFilters";

const DAY1 = "2026-06-01";
const DAY2 = "2026-06-02";
const DAY3 = "2026-06-03";
const DAY4 = "2026-06-04";
const DAY5 = "2026-06-05";
const PRIOR_MONTH = "2026-05-15";

const products: Product[] = [
  {
    id: "prod-1",
    name: "Widget",
    sellingPricePerUnitUgx: 100_000,
    costPricePerUnitUgx: 60_000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: `${DAY1}T09:00:00.000Z`,
    version: 1,
  },
];

function bounds(fromKey: string, toKey: string): DateFilterBounds {
  return { fromKey, toKey, isSingleDay: fromKey === toKey };
}

function saleOnDay(day: string, partial: Partial<Sale> & Pick<Sale, "id" | "status" | "totalUgx">): Sale {
  return {
    createdAt: `${day}T10:00:00.000Z`,
    updatedAt: `${day}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx - 60_000,
    lines: [
      {
        productId: "prod-1",
        name: "Widget",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 60_000,
        estimatedProfitUgx: partial.totalUgx - 60_000,
        inputMode: "quantity",
        lineTotalUgx: partial.totalUgx,
      },
    ],
    pendingSync: false,
    ...partial,
  };
}

function returnOnDay(
  day: string,
  partial: Partial<ReturnRecord> & Pick<ReturnRecord, "id" | "saleId" | "refundAmountUgx">,
): ReturnRecord {
  return {
    productId: "prod-1",
    productName: "Widget",
    quantity: 1,
    reason: "restocked",
    actorUserId: "owner",
    actorName: "Owner",
    shiftId: null,
    createdAt: `${day}T14:00:00.000Z`,
    ...partial,
  };
}

/** Mirrors ReceiptsPage hero totals after return-scoping fix. */
function receiptsHeroTotals(
  sales: Sale[],
  returns: ReturnRecord[],
  rangeBounds: DateFilterBounds,
) {
  const filteredInRange = sales.filter((s) => saleMatchesFilter(s, rangeBounds));
  const completed = partitionReceiptsSales(filteredInRange).completed;
  const filteredReturns = returns.filter((r) => returnMatchesFilter(r, rangeBounds));
  const financials = getCompletedFinancialsFromScoped(completed, filteredReturns, products);
  return {
    profitUgx: financials.profitUgx,
    revenueUgx: getCompletedRevenue(completed, filteredReturns, products),
  };
}

/** Mirrors Reports single-day / custom-bounds path (filtered sales + filtered returns). */
function reportsTotals(sales: Sale[], returns: ReturnRecord[], rangeBounds: DateFilterBounds) {
  const filteredSales = sales.filter((s) => saleMatchesFilter(s, rangeBounds));
  const filteredReturns = returns.filter((r) => returnMatchesFilter(r, rangeBounds));
  const fin = getCompletedFinancialsFromScoped(filteredSales, filteredReturns, products);
  return { profitUgx: fin.profitUgx, revenueUgx: fin.revenueUgx };
}

function legacyReceiptsHeroTotals(sales: Sale[], returns: ReturnRecord[], rangeBounds: DateFilterBounds) {
  const filteredInRange = sales.filter((s) => saleMatchesFilter(s, rangeBounds));
  const completed = partitionReceiptsSales(filteredInRange).completed;
  const financials = getCompletedFinancialsFromScoped(completed, returns, products);
  return {
    profitUgx: financials.profitUgx,
    revenueUgx: getCompletedRevenue(completed, returns, products),
  };
}

describe("receipts return scoping", () => {
  const saleA = saleOnDay(DAY1, { id: "sale-a", status: "completed", totalUgx: 100_000 });
  const fullReturn = returnOnDay(DAY5, { id: "ret-a", saleId: saleA.id, refundAmountUgx: 100_000 });
  const adjustedSale = { ...saleA, ...reduceSaleTotalsByAmount(saleA, 100_000) };
  const crossDaySales = [adjustedSale];
  const crossDayReturns = [fullReturn];

  it("scenario A — empty range between sale and return shows zero profit and revenue", () => {
    const range = bounds(DAY2, DAY4);
    const totals = receiptsHeroTotals(crossDaySales, crossDayReturns, range);
    expect(totals.profitUgx).toBe(0);
    expect(totals.revenueUgx).toBe(0);
    expect(legacyReceiptsHeroTotals(crossDaySales, crossDayReturns, range).profitUgx).toBe(-40_000);
  });

  it("scenario B — day 1 only matches Reports", () => {
    const range = bounds(DAY1, DAY1);
    expect(receiptsHeroTotals(crossDaySales, crossDayReturns, range)).toEqual(
      reportsTotals(crossDaySales, crossDayReturns, range),
    );
  });

  it("scenario C — day 5 only matches Reports", () => {
    const range = bounds(DAY5, DAY5);
    expect(receiptsHeroTotals(crossDaySales, crossDayReturns, range)).toEqual(
      reportsTotals(crossDaySales, crossDayReturns, range),
    );
  });

  it("scenario D — full range including sale and return is unchanged", () => {
    const range = bounds(DAY1, DAY5);
    const scoped = receiptsHeroTotals(crossDaySales, crossDayReturns, range);
    const legacy = legacyReceiptsHeroTotals(crossDaySales, crossDayReturns, range);
    expect(scoped).toEqual(legacy);
    expect(scoped.profitUgx).toBe(0);
    expect(scoped.revenueUgx).toBe(0);
  });

  it("same-day full return nets to zero within the day", () => {
    const sameDaySale = saleOnDay(DAY1, { id: "sale-sd", status: "completed", totalUgx: 100_000 });
    const sameDayRet = returnOnDay(DAY1, { id: "ret-sd", saleId: sameDaySale.id, refundAmountUgx: 100_000 });
    const adjusted = { ...sameDaySale, ...reduceSaleTotalsByAmount(sameDaySale, 100_000) };
    const range = bounds(DAY1, DAY1);
    const totals = receiptsHeroTotals([adjusted], [sameDayRet], range);
    expect(totals.profitUgx).toBe(0);
    expect(totals.revenueUgx).toBe(0);
    expect(totals).toEqual(reportsTotals([adjusted], [sameDayRet], range));
  });

  it("partial return within range reduces profit correctly", () => {
    const sale = saleOnDay(DAY1, { id: "sale-partial", status: "completed", totalUgx: 100_000 });
    const partialRet = returnOnDay(DAY1, {
      id: "ret-partial",
      saleId: sale.id,
      refundAmountUgx: 50_000,
      quantity: 1,
    });
    const adjusted = { ...sale, ...reduceSaleTotalsByAmount(sale, 50_000) };
    const range = bounds(DAY1, DAY1);
    const totals = receiptsHeroTotals([adjusted], [partialRet], range);
    expect(totals.revenueUgx).toBe(50_000);
    expect(totals).toEqual(reportsTotals([adjusted], [partialRet], range));
  });

  it("unrelated historical return does not affect a narrow day with its own sale", () => {
    const daySale = saleOnDay(DAY3, { id: "sale-d3", status: "completed", totalUgx: 80_000 });
    const oldSale = saleOnDay(PRIOR_MONTH, { id: "sale-old", status: "completed", totalUgx: 50_000 });
    const oldReturn = returnOnDay(PRIOR_MONTH, {
      id: "ret-old",
      saleId: oldSale.id,
      refundAmountUgx: 20_000,
    });
    const adjustedOld = { ...oldSale, ...reduceSaleTotalsByAmount(oldSale, 20_000) };
    const range = bounds(DAY3, DAY3);
    const totals = receiptsHeroTotals([daySale, adjustedOld], [oldReturn], range);
    expect(totals.revenueUgx).toBe(80_000);
    expect(totals.profitUgx).toBe(20_000);
    expect(legacyReceiptsHeroTotals([daySale, adjustedOld], [oldReturn], range).revenueUgx).toBe(60_000);
  });

  it("cross-month return only applies when return day is in bounds", () => {
    const juneSale = saleOnDay(DAY1, { id: "sale-june", status: "completed", totalUgx: 100_000 });
    const mayReturn = returnOnDay(PRIOR_MONTH, {
      id: "ret-may",
      saleId: juneSale.id,
      refundAmountUgx: 100_000,
    });
    const adjusted = { ...juneSale, ...reduceSaleTotalsByAmount(juneSale, 100_000) };

    const juneOnly = bounds(DAY1, DAY5);
    expect(receiptsHeroTotals([adjusted], [mayReturn], juneOnly).profitUgx).toBe(40_000);

    const mayOnly = bounds(PRIOR_MONTH, PRIOR_MONTH);
    expect(receiptsHeroTotals([adjusted], [mayReturn], mayOnly).profitUgx).toBe(-40_000);

    const full = bounds(PRIOR_MONTH, DAY5);
    expect(receiptsHeroTotals([adjusted], [mayReturn], full).profitUgx).toBe(0);
  });

  it("revenue unchanged when no returns exist in range", () => {
    const sale = saleOnDay(DAY2, { id: "sale-only", status: "completed", totalUgx: 45_000 });
    const range = bounds(DAY2, DAY2);
    const withReturns = receiptsHeroTotals([sale], crossDayReturns, range);
    const withoutReturns = receiptsHeroTotals([sale], [], range);
    expect(withReturns).toEqual(withoutReturns);
    expect(withReturns.revenueUgx).toBe(45_000);
  });

  it("multiple returns only count those inside bounds", () => {
    const sale1 = saleOnDay(DAY1, { id: "sale-1", status: "completed", totalUgx: 30_000 });
    const sale2 = saleOnDay(DAY5, { id: "sale-2", status: "completed", totalUgx: 70_000 });
    const ret1 = returnOnDay(DAY1, { id: "ret-1", saleId: sale1.id, refundAmountUgx: 30_000 });
    const ret2 = returnOnDay(DAY5, { id: "ret-2", saleId: sale2.id, refundAmountUgx: 70_000 });
    const adj1 = { ...sale1, ...reduceSaleTotalsByAmount(sale1, 30_000) };
    const adj2 = { ...sale2, ...reduceSaleTotalsByAmount(sale2, 70_000) };

    const day5Only = bounds(DAY5, DAY5);
    const scoped = receiptsHeroTotals([adj1, adj2], [ret1, ret2], day5Only);
    const legacy = legacyReceiptsHeroTotals([adj1, adj2], [ret1, ret2], day5Only);
    expect(scoped).toEqual(reportsTotals([adj1, adj2], [ret1, ret2], day5Only));
    expect(legacy.profitUgx).not.toBe(scoped.profitUgx);
  });

  it("single-day Reports path matches getCompletedFinancials day filter", () => {
    const sale = saleOnDay(DAY1, { id: "sale-fin", status: "completed", totalUgx: 100_000 });
    const ret = returnOnDay(DAY5, { id: "ret-fin", saleId: sale.id, refundAmountUgx: 100_000 });
    const adjusted = { ...sale, ...reduceSaleTotalsByAmount(sale, 100_000) };
    const range = bounds(DAY5, DAY5);
    const receipts = receiptsHeroTotals([adjusted], [ret], range);
    const reportsDay = getCompletedFinancials([adjusted], [ret], products, { day: DAY5 });
    expect(receipts.profitUgx).toBe(reportsDay.profitUgx);
    expect(receipts.revenueUgx).toBe(reportsDay.revenueUgx);
  });
});
