import type { Product, Sale } from "../types";
import { completedSales } from "./saleStatus";
import { resolveProductStationType } from "./kitchenRouting";
import { dateKeyKampala } from "./datesUg";

export type HospitalityReportRange = {
  fromKey: string;
  toKey: string;
};

export type WaiterPerformanceRow = {
  waiterId: string;
  label: string;
  billCount: number;
  revenueUgx: number;
  avgBillUgx: number;
};

export type CategoryMixRow = {
  kind: "food" | "drink" | "other";
  revenueUgx: number;
  quantity: number;
};

export type TableRevenueRow = {
  label: string;
  billCount: number;
  revenueUgx: number;
};

export type PeakHourRow = {
  hour: number;
  label: string;
  billCount: number;
  revenueUgx: number;
};

export type HospitalityReportSummary = {
  completedBillCount: number;
  totalRevenueUgx: number;
  avgBillUgx: number;
  waiters: WaiterPerformanceRow[];
  categoryMix: CategoryMixRow[];
  tables: TableRevenueRow[];
  peakHours: PeakHourRow[];
};

function inRange(iso: string, range: HospitalityReportRange): boolean {
  const key = dateKeyKampala(new Date(iso));
  return key >= range.fromKey && key <= range.toKey;
}

function waiterLabel(sale: Sale): string {
  if (sale.soldByUserId) return sale.soldByUserId;
  return "Staff";
}

export function computeHospitalityReports(
  sales: Sale[],
  products: Product[],
  range: HospitalityReportRange,
): HospitalityReportSummary {
  const productById = new Map(products.map((p) => [p.id, p]));
  const scoped = completedSales(sales).filter((s) => inRange(s.createdAt, range));

  let totalRevenueUgx = 0;
  const waiterMap = new Map<string, WaiterPerformanceRow>();
  const tableMap = new Map<string, TableRevenueRow>();
  const mix = new Map<CategoryMixRow["kind"], CategoryMixRow>();
  const hourMap = new Map<number, PeakHourRow>();

  for (const sale of scoped) {
    totalRevenueUgx += sale.totalUgx;
    const wKey = sale.soldByUserId ?? "unknown";
    const wRow = waiterMap.get(wKey) ?? {
      waiterId: wKey,
      label: waiterLabel(sale),
      billCount: 0,
      revenueUgx: 0,
      avgBillUgx: 0,
    };
    wRow.billCount += 1;
    wRow.revenueUgx += sale.totalUgx;
    waiterMap.set(wKey, wRow);

    const tLabel = sale.referenceLabel?.trim() || "Takeaway / other";
    const tRow = tableMap.get(tLabel) ?? { label: tLabel, billCount: 0, revenueUgx: 0 };
    tRow.billCount += 1;
    tRow.revenueUgx += sale.totalUgx;
    tableMap.set(tLabel, tRow);

    const hour = new Date(sale.createdAt).getHours();
    const hRow = hourMap.get(hour) ?? {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      billCount: 0,
      revenueUgx: 0,
    };
    hRow.billCount += 1;
    hRow.revenueUgx += sale.totalUgx;
    hourMap.set(hour, hRow);

    for (const line of sale.lines) {
      if (line.voided) continue;
      const product = productById.get(line.productId);
      const station = product ? resolveProductStationType(product) : "kitchen";
      const kind: CategoryMixRow["kind"] = station === "bar" ? "drink" : station === "kitchen" ? "food" : "other";
      const row = mix.get(kind) ?? { kind, revenueUgx: 0, quantity: 0 };
      row.revenueUgx += line.lineTotalUgx;
      row.quantity += line.quantity;
      mix.set(kind, row);
    }
  }

  const waiters = [...waiterMap.values()]
    .map((w) => ({ ...w, avgBillUgx: w.billCount > 0 ? Math.round(w.revenueUgx / w.billCount) : 0 }))
    .sort((a, b) => b.revenueUgx - a.revenueUgx);

  const tables = [...tableMap.values()].sort((a, b) => b.revenueUgx - a.revenueUgx);
  const peakHours = [...hourMap.values()].sort((a, b) => a.hour - b.hour);
  const categoryMix = [...mix.values()].sort((a, b) => b.revenueUgx - a.revenueUgx);

  return {
    completedBillCount: scoped.length,
    totalRevenueUgx,
    avgBillUgx: scoped.length > 0 ? Math.round(totalRevenueUgx / scoped.length) : 0,
    waiters,
    categoryMix,
    tables,
    peakHours,
  };
}
