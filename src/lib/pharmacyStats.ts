import type { Product, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { isLowStock } from "./sellingEngine";
import { countExpiryBuckets, medicinesInExpiryBucket, type ExpiryBucket } from "./pharmacyExpiry";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { localGetTopProducts } from "./localReporting";

export type PharmacyDashboardStats = {
  lowStockCount: number;
  lowStockMedicines: Product[];
  expiryCounts: ReturnType<typeof countExpiryBuckets>;
  expiringSoon: Product[];
  expiredMedicines: Product[];
  todayDispensingCount: number;
  todayDispensingTotalUgx: number;
  topMedicines: { productId: string; name: string; quantity: number; revenueUgx: number }[];
};

function isCompletedSale(s: Sale): boolean {
  return s.status !== "pending" && s.status !== "cancelled";
}

export function computePharmacyDashboardStats(
  products: Product[],
  sales: Sale[],
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

  const todaySales = sales.filter((s) => isCompletedSale(s) && dateKeyKampala(s.createdAt) === todayKey);
  const todayDispensingTotalUgx = todaySales.reduce((sum, s) => sum + (s.totalUgx ?? 0), 0);

  const top = localGetTopProducts(sales, [], products, "today", "top", 5);

  return {
    lowStockCount: lowStockMedicines.length,
    lowStockMedicines: lowStockMedicines.slice(0, 8),
    expiryCounts,
    expiringSoon,
    expiredMedicines,
    todayDispensingCount: todaySales.length,
    todayDispensingTotalUgx,
    topMedicines: top.map((p) => {
      const product = products.find((x) => x.id === p.productId);
      return {
        productId: p.productId,
        name: product ? formatMedicineFullLabel(product) : p.name,
        quantity: p.quantity,
        revenueUgx: p.revenueUgx,
      };
    }),
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
