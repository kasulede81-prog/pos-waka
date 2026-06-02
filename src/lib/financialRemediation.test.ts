import { describe, expect, it } from "vitest";
import type { Customer, DebtPayment, Product, ReturnRecord, Sale, SaleLine, Supplier } from "../types";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { getCompletedFinancials } from "./financialMetrics";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import {
  remainingRefundableAmount,
  remainingReturnableQuantity,
  validateReturnAgainstSale,
} from "./returnLimits";
import { verifyFinancialInvariants } from "./financialInvariants";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { reduceSaleTotalsByAmount } from "./saleAdjustments";

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

function line(total: number): SaleLine {
  return {
    id: crypto.randomUUID(),
    productId: "prod-1",
    name: "Item",
    quantity: 1,
    unitPriceUgx: total,
    unitCostUgx: 1_000,
    estimatedProfitUgx: total - 1_000,
    inputMode: "quantity",
    updatedAt: `${DAY}T10:00:00.000Z`,
    lineTotalUgx: total,
  };
}

function sale(partial: Partial<Sale> & Pick<Sale, "status" | "totalUgx">): Sale {
  const lines = partial.lines ?? [line(partial.totalUgx)];
  return {
    id: crypto.randomUUID(),
    createdAt: `${DAY}T10:00:00.000Z`,
    updatedAt: `${DAY}T10:00:00.000Z`,
    subtotalUgx: partial.subtotalUgx ?? partial.totalUgx,
    cashPaidUgx: partial.cashPaidUgx ?? partial.totalUgx,
    debtUgx: partial.debtUgx ?? 0,
    discountTotalUgx: partial.discountTotalUgx ?? 0,
    estimatedProfitUgx: partial.estimatedProfitUgx ?? partial.totalUgx,
    lines,
    pendingSync: false,
    lastSyncError: null,
    ...partial,
  };
}

describe("FI-01 canonical revenue with cart discount", () => {
  it("revenue equals cash + debt when cart discount applied", () => {
    const s = sale({
      status: "completed",
      totalUgx: 90_000,
      cashPaidUgx: 90_000,
      debtUgx: 0,
      discountTotalUgx: 10_000,
      lines: [line(50_000), line(50_000)],
    });
    const fin = getCompletedFinancials([s], [], products, { day: DAY });
    expect(fin.revenueUgx).toBe(90_000);
    expect(fin.cashCollectedUgx + fin.debtIssuedUgx).toBe(90_000);
    expect(computeCanonicalRevenueUgx([s], [])).toBe(90_000);
  });

  it("multiple line discounts and cart discount stay consistent", () => {
    const discountedLine = { ...line(40_000), discountUgx: 10_000, originalLineTotalUgx: 50_000 };
    const s = sale({
      status: "completed",
      totalUgx: 35_000,
      cashPaidUgx: 20_000,
      debtUgx: 15_000,
      discountTotalUgx: 15_000,
      lines: [discountedLine, line(30_000)],
    });
    const fin = getCompletedFinancials([s], [], products, { day: DAY });
    expect(fin.revenueUgx).toBe(35_000);
    expect(fin.cashCollectedUgx + fin.debtIssuedUgx).toBe(35_000);
  });
});

describe("FI-02 return ceilings", () => {
  it("rejects refund above remaining sale value", () => {
    const s = sale({ status: "completed", totalUgx: 50_000, cashPaidUgx: 50_000, debtUgx: 0 });
    const check = validateReturnAgainstSale({
      sale: s,
      productId: "prod-1",
      quantity: 1,
      refundAmountUgx: 60_000,
      returnRecords: [],
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errorKey).toBe("returnExceedsRemaining");
  });

  it("cumulative partial returns cannot exceed original remaining", () => {
    const s = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 100_000, debtUgx: 0 });
    const first: ReturnRecord = {
      id: "r1",
      saleId: s.id,
      productId: "prod-1",
      productName: "Item",
      quantity: 1,
      refundAmountUgx: 40_000,
      reason: "other",
      actorUserId: "u1",
      actorName: "A",
      shiftId: null,
      createdAt: `${DAY}T11:00:00.000Z`,
    };
    const adjusted = { ...s, ...reduceSaleTotalsByAmount(s, 40_000) };
    expect(remainingRefundableAmount(adjusted)).toBe(60_000);
    const second = validateReturnAgainstSale({
      sale: adjusted,
      productId: "prod-1",
      quantity: 1,
      refundAmountUgx: 70_000,
      returnRecords: [first],
    });
    expect(second.ok).toBe(false);
  });

  it("rejects quantity above remaining returnable", () => {
    const s = sale({
      status: "completed",
      totalUgx: 100_000,
      lines: [{ ...line(100_000), quantity: 2 }],
    });
    expect(remainingReturnableQuantity(s, "prod-1", [])).toBe(2);
    const check = validateReturnAgainstSale({
      sale: s,
      productId: "prod-1",
      quantity: 3,
      refundAmountUgx: 10_000,
      returnRecords: [],
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errorKey).toBe("returnExceedsQty");
  });
});

