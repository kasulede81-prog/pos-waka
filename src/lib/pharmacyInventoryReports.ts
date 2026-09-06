import type { Product } from "../types";
import { reportsInventoryCostPresentation } from "../features/business-analytics/lib/analyticsPageView";
import { buildExpiryCenterRows, getProductBatches } from "./pharmacyBatches";
import { pharmacyInventoryValueAtCostUgx } from "./pharmacyCostIntegrity";
import { computePharmacyExpiryReport } from "./pharmacyReports";

export type PharmacyInventoryReportSnapshot = {
  inventoryValueUgx: number;
  expiryLossUgx: number;
  batchCount: number;
  medicineCount: number;
  nearExpiryValueUgx: number;
  expiredValueUgx: number;
  controlledCount: number;
  topMedicines: { productId: string; name: string; stockOnHand: number; valueUgx: number }[];
  slowMovers: { productId: string; name: string; stockOnHand: number; daysSinceLastSale?: number }[];
};

export type PharmacyInventoryCostField = ReturnType<typeof reportsInventoryCostPresentation>;

export type PharmacyInventoryReportsView = {
  inventoryValue: PharmacyInventoryCostField;
  expiryLoss: PharmacyInventoryCostField;
  nearExpiryValue: PharmacyInventoryCostField;
  expiredValue: PharmacyInventoryCostField;
  batchCount: number;
  medicineCount: number;
  controlledCount: number;
  topMedicines: { productId: string; name: string; stockOnHand: number; valueUgx?: number }[];
  slowMovers: { productId: string; name: string; stockOnHand: number; daysSinceLastSale?: number }[];
};

/** Presentation consumer — `reports.profit` via `reportsInventoryCostPresentation`. Does not change formulas. */
export function presentPharmacyInventoryReports(
  snapshot: PharmacyInventoryReportSnapshot,
  canProfit: boolean | null | undefined,
): PharmacyInventoryReportsView {
  const allowed = canProfit === true;
  const inventoryValue = reportsInventoryCostPresentation(allowed, snapshot.inventoryValueUgx);
  const expiryLoss = reportsInventoryCostPresentation(allowed, snapshot.expiryLossUgx);
  const nearExpiryValue = reportsInventoryCostPresentation(allowed, snapshot.nearExpiryValueUgx);
  const expiredValue = reportsInventoryCostPresentation(allowed, snapshot.expiredValueUgx);
  return {
    inventoryValue,
    expiryLoss,
    nearExpiryValue,
    expiredValue,
    batchCount: snapshot.batchCount,
    medicineCount: snapshot.medicineCount,
    controlledCount: snapshot.controlledCount,
    topMedicines: snapshot.topMedicines.map((row) => {
      const cost = reportsInventoryCostPresentation(allowed, row.valueUgx);
      return cost.visible
        ? { productId: row.productId, name: row.name, stockOnHand: row.stockOnHand, valueUgx: cost.valueUgx }
        : { productId: row.productId, name: row.name, stockOnHand: row.stockOnHand };
    }),
    slowMovers: snapshot.slowMovers.map((row) => ({
      productId: row.productId,
      name: row.name,
      stockOnHand: row.stockOnHand,
      ...(row.daysSinceLastSale != null ? { daysSinceLastSale: row.daysSinceLastSale } : {}),
    })),
  };
}

export function computePharmacyInventoryReports(products: Product[]): PharmacyInventoryReportSnapshot {
  const inStock = products.filter((p) => p.stockOnHand > 0);
  const expiry = computePharmacyExpiryReport(inStock);
  let batchCount = 0;
  let controlledCount = 0;
  for (const p of inStock) {
    batchCount += getProductBatches(p).filter((b) => b.quantityRemaining > 0).length;
    if (p.pharmacyMaster?.controlledDrug) controlledCount += 1;
  }
  const valued = inStock
    .map((p) => ({
      productId: p.id,
      name: p.name,
      stockOnHand: p.stockOnHand,
      valueUgx: pharmacyInventoryValueAtCostUgx([p]),
    }))
    .sort((a, b) => b.valueUgx - a.valueUgx);

  return {
    inventoryValueUgx: pharmacyInventoryValueAtCostUgx(inStock),
    expiryLossUgx: expiry.expiredValueUgx,
    batchCount,
    medicineCount: inStock.length,
    nearExpiryValueUgx: expiry.expiringValueUgx,
    expiredValueUgx: expiry.expiredValueUgx,
    controlledCount,
    topMedicines: valued.slice(0, 10),
    slowMovers: valued.slice(-5).reverse(),
  };
}

export function groupExpiryRowsByBucket(products: Product[]) {
  const rows = buildExpiryCenterRows(products);
  const buckets = ["expired", "today", "d7", "d30", "d60", "d90"] as const;
  return Object.fromEntries(
    buckets.map((b) => [b, rows.filter((r) => r.bucket === b)]),
  ) as Record<(typeof buckets)[number], ReturnType<typeof buildExpiryCenterRows>>;
}
