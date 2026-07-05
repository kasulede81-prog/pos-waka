/**
 * X Report — mid-day operational snapshot without closing the business day.
 */

import type {
  CashDrawerAdjustment,
  CashExpense,
  DayDrawerOpen,
  DebtPayment,
  Product,
  ReturnRecord,
  Sale,
  ShiftRecord,
  ShopPreferences,
  SupplierPayment,
  VoidRecord,
} from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials, revenueSalesOnDay } from "./financialMetrics";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { resolveCashDrawerFormulaVersion } from "./dayDrawerOpen";
import { activeSessions } from "./hospitalityStats";
import { pendingSaleTotal } from "./hospitality";

export type XReportPaymentBreakdown = {
  cashUgx: number;
  mobileMoneyUgx: number;
  cardUgx: number;
  creditUgx: number;
  otherUgx: number;
};

export type XReportStaffRow = {
  userId: string;
  label: string;
  salesUgx: number;
  saleCount: number;
};

export type XReportShiftRow = {
  shiftId: string;
  actorName: string;
  startAt: string;
  endAt: string | null;
  salesUgx: number;
  status: "ACTIVE" | "CLOSED";
};

export type XReportHourlyRow = {
  hour: string;
  salesUgx: number;
  transactionCount: number;
};

export type XReportTopProduct = {
  productId: string;
  name: string;
  quantity: number;
  revenueUgx: number;
};

export type XReportSnapshot = {
  reportKind: "x_report";
  generatedAt: string;
  dateKey: string;
  shopName: string;
  totalSalesUgx: number;
  transactionCount: number;
  profitEstimateUgx: number;
  payments: XReportPaymentBreakdown;
  expensesUgx: number;
  discountsUgx: number;
  refundsUgx: number;
  voidsUgx: number;
  taxesUgx: number;
  expectedDrawerCashUgx: number;
  openingFloatUgx: number;
  debtIssuedUgx: number;
  debtCollectedUgx: number;
  shiftRows: XReportShiftRow[];
  staffRows: XReportStaffRow[];
  tableOpenCount: number;
  tablePendingUgx: number;
  hourly: XReportHourlyRow[];
  topProducts: XReportTopProduct[];
};

function paymentBreakdownForDay(sales: Sale[], day: string): XReportPaymentBreakdown {
  const out: XReportPaymentBreakdown = {
    cashUgx: 0,
    mobileMoneyUgx: 0,
    cardUgx: 0,
    creditUgx: 0,
    otherUgx: 0,
  };
  for (const s of revenueSalesOnDay(sales, day)) {
    const method = (s.paymentMethod ?? (s.debtUgx > 0 ? "credit" : "cash")).toLowerCase();
    const total = s.totalUgx;
    if (method.includes("momo") || method.includes("mobile")) out.mobileMoneyUgx += total;
    else if (method.includes("card")) out.cardUgx += total;
    else if (method === "credit" || s.debtUgx > 0) out.creditUgx += total;
    else if (method === "cash") out.cashUgx += s.cashPaidUgx;
    else out.otherUgx += total;
  }
  return out;
}

function staffTotalsForDay(sales: Sale[], day: string): XReportStaffRow[] {
  const map = new Map<string, XReportStaffRow>();
  for (const s of revenueSalesOnDay(sales, day)) {
    const userId = s.soldByUserId ?? "unknown";
    const label = userId;
    const row = map.get(userId) ?? { userId, label, salesUgx: 0, saleCount: 0 };
    row.salesUgx += s.totalUgx;
    row.saleCount += 1;
    map.set(userId, row);
  }
  return [...map.values()].sort((a, b) => b.salesUgx - a.salesUgx);
}

