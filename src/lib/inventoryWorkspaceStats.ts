import type { Product, Purchase, Supplier, SupplierPayment } from "../types";
import { dateKeyKampala } from "./datesUg";
import { purchaseFilterFromDateFilter } from "./purchaseReporting";
import type { DateFilterValue } from "./dateFilters";
import { localGetInventoryInsights } from "./localReporting";
import { computeOverviewStats } from "../features/inventory-purchasing/lib/overviewStats";
import { countExpiryBuckets, medicinesInExpiryBucket } from "./pharmacyExpiry";
import { computeBatchIntegrity } from "./pharmacyBatches";
import { isPharmacyMode } from "./pharmacy";
import type { BusinessType } from "../types";
import { isPurchaseVoided } from "./purchaseCorrections";

const MONTH_FILTER: DateFilterValue = { kind: "preset", preset: "this_month" };

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
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  suppliers: Supplier[];
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
  complianceAlertCount?: number;
  now?: Date;
}): InventoryWorkspaceDashboardStats {
  const insights = localGetInventoryInsights(input.products);
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
    insights.lowStock.length +
    insights.outOfStock.length +
    (overview.outstandingUgx > 0 ? 1 : 0) +
    nearExpiryCount +
    expiredCount +
    batchIntegrityIssues;

  return {
    totalProducts: input.products.length,
    inventoryValueUgx: insights.stockValueAtCostUgx,
    lowStockCount: insights.lowStock.length,
    outOfStockCount: insights.outOfStock.length,
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
