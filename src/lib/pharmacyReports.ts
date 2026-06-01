import type { Product } from "../types";
import { medicinesInExpiryBucket, daysUntilExpiry, type ExpiryBucket } from "./pharmacyExpiry";

export type PharmacyExpiryReportRow = {
  productId: string;
  name: string;
  stockOnHand: number;
  baseUnit: string;
  expiryDate: string;
  daysUntil: number;
  bucket: ExpiryBucket;
  stockValueUgx: number;
};

export type PharmacyExpiryReport = {
  expiring: PharmacyExpiryReportRow[];
  expired: PharmacyExpiryReportRow[];
  expiringValueUgx: number;
  expiredValueUgx: number;
};

function toRow(product: Product, bucket: ExpiryBucket, daysUntil: number): PharmacyExpiryReportRow {
  const expiryDate = product.expiryDate ?? "";
  const stockValueUgx = Math.round(product.stockOnHand * product.costPricePerUnitUgx);
  return {
    productId: product.id,
    name: product.name,
    stockOnHand: product.stockOnHand,
    baseUnit: product.baseUnit,
    expiryDate,
    daysUntil,
    bucket,
    stockValueUgx,
  };
}

export function computePharmacyExpiryReport(products: Product[], today: Date = new Date()): PharmacyExpiryReport {
  const inStock = products.filter((p) => p.stockOnHand > 0 && p.expiryDate);
  const expiringBuckets: ExpiryBucket[] = ["d90", "d60", "d30"];
  const expiring: PharmacyExpiryReportRow[] = [];
  for (const bucket of expiringBuckets) {
    for (const p of medicinesInExpiryBucket(inStock, bucket, today)) {
      const days = daysUntilExpiry(p, today) ?? 0;
      expiring.push(toRow(p, bucket, Math.max(0, days)));
    }
  }
  expiring.sort((a, b) => a.daysUntil - b.daysUntil);

  const expired = medicinesInExpiryBucket(inStock, "expired", today).map((p) =>
    toRow(p, "expired", daysUntilExpiry(p, today) ?? -1),
  );

  return {
    expiring,
    expired,
    expiringValueUgx: expiring.reduce((s, r) => s + r.stockValueUgx, 0),
    expiredValueUgx: expired.reduce((s, r) => s + r.stockValueUgx, 0),
  };
}
