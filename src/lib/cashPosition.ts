/**
 * Cash Position — owner-facing daily money snapshot.
 * Uses canonical financial + drawer helpers; does not alter sales logic.
 */

import type { CashExpense, DebtPayment, Language, Product, ReturnRecord, Sale, StaffAccount, SupplierPayment } from "../types";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import {
  sumCashExpensesOnDay,
  sumDebtPaymentsOnDay,
  sumRefundsOnDay,
  sumSupplierPaymentsOnDay,
} from "./cashReconciliation";
import { dateKeyKampala } from "./datesUg";
import { t } from "./i18n";
import { isCompletedSale } from "./saleStatus";

export type CashPositionPaymentKey = "cash" | "mobile_money" | "card" | "bank_transfer" | "credit";

export type CashPositionPaymentRow = {
  key: CashPositionPaymentKey;
  amountUgx: number;
  percent: number;
  transactionCount: number;
};

export type CashPositionCategoryRow = {
  categoryKey: string;
  categoryLabel: string;
  amountUgx: number;
  percent: number;
};

export type CashPositionCashierKind = "owner" | "staff" | "inactive" | "deleted" | "unknown" | "legacy";

export type CashPositionCashierRow = {
  cashierId: string;
  name: string;
  kind: CashPositionCashierKind;
  salesUgx: number;
  transactionCount: number;
};

export type CashPositionReport = {
  dayKey: string;
  shopName: string;
  generatedAt: string;
  summary: {
    totalSalesUgx: number;
    transactionCount: number;
    itemsSold: number;
  };
  paymentMethods: CashPositionPaymentRow[];
  /** Revenue minus sum of payment rows (negative when cross-day returns reduce revenue). */
  paymentAdjustmentUgx: number;
  cashPosition: {
    cashSalesUgx: number;
    debtCollectedUgx: number;
    refundsUgx: number;
    expensesUgx: number;
    supplierPaymentsUgx: number;
    expectedCashUgx: number;
  };
  categories: CashPositionCategoryRow[];
  cashiers: CashPositionCashierRow[];
};

export type CashPositionReconciliation = {
  physicalCountUgx: number;
  varianceUgx: number;
  varianceKind: CashPositionVariance;
};

const PAYMENT_KEYS: CashPositionPaymentKey[] = [
  "cash",
  "mobile_money",
  "card",
  "bank_transfer",
  "credit",
];

const EMPTY_BUCKETS: Record<CashPositionPaymentKey, number> = {
  cash: 0,
  mobile_money: 0,
  card: 0,
  bank_transfer: 0,
  credit: 0,
};

function uncategorizedKey(): string {
  return "__uncategorized__";
}

/** Distribute an integer total across weights using largest-remainder method. */
export function proportionalAllocateUgx(totalUgx: number, weights: number[]): number[] {
  const total = Math.max(0, Math.floor(totalUgx));
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - floored[i]! }))
    .sort((a, b) => b.frac - a.frac);
  for (let j = 0; j < remainder; j++) {
    floored[order[j % order.length]!.i]! += 1;
  }
  return floored;
}

/** Allocate sale revenue across non-voided lines (handles cart-level discounts). */
export function allocateSaleLineRevenueUgx(sale: Sale): number[] {
  const active = sale.lines.filter((l) => !l.voided);
  const weights = active.map((l) => l.lineTotalUgx);
  return proportionalAllocateUgx(sale.totalUgx, weights);
}

function fillSalePaymentBuckets(sale: Sale, buckets: Record<CashPositionPaymentKey, number>): void {
  buckets.cash = 0;
  buckets.mobile_money = 0;
  buckets.card = 0;
  buckets.bank_transfer = 0;
  buckets.credit = 0;

  const total = Math.max(0, sale.totalUgx);
  const debt = Math.max(0, sale.debtUgx);
  const collected = Math.max(0, total - debt);
  buckets.credit = debt;

  if (collected <= 0) return;

  const pm = sale.paymentMethod ?? (debt > 0 ? "credit" : "cash");
  switch (pm) {
    case "mobile_money":
      buckets.mobile_money = collected;
      break;
    case "atm":
      buckets.card = collected;
      break;
    case "cash":
    case "credit":
    case "mixed":
      buckets.cash = collected;
      break;
    default:
      buckets.cash = collected;
  }
}

