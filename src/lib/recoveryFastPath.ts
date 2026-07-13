/**
 * Phase 24.2A — small-shop fast path thresholds (integrity-safe acceleration only).
 */

import type { CloudRecoveryEntityCounts } from "./cloudRecoverySession";

export const SMALL_SHOP_FAST_PATH = {
  maxProducts: 500,
  maxCustomers: 1_000,
  maxSales: 10_000,
} as const;

export function isSmallShopFastPathEligible(counts: {
  products: number;
  customers: number;
  sales: number;
}): boolean {
  return (
    counts.products <= SMALL_SHOP_FAST_PATH.maxProducts &&
    counts.customers <= SMALL_SHOP_FAST_PATH.maxCustomers &&
    counts.sales <= SMALL_SHOP_FAST_PATH.maxSales
  );
}

export function smallShopFastPathFromCounts(counts: CloudRecoveryEntityCounts): boolean {
  return isSmallShopFastPathEligible({
    products: counts.products,
    customers: counts.customers,
    sales: counts.sales,
  });
}