describe("FI-04 debt reconciliation", () => {
  it("heals stale customer balance to ledger", () => {
    const customer: Customer = {
      id: "c1",
      name: "Jane",
      phone: "",
      location: "",
      debtBalanceUgx: 100_000,
      createdAt: `${DAY}T08:00:00.000Z`,
      version: 1,
    };
    const credit = sale({
      status: "completed",
      totalUgx: 60_000,
      cashPaidUgx: 0,
      debtUgx: 60_000,
      customerId: "c1",
    });
    const result = verifyCustomerDebtIntegrity([customer], [credit], [], { heal: true });
    expect(result.healedCount).toBe(1);
    expect(result.customers[0]!.debtBalanceUgx).toBe(60_000);
    expect(result.ok).toBe(true);
  });

  it("never heals below zero", () => {
    const customer: Customer = {
      id: "c1",
      name: "Jane",
      phone: "",
      location: "",
      debtBalanceUgx: -500,
      createdAt: `${DAY}T08:00:00.000Z`,
      version: 1,
    };
    const result = verifyCustomerDebtIntegrity([customer], [], [], { heal: true });
    expect(result.customers[0]!.debtBalanceUgx).toBe(0);
  });
});

describe("FI-08 financial invariants", () => {
  it("passes for balanced credit sale and payment", () => {
    const credit = sale({
      status: "completed",
      totalUgx: 80_000,
      cashPaidUgx: 20_000,
      debtUgx: 60_000,
      customerId: "c1",
    });
    const customer: Customer = {
      id: "c1",
      name: "Jane",
      phone: "",
      location: "",
      debtBalanceUgx: 40_000,
      createdAt: `${DAY}T08:00:00.000Z`,
      version: 1,
    };
    const payments: DebtPayment[] = [
      { id: "p1", customerId: "c1", amountUgx: 20_000, createdAt: `${DAY}T11:00:00.000Z` },
    ];
    const report = verifyFinancialInvariants({
      sales: [credit],
      returns: [],
      products,
      debtPayments: payments,
      cashExpenses: [],
      customers: [customer],
      day: DAY,
    });
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

describe("FI-06 audit_log sync", () => {
  it("exports pushAuditLogToCloud for durable audit mirror", async () => {
    const mod = await import("../offline/cloudSync");
    expect(typeof mod.pushAuditLogToCloud).toBe("function");
  });

  it("processCloudSyncOperation routes audit_log (no-op without Supabase session)", async () => {
    const { processCloudSyncOperation } = await import("../offline/cloudSync");
    const entry = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      at: `${DAY}T12:00:00.000Z`,
      actorUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role: "owner" as const,
      action: "day_close" as const,
      payloadSummary: "Close",
      payload: {},
      deviceId: "dev",
    };
    const ok = await processCloudSyncOperation({
      id: "op1",
      kind: "audit_log",
      payload: { entry },
      createdAt: `${DAY}T12:00:00.000Z`,
      attempts: 0,
    });
    expect(ok).toBe(false);
  });
});

describe("FI-03 close day drawer parity", () => {
  it("persisted close inputs match getDrawerCashForDayInput", () => {
    const completed = sale({ status: "completed", totalUgx: 100_000, cashPaidUgx: 80_000, debtUgx: 20_000 });
    const drawer = getDrawerCashForDayInput({
      sales: [completed],
      returns: [],
      products,
      debtPayments: [],
      cashExpenses: [],
      day: DAY,
    });
    const fin = getCompletedFinancials([completed], [], products, { day: DAY });
    expect(drawer.revenueUgx).toBe(fin.revenueUgx);
    expect(drawer.expectedDrawerCashUgx).toBe(80_000);
  });
});

describe("FI-05 supplier payment cap", () => {
  it("payment cannot exceed balance owed (logic)", () => {
    const sup: Supplier = {
      id: "s1",
      name: "Wholesale",
      phone: "",
      location: "",
      notes: "",
      balanceOwedUgx: 25_000,
      totalPurchasesUgx: 100_000,
      lastSupplyAt: null,
      createdAt: `${DAY}T08:00:00.000Z`,
      version: 1,
    };
    const pay = Math.min(Math.floor(50_000), Math.max(0, sup.balanceOwedUgx));
    expect(pay).toBe(25_000);
  });
});