/** Attribute one completed sale's revenue across payment buckets (sums to totalUgx). */
export function attributeSalePaymentBuckets(sale: Sale): Record<CashPositionPaymentKey, number> {
  const buckets = { ...EMPTY_BUCKETS };
  fillSalePaymentBuckets(sale, buckets);
  return buckets;
}

type StaffLookup = {
  nameById: Map<string, string>;
  activeById: Map<string, boolean>;
};

function resolveCashierRow(
  lang: Language,
  soldByUserId: string | null | undefined,
  staff: StaffLookup,
): Pick<CashPositionCashierRow, "cashierId" | "name" | "kind"> {
  const uid = soldByUserId ?? "unknown";
  if (uid.startsWith("staff:")) {
    const staffId = uid.slice("staff:".length);
    const name = staff.nameById.get(staffId);
    if (!name) {
      return {
        cashierId: uid,
        name: `${t(lang, "role_cashier")} ${t(lang, "cashPositionStaffFormer")}`,
        kind: "deleted",
      };
    }
    if (staff.activeById.get(staffId) === false) {
      return {
        cashierId: uid,
        name: `${name} ${t(lang, "cashPositionStaffInactive")}`,
        kind: "inactive",
      };
    }
    return { cashierId: uid, name, kind: "staff" };
  }
  if (uid.startsWith("local:") || uid.startsWith("sb:")) {
    return { cashierId: uid, name: t(lang, "role_owner"), kind: "owner" };
  }
  if (uid === "unknown") {
    return { cashierId: uid, name: t(lang, "cashPositionUnknownCashier"), kind: "unknown" };
  }
  const label = uid.length > 12 ? `${uid.slice(0, 10)}…` : uid;
  return { cashierId: uid, name: label, kind: "legacy" };
}

function addLineToCategoryAgg(
  line: { productId: string },
  amount: number,
  categoryMetaByProductId: Map<string, { categoryKey: string; categoryLabel: string }>,
  uncategorizedMeta: { categoryKey: string; categoryLabel: string },
  categoryAgg: Map<string, { label: string; amountUgx: number }>,
): void {
  if (amount <= 0) return;
  const meta = categoryMetaByProductId.get(line.productId) ?? uncategorizedMeta;
  const cur = categoryAgg.get(meta.categoryKey) ?? { label: meta.categoryLabel, amountUgx: 0 };
  categoryAgg.set(meta.categoryKey, {
    label: meta.categoryLabel,
    amountUgx: cur.amountUgx + amount,
  });
}

export function sumPaymentMethodAmounts(rows: CashPositionPaymentRow[]): number {
  return rows.reduce((sum, row) => sum + row.amountUgx, 0);
}

export function sumCategoryAmounts(rows: CashPositionCategoryRow[]): number {
  return rows.reduce((sum, row) => sum + row.amountUgx, 0);
}

