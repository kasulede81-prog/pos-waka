import { describe, expect, it } from "vitest";
import type { ReturnRecord, Sale } from "../types";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { buildCashPositionReport } from "./cashPosition";

const DAY = "2026-06-12";
const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sale(partial: Partial<Sale> & Pick<Sale, "id" | "totalUgx">): Sale {
  return {
    status: "completed",
    lines: [
      {
        productId: PRODUCT_ID,
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 500,
        lineTotalUgx: partial.totalUgx,
        estimatedProfitUgx: partial.totalUgx - 500,
        inputMode: "quantity",
        updatedAt: `${DAY}T10:00:00.000Z`,
      },
    ],
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    estimatedProfitUgx: partial.totalUgx - 500,
    createdAt: partial.createdAt ?? `${DAY}T10:00:00.000Z`,
    updatedAt: partial.createdAt ?? `${DAY}T10:00:00.000Z`,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("cash position — Close Day consistency", () => {
  it("expected cash and revenue match getDrawerCashForDayInput", () => {
    const completed = sale({ id: "s1", totalUgx: 100_000, cashPaidUgx: 60_000, debtUgx: 40_000 });
    const returns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: completed.id,
        productId: PRODUCT_ID,
        productName: "Item",
        quantity: 1,
        refundAmountUgx: 5_000,
        reason: "other",
        actorUserId: "u1",
        actorName: "Owner",
        shiftId: null,
        createdAt: `${DAY}T12:00:00.000Z`,
      },
    ];
    const drawer = getDrawerCashForDayInput({
      sales: [completed],
      returns,
      products: [
        {
          id: PRODUCT_ID,
          name: "Item",
          sellingPricePerUnitUgx: 1_000,
          costPricePerUnitUgx: 500,
          stockOnHand: 10,
          baseUnit: "pcs",
          sellingMode: "unit",
          category: "General",
          sku: "",
          minimumStockAlert: 1,
          updatedAt: `${DAY}T08:00:00.000Z`,
          version: 1,
        },
      ],
      debtPayments: [{ id: "p1", customerId: "c1", amountUgx: 25_000, createdAt: `${DAY}T14:00:00.000Z` }],
      cashExpenses: [
        {
          id: "e1",
          amountUgx: 10_000,
          category: "Lunch",
          description: "",
          paidOn: DAY,
          createdAt: `${DAY}T11:00:00.000Z`,
          createdByUserId: "u1",
          pendingSync: false,
          deletedAt: null,
        },
      ],
      supplierPayments: [],
      day: DAY,
    });

    const report = buildCashPositionReport({
      lang: "en",
      dayKey: DAY,
      shopName: "Shop",
      sales: [completed],
      products: [
        {
          id: PRODUCT_ID,
          name: "Item",
          sellingPricePerUnitUgx: 1_000,
          costPricePerUnitUgx: 500,
          stockOnHand: 10,
          baseUnit: "pcs",
          sellingMode: "unit",
          category: "General",
          sku: "",
          minimumStockAlert: 1,
          updatedAt: `${DAY}T08:00:00.000Z`,
          version: 1,
        },
      ],
      returnRecords: returns,
      debtPayments: [{ id: "p1", customerId: "c1", amountUgx: 25_000, createdAt: `${DAY}T14:00:00.000Z` }],
      cashExpenses: [
        {
          id: "e1",
          amountUgx: 10_000,
          category: "Lunch",
          description: "",
          paidOn: DAY,
          createdAt: `${DAY}T11:00:00.000Z`,
          createdByUserId: "u1",
          pendingSync: false,
          deletedAt: null,
        },
      ],
      supplierPayments: [],
      staffAccounts: [],
      generalCategoryLabel: "General",
    });

    expect(report.summary.totalSalesUgx).toBe(drawer.revenueUgx);
    expect(report.cashPosition.cashSalesUgx).toBe(drawer.cashFromSalesUgx);
    expect(report.cashPosition.debtCollectedUgx).toBe(drawer.debtCollectedUgx);
    expect(report.cashPosition.refundsUgx).toBe(drawer.refundsUgx);
    expect(report.cashPosition.expensesUgx).toBe(drawer.expenseUgx);
    expect(report.cashPosition.supplierPaymentsUgx).toBe(drawer.supplierPaymentsUgx);
    expect(report.cashPosition.expectedCashUgx).toBe(drawer.expectedDrawerCashUgx);
  });
});
