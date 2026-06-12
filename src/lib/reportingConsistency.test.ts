import { describe, expect, it } from "vitest";
import type { Product, ReturnRecord, Sale } from "../types";
import { getDrawerCashForDay, getDrawerCashForDayInput } from "./cashReconciliation";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";
import { buildDailyReportText } from "./reportExport";
import { getCompletedFinancials, getCompletedRevenue } from "./financialMetrics";
import { localGetDailySalesSummary } from "./localReporting";
import { computePharmacyDashboardStats } from "./pharmacyStats";
import { computeProfitGroupedByCategory } from "./homeProfit";
import { isCompletedSale } from "./saleStatus";
import { saleReportingDayKey } from "./datesUg";

const DAY = "2026-05-31";

const products: Product[] = [
  {
    id: "prod-1",
    name: "Item",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 1_000,
    stockOnHand: 50,
    baseUnit: "pcs",
    sellingMode: "unit",
    category: "General",
    sku: "",
    minimumStockAlert: 5,
    updatedAt: `${DAY}T09:00:00.000Z`,
    version: 1,
  },
];

function sale(partial: Partial<Sale> & Pick<Sale, "status" | "totalUgx">): Sale {
  return {
    id: crypto.randomUUID(),
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx - 1_000,
    lines: [
      {
        productId: "prod-1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 1_000,
        estimatedProfitUgx: partial.totalUgx - 1_000,
        inputMode: "quantity",
        lineTotalUgx: partial.totalUgx,
      },
    ],
    pendingSync: false,
    ...partial,
  };
}

describe("reporting consistency — revenue", () => {
  it("returns reduce revenue on all canonical surfaces", () => {
    const completed = sale({ status: "completed", totalUgx: 50_000 });
    const ret: ReturnRecord = {
      id: "r1",
      saleId: completed.id,
      productId: "prod-1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "other",
      actorUserId: "u1",
      actorName: "Owner",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const adjusted = { ...completed, ...reduceSaleTotalsByAmount(completed, 10_000) };
    const sales = [adjusted];
    const returns = [ret];

    const fin = getCompletedFinancials(sales, returns, products, { day: DAY });
    const daily = localGetDailySalesSummary(sales, products, returns, DAY);
    const pharmacy = computePharmacyDashboardStats(products, sales, returns, DAY);
    const exportText = buildDailyReportText("en", DAY, sales, products, returns, [], []);

    expect(fin.revenueUgx).toBe(40_000);
    expect(daily.totalRevenueUgx).toBe(40_000);
    expect(pharmacy.todayDispensingTotalUgx).toBe(40_000);
    expect(exportText).toContain("40,000");
  });
});

describe("reporting consistency — expected cash", () => {
  it("subtracts expenses and refunds from drawer cash", () => {
    const completed = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 60_000, debtUgx: 40_000 });
    const ret: ReturnRecord = {
      id: "r1",
      saleId: completed.id,
      productId: "prod-1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 5_000,
      reason: "other",
      actorUserId: "u1",
      actorName: "Owner",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const adjusted = { ...completed, ...reduceSaleTotalsByAmount(completed, 5_000) };
    const drawerA = getDrawerCashForDay([adjusted], [ret], products, [{ id: "p1", customerId: "c", amountUgx: 25_000, createdAt: `${DAY}T14:00:00.000Z` }], DAY, 10_000);
    const drawerB = getDrawerCashForDayInput({
      sales: [adjusted],
      returns: [ret],
      products,
      debtPayments: [{ id: "p1", customerId: "c", amountUgx: 25_000, createdAt: `${DAY}T14:00:00.000Z` }],
      cashExpenses: [
        {
          id: "e1",
          amountUgx: 10_000,
          category: "Lunch",
          description: "",
          paidOn: DAY,
          createdAt: `${DAY}T11:00:00.000Z`,
          createdByUserId: "u",
          pendingSync: false,
          deletedAt: null,
        },
      ],
      day: DAY,
    });
    expect(drawerA.expectedDrawerCashUgx).toBe(70_000);
    expect(drawerB.expectedDrawerCashUgx).toBe(drawerA.expectedDrawerCashUgx);
  });
});

describe("reporting consistency — profit", () => {
  it("pending sales excluded from profit page path", () => {
    const completed = sale({ status: "completed", totalUgx: 50_000 });
    const pending = sale({ status: "pending", totalUgx: 200_000, cashPaidUgx: 0, debtUgx: 0 });
    const scoped = [completed, pending].filter((s) => {
      if (!isCompletedSale(s)) return false;
      return saleReportingDayKey(s) === DAY;
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const grouped = computeProfitGroupedByCategory(scoped, productById, "General", []);
    const fin = getCompletedFinancials([completed, pending], [], products, { day: DAY });
    expect(grouped.total.profitUgx).toBe(fin.profitUgx);
    expect(fin.revenueUgx).toBe(50_000);
  });

  it("returns reduce profit in completed financials", () => {
    const completed = sale({ status: "completed", totalUgx: 50_000 });
    const ret: ReturnRecord = {
      id: "r1",
      saleId: completed.id,
      productId: "prod-1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 10_000,
      reason: "other",
      actorUserId: "u1",
      actorName: "Owner",
      shiftId: null,
      createdAt: `${DAY}T12:00:00.000Z`,
    };
    const before = getCompletedFinancials([completed], [], products, { day: DAY }).profitUgx;
    const after = getCompletedFinancials([completed], [ret], products, { day: DAY }).profitUgx;
    expect(after).toBeLessThan(before);
  });
});

describe("reporting consistency — export matches fin", () => {
  it("daily export revenue matches getCompletedRevenue", () => {
    const completed = sale({ status: "completed", totalUgx: 33_000 });
    const revenue = getCompletedRevenue([completed], [], products, DAY);
    const fin = getCompletedFinancials([completed], [], products, { day: DAY });
    expect(revenue).toBe(fin.revenueUgx);
    const text = buildDailyReportText("en", DAY, [completed], products, [], [], []);
    expect(text).toContain(fin.revenueUgx.toLocaleString());
  });
});

describe("reporting consistency — timezone day key", () => {
  it("saleReportingDayKey uses Kampala calendar day of createdAt", () => {
    const s = sale({ status: "completed", totalUgx: 1_000, createdAt: "2026-05-31T07:00:00.000Z" });
    expect(saleReportingDayKey(s)).toBe("2026-05-31");
  });
});
