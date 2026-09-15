import type { ReturnRecord, Sale } from "../types";
import { dateKeyKampala, dateKeyDaysAgoKampala, saleReportingDayKey } from "./datesUg";

/** Pre-index recent sales by Kampala day — avoids O(n × days) rescans on owner dashboard. */
export type SalesDayIndex = {
  salesByDay: Map<string, Sale[]>;
  unitsByDayProduct: Map<string, Map<string, number>>;
  revenueByDay: Map<string, number>;
};

const DEFAULT_LOOKBACK_DAYS = 14;

export function buildSalesDayIndex(sales: Sale[], lookbackDays = DEFAULT_LOOKBACK_DAYS): SalesDayIndex {
  const minKey = dateKeyDaysAgoKampala(lookbackDays);
  const salesByDay = new Map<string, Sale[]>();
  const unitsByDayProduct = new Map<string, Map<string, number>>();
  const revenueByDay = new Map<string, number>();

  for (const s of sales) {
    if (s.status === "pending" || s.status === "cancelled") continue;
    const dk = dateKeyKampala(s.createdAt);
    if (dk < minKey) continue;

    let daySales = salesByDay.get(dk);
    if (!daySales) {
      daySales = [];
      salesByDay.set(dk, daySales);
    }
    daySales.push(s);

    revenueByDay.set(dk, (revenueByDay.get(dk) ?? 0) + s.totalUgx);

    let dayUnits = unitsByDayProduct.get(dk);
    if (!dayUnits) {
      dayUnits = new Map();
      unitsByDayProduct.set(dk, dayUnits);
    }
    for (const line of s.lines) {
      if (line.voided) continue;
      dayUnits.set(line.productId, (dayUnits.get(line.productId) ?? 0) + line.quantity);
    }
  }

  return { salesByDay, unitsByDayProduct, revenueByDay };
}

/**
 * One pass over sales for revenue-day index + 14-day dashboard index.
 * Used by owner dashboard to avoid repeated full-store scans.
 */
export function buildCombinedReportingIndex(
  sales: Sale[],
  returns: ReturnRecord[],
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  todayKey = dateKeyKampala(new Date()),
): {
  revenueIndex: import("./financialMetrics").RevenueSalesIndex;
  dayIndex: SalesDayIndex;
  todayAggregates: {
    discountTotal: number;
    debtSaleCount: number;
    refundSaleCount: number;
    productMap: Map<string, { name: string; qty: number; revenue: number }>;
    cashierMap: Map<string, { count: number; revenue: number }>;
  };
} {
  const minKey = dateKeyDaysAgoKampala(lookbackDays);
  const salesByDay = new Map<string, Sale[]>();
  const unitsByDayProduct = new Map<string, Map<string, number>>();
  const revenueByDay = new Map<string, number>();
  const revenueSalesByDay = new Map<string, Sale[]>();
  const returnsByDay = new Map<string, ReturnRecord[]>();
  const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
  const cashierMap = new Map<string, { count: number; revenue: number }>();
  let discountTotal = 0;
  let debtSaleCount = 0;
  let refundSaleCount = 0;

  for (const s of sales) {
    if (s.status !== "pending" && s.status !== "cancelled") {
      const dk = saleReportingDayKey(s);
      const revBucket = revenueSalesByDay.get(dk);
      if (revBucket) revBucket.push(s);
      else revenueSalesByDay.set(dk, [s]);

      if (dk === todayKey) {
        discountTotal += s.discountTotalUgx ?? 0;
        if (s.debtUgx > 0) debtSaleCount += 1;
        if (s.totalUgx < 0) refundSaleCount += 1;
        const uid = s.soldByUserId ?? "unknown";
        const cashier = cashierMap.get(uid) ?? { count: 0, revenue: 0 };
        cashierMap.set(uid, { count: cashier.count + 1, revenue: cashier.revenue + s.totalUgx });
      }

      if (dk >= minKey) {
        let daySales = salesByDay.get(dk);
        if (!daySales) {
          daySales = [];
          salesByDay.set(dk, daySales);
        }
        daySales.push(s);
        revenueByDay.set(dk, (revenueByDay.get(dk) ?? 0) + s.totalUgx);
        let dayUnits = unitsByDayProduct.get(dk);
        if (!dayUnits) {
          dayUnits = new Map();
          unitsByDayProduct.set(dk, dayUnits);
        }
        for (const line of s.lines) {
          if (line.voided) continue;
          dayUnits.set(line.productId, (dayUnits.get(line.productId) ?? 0) + line.quantity);
          if (dk === todayKey) {
            const cur = productMap.get(line.productId) ?? { name: line.name, qty: 0, revenue: 0 };
            productMap.set(line.productId, {
              name: line.name,
              qty: cur.qty + line.quantity,
              revenue: cur.revenue + line.lineTotalUgx,
            });
          }
        }
      }
    }
  }

  for (const r of returns) {
    const dk = dateKeyKampala(r.createdAt);
    const bucket = returnsByDay.get(dk);
    if (bucket) bucket.push(r);
    else returnsByDay.set(dk, [r]);
  }

  return {
    revenueIndex: { salesByDay: revenueSalesByDay, returnsByDay },
    dayIndex: { salesByDay, unitsByDayProduct, revenueByDay },
    todayAggregates: { discountTotal, debtSaleCount, refundSaleCount, productMap, cashierMap },
  };
}

export function sumRevenueForDay(index: SalesDayIndex, dateKey: string): number {
  return index.revenueByDay.get(dateKey) ?? 0;
}

export function unitsForProductOnDay(index: SalesDayIndex, dateKey: string, productId: string): number {
  return index.unitsByDayProduct.get(dateKey)?.get(productId) ?? 0;
}

export function salesForDay(index: SalesDayIndex, dateKey: string): Sale[] {
  return index.salesByDay.get(dateKey) ?? [];
}

export function avgDailyUnitsFromIndex(
  index: SalesDayIndex,
  productId: string,
  excludeKey: string,
  days: number,
): number {
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= days; i++) {
    const dk = dateKeyDaysAgoKampala(i);
    if (dk === excludeKey) continue;
    sum += unitsForProductOnDay(index, dk, productId);
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Sales are stored newest-first. Scan only the head until the day changes — O(today)
 * instead of O(all sales) for receipt numbers and “sold today” badges.
 */
export function scanTodaySalesHead(
  sales: Sale[],
  todayKey = dateKeyKampala(new Date()),
): {
  todaySales: Sale[];
  maxReceiptSeq: number;
  unitsByProduct: Map<string, number>;
  nextReceiptSeq: number;
} {
  const todaySales: Sale[] = [];
  let maxReceiptSeq = 0;
  const unitsByProduct = new Map<string, number>();

  for (const sale of sales) {
    if (sale.status === "pending" || sale.status === "cancelled") continue;
    if (dateKeyKampala(sale.createdAt) !== todayKey) break;
    todaySales.push(sale);
    if (Number.isFinite(sale.receiptSeq)) {
      maxReceiptSeq = Math.max(maxReceiptSeq, Math.floor(sale.receiptSeq ?? 0));
    }
    for (const line of sale.lines) {
      if (line.voided) continue;
      unitsByProduct.set(line.productId, (unitsByProduct.get(line.productId) ?? 0) + line.quantity);
    }
  }

  return { todaySales, maxReceiptSeq, unitsByProduct, nextReceiptSeq: maxReceiptSeq + 1 };
}
