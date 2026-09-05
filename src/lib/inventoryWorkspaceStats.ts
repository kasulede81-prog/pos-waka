import type { Product, Purchase, Supplier, SupplierPayment } from "../types";
import { dateKeyKampala } from "./datesUg";
import { purchaseFilterFromDateFilter } from "./purchaseReporting";
import type { DateFilterValue } from "./dateFilters";
import { computeOverviewStats } from "../features/inventory-purchasing/lib/overviewStats";
import { countExpiryBuckets, medicinesInExpiryBucket } from "./pharmacyExpiry";
import { computeBatchIntegrity } from "./pharmacyBatches";
import { isPharmacyMode } from "./pharmacy";
import type { BusinessType } from "../types";
import { isPurchaseVoided } from "./purchaseCorrections";
import { isLowStock } from "./sellingEngine";
import { inventoryValueAtCostUgx } from "./costPrecision";

const MONTH_FILTER: DateFilterValue = { kind: "preset", preset: "this_month" };

/** Existing selling-engine + on-hand authorities — full counts, no preview-list cap. */
export type InventoryStockStatusCounts = {
  lowStockCount: number;
  outOfStockCount: number;
  /** Unique `isLowStock || stockOnHand <= 0` (same predicate as restock recommendations, uncapped). */
  restockAttentionCount: number;
};

export function countInventoryStockStatus(products: readonly Product[]): InventoryStockStatusCounts {
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let restockAttentionCount = 0;
  for (const p of products) {
    const low = isLowStock(p);
    const out = p.stockOnHand <= 0;
    if (low) lowStockCount += 1;
    if (out) outOfStockCount += 1;
    if (low || out) restockAttentionCount += 1;
  }
  return { lowStockCount, outOfStockCount, restockAttentionCount };
}

export type InventoryWorkspaceDashboardStats = {
  totalProducts: number;
  inventoryValueUgx: number;
  lowStockCount: number;
  outOfStockCount: number;
  pendingPurchases: number;
  todayPurchasesUgx: number;
  todayPurchaseCount: number;
  activeSuppliers: number;
  inventoryAlerts: number;
  nearExpiryCount: number;
  expiredCount: number;
  batchIntegrityIssues: number;
  controlledAlerts: number;
};

export function computeInventoryWorkspaceDashboardStats(input: {
  products: Product[];
  /** Plan-unlocked catalog for product KPIs — defaults to `products`. */
  catalogProducts?: Product[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  suppliers: Supplier[];
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
  complianceAlertCount?: number;
  now?: Date;
}): InventoryWorkspaceDashboardStats {
  const catalog = input.catalogProducts ?? input.products;
  const stockStatus = countInventoryStockStatus(catalog);
  const overview = computeOverviewStats(
    input.purchases,
    input.supplierPayments,
    input.suppliers,
    input.products,
    purchaseFilterFromDateFilter(MONTH_FILTER),
  );

  const todayKey = dateKeyKampala(input.now ?? new Date());
  let todayPurchasesUgx = 0;
  let todayPurchaseCount = 0;
  for (const p of input.purchases) {
    if (isPurchaseVoided(p)) continue;
    if (dateKeyKampala(p.createdAt) !== todayKey) continue;
    todayPurchaseCount += 1;
    todayPurchasesUgx += p.lines.reduce(
      (sum, ln) => sum + Math.round(ln.qtyBuyingUnits * ln.costPerBuyingUnitUgx),
      0,
    );
  }

  const pharmacy = isPharmacyMode(input.businessType, input.pharmacyModeEnabled);
  const inStock = input.products.filter((p) => p.stockOnHand > 0);
  let nearExpiryCount = 0;
  let expiredCount = 0;
  let batchIntegrityIssues = 0;

  if (pharmacy) {
    const buckets = countExpiryBuckets(inStock, input.now);
    nearExpiryCount = buckets.d30 + buckets.d60 + buckets.d90;
    expiredCount = medicinesInExpiryBucket(inStock, "expired", input.now).length;
    for (const p of input.products) {
      const integrity = computeBatchIntegrity(p);
      if (!integrity.ok && integrity.batchTracked && integrity.batches.length > 0) {
        batchIntegrityIssues += 1;
      }
    }
  }

  const inventoryAlerts =
    stockStatus.restockAttentionCount +
    (overview.outstandingUgx > 0 ? 1 : 0) +
    nearExpiryCount +
    expiredCount +
    batchIntegrityIssues;

  return {
    totalProducts: catalog.length,
    inventoryValueUgx: inventoryValueAtCostUgx(catalog),
    lowStockCount: stockStatus.lowStockCount,
    outOfStockCount: stockStatus.outOfStockCount,
    pendingPurchases: overview.openPurchaseOrders,
    todayPurchasesUgx,
    todayPurchaseCount,
    activeSuppliers: overview.activeSuppliers,
    inventoryAlerts,
    nearExpiryCount,
    expiredCount,
    batchIntegrityIssues,
    controlledAlerts: input.complianceAlertCount ?? 0,
  };
}
