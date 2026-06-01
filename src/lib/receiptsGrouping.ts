import type { Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedRevenue } from "./financialMetrics";
import type { Product, ReturnRecord } from "../types";
import { isCompletedSale, isPendingSale, saleStatusOf } from "./saleStatus";

export type ReceiptsPartition = {
  completed: Sale[];
  pending: Sale[];
  cancelled: Sale[];
};

export function partitionReceiptsSales(sales: Sale[]): ReceiptsPartition {
  const completed: Sale[] = [];
  const pending: Sale[] = [];
  const cancelled: Sale[] = [];
  for (const s of sales) {
    const status = saleStatusOf(s);
    if (status === "completed") completed.push(s);
    else if (status === "pending") pending.push(s);
    else cancelled.push(s);
  }
  return { completed, pending, cancelled };
}

export type ReceiptDayGroup = {
  dateKey: string;
  sales: Sale[];
  /** Completed-sale revenue only (matches dashboards). */
  dayRevenueUgx: number;
};

export function groupCompletedSalesByKampalaDay(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
): ReceiptDayGroup[] {
  const completed = sales.filter(isCompletedSale);
  const map = new Map<string, Sale[]>();
  for (const sale of completed) {
    const key = dateKeyKampala(sale.createdAt);
    const arr = map.get(key);
    if (arr) arr.push(sale);
    else map.set(key, [sale]);
  }
  const keys = [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return keys.map((dateKey) => {
    const daySales = map.get(dateKey) ?? [];
    return {
      dateKey,
      sales: daySales,
      dayRevenueUgx: getCompletedRevenue(daySales, returns, products, dateKey),
    };
  });
}

export function groupPendingSalesByKampalaDay(sales: Sale[]): { dateKey: string; sales: Sale[] }[] {
  const pending = sales.filter(isPendingSale);
  const map = new Map<string, Sale[]>();
  for (const sale of pending) {
    const key = dateKeyKampala(sale.createdAt);
    const arr = map.get(key);
    if (arr) arr.push(sale);
    else map.set(key, [sale]);
  }
  const keys = [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return keys.map((dateKey) => ({ dateKey, sales: map.get(dateKey) ?? [] }));
}
