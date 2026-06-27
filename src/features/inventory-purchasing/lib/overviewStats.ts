import type { Product, Purchase, Supplier, SupplierPayment } from "../../../types";
import { dateKeyKampala } from "../../../lib/datesUg";
import {
  buildSupplierSummary,
  filterPurchases,
  filterSupplierPayments,
  resolvePurchaseFilterBounds,
  sumSupplierPaymentsUgx,
  type PurchaseListFilter,
} from "../../../lib/purchaseReporting";
import { isPurchaseVoided } from "../../../lib/purchaseCorrections";
import { isLowStock } from "../../../lib/sellingEngine";
import { isWalkInSupplierId } from "../../../lib/walkInSupplier";

export type OverviewStats = {
  totalPurchasedUgx: number;
  totalPaidUgx: number;
  outstandingUgx: number;
  activeSuppliers: number;
  openPurchaseOrders: number;
  lowStockCount: number;
  paidPct: number;
};

export type MonthlyPurchasePoint = {
  monthKey: string;
  label: string;
  totalUgx: number;
};

export type SupplierSpendRow = {
  supplierId: string;
  name: string;
  totalUgx: number;
  pct: number;
};

export function computeOverviewStats(
  purchases: Purchase[],
  supplierPayments: SupplierPayment[],
  suppliers: Supplier[],
  products: Product[],
  filter: PurchaseListFilter,
): OverviewStats {
  const bounds = resolvePurchaseFilterBounds(filter);
  const scoped = filterPurchases(purchases, bounds).filter((p) => !isPurchaseVoided(p));
  const payments = filterSupplierPayments(supplierPayments, bounds);

  let totalPurchasedUgx = 0;
  let totalPaidOnPurchasesUgx = 0;
  let openPurchaseOrders = 0;

  for (const p of scoped) {
    totalPurchasedUgx += p.totalCostUgx;
    totalPaidOnPurchasesUgx += p.amountPaidUgx;
    if (p.balanceDeltaUgx > 0) openPurchaseOrders += 1;
  }

  const standalonePayments = sumSupplierPaymentsUgx(payments);
  const totalPaidUgx = totalPaidOnPurchasesUgx + standalonePayments;
  const supplierSummary = buildSupplierSummary(suppliers);
  const outstandingUgx = supplierSummary.totalDebtUgx;
  const paidPct =
    totalPurchasedUgx > 0 ? Math.min(100, Math.round((totalPaidOnPurchasesUgx / totalPurchasedUgx) * 100)) : 100;

  return {
    totalPurchasedUgx,
    totalPaidUgx,
    outstandingUgx,
    activeSuppliers: supplierSummary.totalSuppliers,
    openPurchaseOrders,
    lowStockCount: products.filter((p) => isLowStock(p)).length,
    paidPct,
  };
}

export function computeMonthlyPurchaseTrend(purchases: Purchase[], months = 6): MonthlyPurchasePoint[] {
  const now = new Date();
  const points: MonthlyPurchasePoint[] = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-UG", { month: "short" });
    let totalUgx = 0;
    for (const p of purchases) {
      if (isPurchaseVoided(p)) continue;
      const pk = dateKeyKampala(p.createdAt).slice(0, 7);
      if (pk === monthKey) totalUgx += p.totalCostUgx;
    }
    points.push({ monthKey, label, totalUgx });
  }
  return points;
}

export function computeTopSupplierSpend(
  purchases: Purchase[],
  suppliers: Supplier[],
  filter: PurchaseListFilter,
  limit = 5,
): SupplierSpendRow[] {
  const bounds = resolvePurchaseFilterBounds(filter);
  const scoped = filterPurchases(purchases, bounds).filter((p) => !isPurchaseVoided(p) && !isWalkInSupplierId(p.supplierId));
  const bySupplier = new Map<string, number>();

  for (const p of scoped) {
    bySupplier.set(p.supplierId, (bySupplier.get(p.supplierId) ?? 0) + p.totalCostUgx);
  }

  const total = [...bySupplier.values()].reduce((s, v) => s + v, 0) || 1;
  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));

  return [...bySupplier.entries()]
    .map(([supplierId, totalUgx]) => ({
      supplierId,
      name: nameById.get(supplierId) ?? pNameFromPurchases(purchases, supplierId),
      totalUgx,
      pct: Math.round((totalUgx / total) * 100),
    }))
    .sort((a, b) => b.totalUgx - a.totalUgx)
    .slice(0, limit);
}

function pNameFromPurchases(purchases: Purchase[], supplierId: string): string {
  return purchases.find((p) => p.supplierId === supplierId)?.supplierName ?? "—";
}

export function formatShortUgx(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `UGX ${Math.round(n / 1_000)}K`;
  return `UGX ${n.toLocaleString()}`;
}

export function purchaseStatusKind(purchase: Purchase): "paid" | "partial" | "unpaid" | "voided" {
  if (isPurchaseVoided(purchase)) return "voided";
  if (purchase.balanceDeltaUgx <= 0) return "paid";
  if (purchase.amountPaidUgx > 0) return "partial";
  return "unpaid";
}
