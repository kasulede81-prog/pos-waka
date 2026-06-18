import { describe, expect, it } from "vitest";
import type { CashDrawerAdjustment, CashExpense, DebtPayment, Product, ReturnRecord, Sale, ShiftRecord, SupplierPayment } from "../types";
import {
  computeExpectedDrawerCashV2,
  resolveOpeningFloatUgx,
  sumAdjustmentInflowsExcludingOpening,
  sumAdjustmentOutflows,
} from "./cashDrawerLedger";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { cashReduceFromRefund } from "./cashDrawerSales";
import { shiftExpectedCash } from "./saleAdjustments";

const DAY = "2026-06-11";

const products: Product[] = [
  {
    id: "p1",
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

function sale(partial: Partial<Sale> & Pick<Sale, "totalUgx">): Sale {
  return {
    id: crypto.randomUUID(),
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    paymentMethod: partial.paymentMethod ?? "cash",
    estimatedProfitUgx: partial.totalUgx - 1_000,
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "p1",
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
    status: "completed",
    ...partial,
  };
}

function adjustment(type: CashDrawerAdjustment["type"], amountUgx: number): CashDrawerAdjustment {
  const now = `${DAY}T08:00:00.000Z`;
  return {
    id: crypto.randomUUID(),
    type,
    amountUgx,
    note: "",
    actorUserId: "owner",
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    pendingSync: false,
  };
}

describe("computeExpectedDrawerCashV2 acceptance scenario", () => {
  it("matches 280,000 UGX for full retail day", () => {
    const expected = computeExpectedDrawerCashV2({
      openingFloatUgx: 50_000,
      cashSalesUgx: 500_000,
      cashDebtCollectionsUgx: 50_000,
      adjustmentInflowsUgx: 100_000,
      adjustmentOutflowsUgx: 300_000,
      cashExpensesUgx: 20_000,
      cashSupplierPaymentsUgx: 80_000,
      cashRefundsUgx: 20_000,
    });
    expect(expected).toBe(280_000);
  });
});

describe("getDrawerCashForDayInput integration", () => {
  it("uses physical cash sales only (excludes mobile money)", () => {
    const sales = [
      sale({ totalUgx: 100_000, paymentMethod: "cash" }),
      sale({ totalUgx: 200_000, paymentMethod: "mobile_money", cashPaidUgx: 200_000 }),
    ];
    const drawer = getDrawerCashForDayInput({
      sales,
      returns: [],
      products,
      debtPayments: [],
      cashExpenses: [],
      supplierPayments: [],
      cashDrawerAdjustments: [],
      shifts: [],
      day: DAY,
    });
    expect(drawer.cashSalesUgx).toBe(100_000);
    expect(drawer.mobileMoneySalesUgx).toBe(200_000);
  });

  it("includes opening float and adjustments", () => {
    const adjustments = [
      adjustment("opening_float", 50_000),
      adjustment("owner_injection", 100_000),
      adjustment("bank_deposit", 300_000),
    ];
    const sales = [sale({ totalUgx: 500_000 })];
    const debtPayments: DebtPayment[] = [
      { id: "dp1", customerId: "c1", amountUgx: 50_000, createdAt: `${DAY}T11:00:00.000Z` },
    ];
    const cashExpenses: CashExpense[] = [
      {
        id: "e1",
        category: "transport",
        amountUgx: 20_000,
        description: "",
        paidOn: DAY,
        createdAt: `${DAY}T12:00:00.000Z`,
        createdByUserId: "owner",
        pendingSync: false,
      },
    ];
    const supplierPayments: SupplierPayment[] = [
      {
        id: "sp1",
        supplierId: "s1",
        amountUgx: 80_000,
        createdAt: `${DAY}T13:00:00.000Z`,
        pendingSync: false,
      },
    ];
    const returns: ReturnRecord[] = [
      {
        id: "r1",
        saleId: null,
        productId: "p1",
        productName: "Item",
        quantity: 1,
        refundAmountUgx: 20_000,
        reason: "other",
        actorUserId: "owner",
        createdAt: `${DAY}T14:00:00.000Z`,
      },
    ];
    const drawer = getDrawerCashForDayInput({
      sales,
      returns,
      products,
      debtPayments,
      cashExpenses,
      supplierPayments,
      cashDrawerAdjustments: adjustments,
      shifts: [],
      day: DAY,
    });
    expect(drawer.openingFloatUgx).toBe(50_000);
    expect(drawer.adjustmentInflowsUgx).toBe(100_000);
    expect(drawer.adjustmentOutflowsUgx).toBe(300_000);
    expect(drawer.expectedDrawerCashUgx).toBe(280_000);
  });
});

describe("shift refund cashReduce", () => {
  it("credit-heavy return reduces shift cash by cash portion only", () => {
    const creditSale = sale({ totalUgx: 10_000, cashPaidUgx: 0, debtUgx: 10_000 });
    expect(cashReduceFromRefund(creditSale, 5_000)).toBe(0);
    const mixed = sale({ totalUgx: 10_000, cashPaidUgx: 3_000, debtUgx: 7_000 });
    expect(cashReduceFromRefund(mixed, 5_000)).toBe(3_000);
  });

  it("shift expected includes opening float", () => {
    const sh: ShiftRecord = {
      id: "sh1",
      actorUserId: "u1",
      role: "cashier",
      startAt: `${DAY}T08:00:00.000Z`,
      salesTotalUgx: 100_000,
      debtTotalUgx: 0,
      refundsUgx: 0,
      estimatedCashUgx: 50_000,
      openingFloatUgx: 50_000,
      debtPaymentsTotalUgx: 10_000,
    };
    expect(shiftExpectedCash(sh)).toBe(110_000);
  });
});

describe("adjustment type signed amounts", () => {
  it("owner withdrawal reduces net drawer impact", () => {
    const net =
      computeExpectedDrawerCashV2({
        openingFloatUgx: 0,
        cashSalesUgx: 0,
        cashDebtCollectionsUgx: 0,
        adjustmentInflowsUgx: 100_000,
        adjustmentOutflowsUgx: 40_000,
        cashExpensesUgx: 0,
        cashSupplierPaymentsUgx: 0,
        cashRefundsUgx: 0,
      });
    expect(net).toBe(60_000);
  });

  it("each outflow type counts in sumAdjustmentOutflows", () => {
    const types: CashDrawerAdjustment["type"][] = [
      "owner_withdrawal",
      "bank_deposit",
      "safe_transfer_out",
      "cash_removed",
    ];
    const adjustments = types.map((type, i) => adjustment(type, (i + 1) * 10_000));
    expect(sumAdjustmentOutflows(adjustments, DAY)).toBe(100_000);
  });
});

describe("opening float resolution", () => {
  it("sums opening_float adjustments and shift floats", () => {
    const adjustments = [adjustment("opening_float", 30_000)];
    const shifts: ShiftRecord[] = [
      {
        id: "sh1",
        actorUserId: "u1",
        role: "cashier",
        startAt: `${DAY}T08:00:00.000Z`,
        salesTotalUgx: 0,
        debtTotalUgx: 0,
        refundsUgx: 0,
        estimatedCashUgx: 0,
        openingFloatUgx: 20_000,
      },
    ];
    expect(resolveOpeningFloatUgx(DAY, adjustments, shifts)).toBe(50_000);
    expect(sumAdjustmentInflowsExcludingOpening(adjustments, DAY)).toBe(0);
    expect(sumAdjustmentOutflows([adjustment("bank_deposit", 300_000)], DAY)).toBe(300_000);
  });
});
