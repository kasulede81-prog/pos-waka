import type { Product, ReturnRecord, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials, revenueSalesOnDay } from "./financialMetrics";
import { isLowStock } from "./sellingEngine";
import { countExpiryBuckets, medicinesInExpiryBucket, type ExpiryBucket } from "./pharmacyExpiry";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { localGetTopProducts } from "./localReporting";
import { computePharmacyExpiryReport } from "./pharmacyReports";
import { pharmacyInventoryValueAtCostUgx } from "./pharmacyCostIntegrity";

export type PharmacyDashboardStats = {
  lowStockCount: number;
  lowStockMedicines: Product[];
  expiryCounts: ReturnType<typeof countExpiryBuckets>;
  expiringSoon: Product[];
  expiredMedicines: Product[];
  todayDispensingCount: number;
  todayDispensingTotalUgx: number;
  todayProfitUgx: number;
  inventoryValueUgx: number;
  expiringStockValueUgx: number;
  topMedicines: { productId: string; name: string; quantity: number; revenueUgx: number }[];
  inventoryValueAtRiskUgx: number;
  expiredStockValueUgx: number;
};

export function computePharmacyDashboardStats(
  products: Product[],
  sales: Sale[],
  returns: ReturnRecord[],
  todayKey: string = dateKeyKampala(new Date()),
): PharmacyDashboardStats {
  const today = new Date();
  const inStock = products.filter((p) => p.stockOnHand > 0);
  const lowStockMedicines = products.filter((p) => isLowStock(p) && p.stockOnHand > 0);
  const expiryCounts = countExpiryBuckets(inStock, today);
  const expiringSoon = [
    ...medicinesInExpiryBucket(inStock, "d30", today),
    ...medicinesInExpiryBucket(inStock, "d60", today),
    ...medicinesInExpiryBucket(inStock, "d90", today),
  ].slice(0, 8);
  const expiredMedicines = medicinesInExpiryBucket(inStock, "expired", today).slice(0, 8);

  const todaySales = revenueSalesOnDay(sales, todayKey);
  const todayFin = getCompletedFinancials(sales, returns, products, { day: todayKey });
  const todayDispensingTotalUgx = todayFin.revenueUgx;
  const todayProfitUgx = todayFin.profitUgx;

  const top = localGetTopProducts(sales, returns, products, "today", "top", 5);
  const expiryReport = computePharmacyExpiryReport(inStock, today);
  const inventoryValueUgx = pharmacyInventoryValueAtCostUgx(inStock);

  return {
    lowStockCount: lowStockMedicines.length,
    lowStockMedicines: lowStockMedicines.slice(0, 8),
    expiryCounts,
    expiringSoon,
    expiredMedicines,
    todayDispensingCount: todaySales.length,
    todayDispensingTotalUgx,
    todayProfitUgx,
    inventoryValueUgx,
    expiringStockValueUgx: expiryReport.expiringValueUgx,
    topMedicines: top.map((p) => {
      const product = products.find((x) => x.id === p.productId);
      return {
        productId: p.productId,
        name: product ? formatMedicineFullLabel(product) : p.name,
        quantity: p.quantity,
        revenueUgx: p.revenueUgx,
      };
    }),
    inventoryValueAtRiskUgx: expiryReport.expiringValueUgx + expiryReport.expiredValueUgx,
    expiredStockValueUgx: expiryReport.expiredValueUgx,
  };
}

export function expiryBucketLabelKey(bucket: ExpiryBucket): string {
  switch (bucket) {
    case "d90":
      return "pharmacyExpiry90";
    case "d60":
      return "pharmacyExpiry60";
    case "d30":
      return "pharmacyExpiry30";
    case "expired":
      return "pharmacyExpiryExpired";
    default:
      return "pharmacyExpiryNone";
  }
}
