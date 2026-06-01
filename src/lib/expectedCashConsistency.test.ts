import { describe, expect, it } from "vitest";
import type { CashExpense, DebtPayment, Product, ReturnRecord, Sale } from "../types";
import { getDrawerCashForDayInput, getExpectedCashForDay } from "./cashReconciliation";
import { buildDailyReportText } from "./reportExport";

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
        id: crypto.randomUUID(),
        productId: "prod-1",
        name: "Item",
        quantity: 1,
        unitPriceUgx: partial.totalUgx,
        unitCostUgx: 1_000,
        estimatedProfitUgx: partial.totalUgx - 1_000,
        inputMode: "quantity",
        updatedAt: `${DAY}T10:00:00.000Z`,
        lineTotalUgx: partial.totalUgx,
      },
    ],
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

function drawerInput(sales: Sale[], returns: ReturnRecord[], debtPayments: DebtPayment[], cashExpenses: CashExpense[]) {
  return { sales, returns, products, debtPayments, cashExpenses, day: DAY };
}

/** Mirrors recordDayClose / useDrawerCashForDay inputs (active sales + returns only). */
function expectedCashAsOnCloseDay(
  sales: Sale[],
  returns: ReturnRecord[],
  debtPayments: DebtPayment[],
  cashExpenses: CashExpense[],
): number {
  return getDrawerCashForDayInput(drawerInput(sales, returns, debtPayments, cashExpenses)).expectedDrawerCashUgx;
}

function expectedCashFromExport(
  sales: Sale[],
  returns: ReturnRecord[],
  debtPayments: DebtPayment[],
  cashExpenses: CashExpense[],
): number {
  const text = buildDailyReportText("en", DAY, sales, products, returns, debtPayments, cashExpenses);
  const match = text.match(/Expected cash: UGX ([\d,]+)/);
  if (!match?.[1]) throw new Error("export missing expected cash line");
  return Number(match[1].replace(/,/g, ""));
}

describe("expected cash — surface consistency", () => {
  it("Owner / Close Day / Cash Expenses / export share one formula", () => {
    const completed = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 60_000, debtUgx: 40_000 });
    const returns: ReturnRecord[] = [
      {
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
      },
    ];
    const debtPayments: DebtPayment[] = [
      { id: "p1", customerId: "c1", amountUgx: 25_000, createdAt: `${DAY}T14:00:00.000Z` },
    ];
    const cashExpenses: CashExpense[] = [
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
    ];
    const input = drawerInput([completed], returns, debtPayments, cashExpenses);

    const canonical = getExpectedCashForDay(input);
    const closeDay = expectedCashAsOnCloseDay([completed], returns, debtPayments, cashExpenses);
    const exportValue = expectedCashFromExport([completed], returns, debtPayments, cashExpenses);

    expect(canonical).toBe(70_000);
    expect(closeDay).toBe(canonical);
    expect(exportValue).toBe(canonical);
  });

  it("getExpectedCashForDay matches getDrawerCashForDayInput", () => {
    const completed = sale({ status: "completed", totalUgx: 50_000 });
    const input = drawerInput([completed], [], [], []);
    expect(getExpectedCashForDay(input)).toBe(getDrawerCashForDayInput(input).expectedDrawerCashUgx);
  });
});
