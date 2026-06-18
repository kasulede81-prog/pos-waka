import { describe, expect, it } from "vitest";
import { buildDayCloseSnapshot } from "./dayCloseDocument";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import type { CashDrawerAdjustment, CashExpense, DebtPayment, Product, ReturnRecord, Sale, SupplierPayment } from "../types";

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

describe("day close snapshot integrity", () => {
  it("snapshot expected cash matches drawer V2 formula", () => {
    const sales: Sale[] = [
      {
        id: "s1",
        createdAt: `${DAY}T10:00:00.000Z`,
        updatedAt: `${DAY}T10:00:00.000Z`,
        subtotalUgx: 500_000,
        cashPaidUgx: 500_000,
        debtUgx: 0,
        paymentMethod: "cash",
        estimatedProfitUgx: 490_000,
        lines: [],
        pendingSync: false,
        lastSyncError: null,
        status: "completed",
        totalUgx: 500_000,
      },
    ];
    const adjustments: CashDrawerAdjustment[] = [
      {
        id: "f1",
        type: "opening_float",
        amountUgx: 50_000,
        note: "",
        actorUserId: "owner",
        occurredAt: `${DAY}T08:00:00.000Z`,
        createdAt: `${DAY}T08:00:00.000Z`,
        updatedAt: `${DAY}T08:00:00.000Z`,
        pendingSync: false,
      },
      {
        id: "i1",
        type: "owner_injection",
        amountUgx: 100_000,
        note: "",
        actorUserId: "owner",
        occurredAt: `${DAY}T08:30:00.000Z`,
        createdAt: `${DAY}T08:30:00.000Z`,
        updatedAt: `${DAY}T08:30:00.000Z`,
        pendingSync: false,
      },
      {
        id: "b1",
        type: "bank_deposit",
        amountUgx: 300_000,
        note: "",
        actorUserId: "owner",
        occurredAt: `${DAY}T09:00:00.000Z`,
        createdAt: `${DAY}T09:00:00.000Z`,
        updatedAt: `${DAY}T09:00:00.000Z`,
        pendingSync: false,
      },
    ];
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
      { id: "sp1", supplierId: "s1", amountUgx: 80_000, createdAt: `${DAY}T13:00:00.000Z`, pendingSync: false },
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
    const snap = buildDayCloseSnapshot({
      closedByUserId: "owner",
      closedByLabel: "Owner",
      row: {
        id: "c1",
        dateKey: DAY,
        expectedCashUgx: drawer.expectedDrawerCashUgx,
        countedCashUgx: drawer.expectedDrawerCashUgx,
        differenceUgx: 0,
        totalSalesUgx: 500_000,
        totalDebtUgx: 0,
        profitEstimateUgx: 100_000,
        openingFloatUgx: drawer.openingFloatUgx,
        createdAt: `${DAY}T18:00:00.000Z`,
      },
      drawer,
      transactionCount: 1,
    });
    expect(drawer.expectedDrawerCashUgx).toBe(280_000);
    expect(snap.expectedCashUgx).toBe(280_000);
    expect(snap.openingFloatUgx).toBe(50_000);
    expect(snap.adjustmentInflowsUgx).toBe(100_000);
    expect(snap.adjustmentOutflowsUgx).toBe(300_000);
    expect(snap.documentVersion).toBe(2);
  });
});