function hourlyForDay(sales: Sale[], day: string): XReportHourlyRow[] {
  const map = new Map<string, XReportHourlyRow>();
  for (const s of revenueSalesOnDay(sales, day)) {
    const hour = new Date(s.createdAt).toLocaleString("en-GB", {
      timeZone: "Africa/Kampala",
      hour: "2-digit",
      hour12: false,
    });
    const row = map.get(hour) ?? { hour, salesUgx: 0, transactionCount: 0 };
    row.salesUgx += s.totalUgx;
    row.transactionCount += 1;
    map.set(hour, row);
  }
  return [...map.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function topProductsForDay(sales: Sale[], day: string): XReportTopProduct[] {
  const map = new Map<string, XReportTopProduct>();
  for (const s of revenueSalesOnDay(sales, day)) {
    for (const line of s.lines) {
      if (line.voided) continue;
      const row = map.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        quantity: 0,
        revenueUgx: 0,
      };
      row.quantity += line.quantity;
      row.revenueUgx += line.lineTotalUgx;
      map.set(line.productId, row);
    }
  }
  return [...map.values()].sort((a, b) => b.revenueUgx - a.revenueUgx).slice(0, 15);
}

export function buildXReportSnapshot(input: {
  dateKey?: string;
  shopName: string;
  sales: Sale[];
  returns: ReturnRecord[];
  products: Product[];
  voidRecords: VoidRecord[];
  cashExpenses: CashExpense[];
  debtPayments: DebtPayment[];
  supplierPayments: SupplierPayment[];
  cashDrawerAdjustments: CashDrawerAdjustment[];
  dayDrawerOpens: DayDrawerOpen[];
  shifts: ShiftRecord[];
  preferences: ShopPreferences;
}): XReportSnapshot {
  const dateKey = input.dateKey ?? dateKeyKampala(new Date());
  const fin = getCompletedFinancials(input.sales, input.returns, input.products, { day: dateKey });
  const drawer = getDrawerCashForDayInput({
    sales: input.sales,
    returns: input.returns,
    products: input.products,
    debtPayments: input.debtPayments,
    cashExpenses: input.cashExpenses,
    supplierPayments: input.supplierPayments,
    cashDrawerAdjustments: input.cashDrawerAdjustments,
    shifts: input.shifts,
    dayDrawerOpens: input.dayDrawerOpens,
    formulaVersion: resolveCashDrawerFormulaVersion(input.preferences),
    day: dateKey,
  });

  const daySales = revenueSalesOnDay(input.sales, dateKey);
  let discountsUgx = 0;
  for (const s of daySales) {
    discountsUgx += s.discountTotalUgx ?? 0;
  }

  const voidsUgx = input.voidRecords
    .filter((v) => dateKeyKampala(v.createdAt) === dateKey)
    .reduce((a, v) => a + v.amountUgx, 0);

  const floor = input.preferences.hospitalityFloor;
  let tableOpenCount = 0;
  let tablePendingUgx = 0;
  if (floor) {
    const active = activeSessions(floor);
    tableOpenCount = active.length;
    for (const session of active) {
      const sale = input.sales.find((s) => s.id === session.saleId);
      tablePendingUgx += pendingSaleTotal(sale);
    }
  }

  const shiftRows: XReportShiftRow[] = input.shifts
    .filter((sh) => dateKeyKampala(sh.startAt) === dateKey)
    .map((sh) => ({
      shiftId: sh.id,
      actorName: sh.actorName?.trim() || sh.actorUserId,
      startAt: sh.startAt,
      endAt: sh.endAt ?? null,
      salesUgx: sh.salesTotalUgx,
      status: sh.endAt ? "CLOSED" : "ACTIVE",
    }));

  return {
    reportKind: "x_report",
    generatedAt: new Date().toISOString(),
    dateKey,
    shopName: input.shopName,
    totalSalesUgx: fin.revenueUgx,
    transactionCount: fin.transactionCount,
    profitEstimateUgx: fin.profitUgx,
    payments: paymentBreakdownForDay(input.sales, dateKey),
    expensesUgx: drawer.expenseUgx,
    discountsUgx,
    refundsUgx: drawer.refundsUgx,
    voidsUgx,
    taxesUgx: 0,
    expectedDrawerCashUgx: drawer.expectedDrawerCashUgx,
    openingFloatUgx: drawer.openingFloatUgx,
    debtIssuedUgx: fin.debtIssuedUgx,
    debtCollectedUgx: drawer.debtCollectedUgx,
    shiftRows,
    staffRows: staffTotalsForDay(input.sales, dateKey),
    tableOpenCount,
    tablePendingUgx,
    hourly: hourlyForDay(input.sales, dateKey),
    topProducts: topProductsForDay(input.sales, dateKey),
  };
}

export function formatXReportCsv(snapshot: XReportSnapshot): string {
  const lines = [
    "X Report",
    `Date,${snapshot.dateKey}`,
    `Generated,${snapshot.generatedAt}`,
    `Total Sales,${snapshot.totalSalesUgx}`,
    `Transactions,${snapshot.transactionCount}`,
    `Expected Cash,${snapshot.expectedDrawerCashUgx}`,
    `Cash Sales,${snapshot.payments.cashUgx}`,
    `MoMo,${snapshot.payments.mobileMoneyUgx}`,
    `Card,${snapshot.payments.cardUgx}`,
    `Credit,${snapshot.payments.creditUgx}`,
    `Expenses,${snapshot.expensesUgx}`,
    `Refunds,${snapshot.refundsUgx}`,
    `Voids,${snapshot.voidsUgx}`,
    `Discounts,${snapshot.discountsUgx}`,
  ];
  return lines.join("\n");
}