export function buildCashPositionReport(params: {
  lang: Language;
  dayKey?: string;
  shopName: string;
  sales: Sale[];
  products: Product[];
  returnRecords: ReturnRecord[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  supplierPayments?: SupplierPayment[];
  staffAccounts: StaffAccount[];
  generalCategoryLabel: string;
}): CashPositionReport {
  const {
    lang,
    shopName,
    sales,
    products,
    returnRecords,
    debtPayments,
    cashExpenses,
    supplierPayments = [],
    staffAccounts,
    generalCategoryLabel,
  } = params;
  const dayKey = params.dayKey ?? dateKeyKampala(new Date());
  const createdAtDayCache = new Map<string, string>();

  const saleDayKey = (createdAt: string): string => {
    let key = createdAtDayCache.get(createdAt);
    if (!key) {
      key = dateKeyKampala(createdAt);
      createdAtDayCache.set(createdAt, key);
    }
    return key;
  };

  const daySales: Sale[] = [];
  for (const sale of sales) {
    if (isCompletedSale(sale) && saleDayKey(sale.createdAt) === dayKey) daySales.push(sale);
  }
  const dayReturns: ReturnRecord[] = [];
  for (const rec of returnRecords) {
    if (saleDayKey(rec.createdAt) === dayKey) dayReturns.push(rec);
  }
  let totalSalesUgx = 0;
  if (dayReturns.length === 0) {
    for (const sale of daySales) totalSalesUgx += Math.max(0, sale.totalUgx);
  } else {
    totalSalesUgx = computeCanonicalRevenueUgx(daySales, dayReturns);
  }
  let cashFromSalesUgx = 0;
  for (const s of daySales) cashFromSalesUgx += s.cashPaidUgx;
  const debtCollectedUgx = sumDebtPaymentsOnDay(debtPayments, dayKey);
  const refundsUgx = sumRefundsOnDay(dayReturns, dayKey);
  const expensesUgx = sumCashExpensesOnDay(cashExpenses, dayKey);
  const supplierPaymentsUgx = sumSupplierPaymentsOnDay(supplierPayments, dayKey);
  const expectedCashUgx = Math.max(
    0,
    cashFromSalesUgx + debtCollectedUgx - expensesUgx - supplierPaymentsUgx - refundsUgx,
  );

  const paymentAgg = new Map<CashPositionPaymentKey, { amountUgx: number; transactionCount: number }>();
  for (const key of PAYMENT_KEYS) {
    paymentAgg.set(key, { amountUgx: 0, transactionCount: 0 });
  }

  const categoryMetaByProductId = new Map<string, { categoryKey: string; categoryLabel: string }>();
  for (const p of products) {
    const catRaw = p.category?.trim() ?? "";
    categoryMetaByProductId.set(p.id, {
      categoryKey: catRaw.length > 0 ? catRaw : uncategorizedKey(),
      categoryLabel: catRaw.length > 0 ? catRaw : generalCategoryLabel,
    });
  }
  const uncategorizedMeta = { categoryKey: uncategorizedKey(), categoryLabel: generalCategoryLabel };
  const categoryAgg = new Map<string, { label: string; amountUgx: number }>();
  const cashierAgg = new Map<string, CashPositionCashierRow>();
  const staffLookup: StaffLookup = {
    nameById: new Map(staffAccounts.map((s) => [s.id, s.name])),
    activeById: new Map(staffAccounts.map((s) => [s.id, s.active])),
  };

  const cashierLabels = new Map<string, Pick<CashPositionCashierRow, "cashierId" | "name" | "kind">>();
  let itemsSold = 0;
  let paymentRowsSum = 0;

  for (const sale of daySales) {
    paymentRowsSum += Math.max(0, sale.totalUgx);

    const lines = sale.lines;
    if (lines.length === 1 && !lines[0]!.voided) {
      const line = lines[0]!;
      itemsSold += line.quantity;
      addLineToCategoryAgg(line, sale.totalUgx, categoryMetaByProductId, uncategorizedMeta, categoryAgg);
    } else {
      let activeCount = 0;
      let onlyLine: (typeof lines)[number] | null = null;
      for (const line of lines) {
        if (line.voided) continue;
        activeCount += 1;
        onlyLine = line;
        itemsSold += line.quantity;
      }
      if (activeCount === 1 && onlyLine) {
        addLineToCategoryAgg(onlyLine, sale.totalUgx, categoryMetaByProductId, uncategorizedMeta, categoryAgg);
      } else if (activeCount > 1) {
        const allocated = allocateSaleLineRevenueUgx(sale);
        let idx = 0;
        for (const line of lines) {
          if (line.voided) continue;
          addLineToCategoryAgg(line, allocated[idx] ?? 0, categoryMetaByProductId, uncategorizedMeta, categoryAgg);
          idx += 1;
        }
      }
    }

    const total = Math.max(0, sale.totalUgx);
    const debt = Math.max(0, sale.debtUgx);
    const collected = Math.max(0, total - debt);
    let saleCounted = false;
    if (debt > 0) {
      const cur = paymentAgg.get("credit")!;
      paymentAgg.set("credit", {
        amountUgx: cur.amountUgx + debt,
        transactionCount: cur.transactionCount + 1,
      });
      saleCounted = true;
    }
    if (collected > 0) {
      const pm = sale.paymentMethod ?? (debt > 0 ? "credit" : "cash");
      const key: CashPositionPaymentKey =
        pm === "mobile_money" ? "mobile_money" : pm === "atm" ? "card" : "cash";
      const cur = paymentAgg.get(key)!;
      paymentAgg.set(key, {
        amountUgx: cur.amountUgx + collected,
        transactionCount: cur.transactionCount + (saleCounted ? 0 : 1),
      });
      saleCounted = true;
    }
    if (!saleCounted) {
      const cur = paymentAgg.get("cash")!;
      paymentAgg.set("cash", { amountUgx: cur.amountUgx, transactionCount: cur.transactionCount + 1 });
    }

    const uid = sale.soldByUserId ?? "unknown";
    let resolved = cashierLabels.get(uid);
    if (!resolved) {
      resolved = resolveCashierRow(lang, sale.soldByUserId, staffLookup);
      cashierLabels.set(uid, resolved);
    }
    const cur = cashierAgg.get(uid);
    if (cur) {
      cur.salesUgx += sale.totalUgx;
      cur.transactionCount += 1;
    } else {
      cashierAgg.set(uid, {
        cashierId: resolved.cashierId,
        name: resolved.name,
        kind: resolved.kind,
        salesUgx: sale.totalUgx,
        transactionCount: 1,
      });
    }
  }

  const paymentMethods: CashPositionPaymentRow[] = PAYMENT_KEYS.map((key) => {
    const row = paymentAgg.get(key)!;
    return {
      key,
      amountUgx: row.amountUgx,
      percent: totalSalesUgx > 0 ? Math.round((row.amountUgx / totalSalesUgx) * 1000) / 10 : 0,
      transactionCount: row.transactionCount,
    };
  }).filter((row) => row.amountUgx > 0 || row.transactionCount > 0);

  const paymentAdjustmentUgx = totalSalesUgx - paymentRowsSum;

  const categories: CashPositionCategoryRow[] = [...categoryAgg.entries()]
    .map(([categoryKey, row]) => ({
      categoryKey,
      categoryLabel: row.label,
      amountUgx: row.amountUgx,
      percent: totalSalesUgx > 0 ? Math.round((row.amountUgx / totalSalesUgx) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amountUgx - a.amountUgx);

  const cashiers = [...cashierAgg.values()].sort((a, b) => b.salesUgx - a.salesUgx);

  return {
    dayKey,
    shopName,
    generatedAt: new Date().toISOString(),
    summary: {
      totalSalesUgx,
      transactionCount: daySales.length,
      itemsSold: Math.round(itemsSold * 10000) / 10000,
    },
    paymentMethods,
    paymentAdjustmentUgx,
    cashPosition: {
      cashSalesUgx: cashFromSalesUgx,
      debtCollectedUgx,
      refundsUgx,
      expensesUgx,
      supplierPaymentsUgx,
      expectedCashUgx,
    },
    categories,
    cashiers,
  };
}

export type CashPositionVariance = "balanced" | "shortage" | "excess";

export function cashPositionVariance(expectedUgx: number, actualUgx: number): {
  varianceUgx: number;
  kind: CashPositionVariance;
} {
  const varianceUgx = actualUgx - expectedUgx;
  if (varianceUgx === 0) return { varianceUgx: 0, kind: "balanced" };
  if (varianceUgx < 0) return { varianceUgx, kind: "shortage" };
  return { varianceUgx, kind: "excess" };
}
