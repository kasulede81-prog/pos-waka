/**
 * Recovery completeness score — measures how fully a device restored from cloud.
 */

import type { CloudShopProbe } from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";

export type RecoveryCompletenessCategory = {
  id: string;
  labelKey: string;
  restored: boolean;
  localCount: number;
  scorePct: number;
};

export type RecoveryCompletenessReport = {
  scorePct: number;
  categories: RecoveryCompletenessCategory[];
  salesPullComplete: boolean;
  stockMovementsCloudAuthoritative: boolean;
};

export type RecoveryCompletenessInput = {
  validation: CloudRecoveryValidationResult;
  probe: CloudShopProbe;
  stockMovements: number;
  inventoryCountSessions: number;
  archivedSales: number;
  salesPullTruncated?: boolean;
};

function categoryScore(restored: boolean, localCount: number, expectedMin = 0): number {
  if (restored) return 100;
  if (localCount > 0 && expectedMin === 0) return 50;
  return 0;
}

export function buildRecoveryCompletenessReport(input: RecoveryCompletenessInput): RecoveryCompletenessReport {
  const c = input.validation.counts;
  const probe = input.probe;
  const cloudExpected = probe.hasCloudProducts || probe.hasSnapshot;

  const productsRestored = !cloudExpected || c.products > 0;
  const salesRestored = !cloudExpected || c.sales > 0 || !probe.hasCloudProducts;
  const customersRestored = !cloudExpected || c.customers >= 0;
  const inventoryRestored =
    !cloudExpected || c.products > 0 || input.stockMovements > 0 || input.inventoryCountSessions > 0;
  const operationalRestored =
    !cloudExpected ||
    c.shifts >= 0 ||
    c.dayCloses >= 0 ||
    c.purchases >= 0;
  const historicalRestored = input.archivedSales > 0 || !cloudExpected;

  const categories: RecoveryCompletenessCategory[] = [
    {
      id: "products",
      labelKey: "recoveryCompletenessProducts",
      restored: productsRestored,
      localCount: c.products,
      scorePct: categoryScore(productsRestored, c.products),
    },
    {
      id: "sales",
      labelKey: "recoveryCompletenessSales",
      restored: salesRestored && !input.salesPullTruncated,
      localCount: c.sales,
      scorePct: input.salesPullTruncated ? 40 : categoryScore(salesRestored, c.sales),
    },
    {
      id: "customers",
      labelKey: "recoveryCompletenessCustomers",
      restored: customersRestored,
      localCount: c.customers,
      scorePct: categoryScore(customersRestored, c.customers),
    },
    {
      id: "inventory",
      labelKey: "recoveryCompletenessInventory",
      restored: inventoryRestored,
      localCount: c.products + input.stockMovements,
      scorePct: categoryScore(inventoryRestored, c.products + input.stockMovements),
    },
    {
      id: "operational",
      labelKey: "recoveryCompletenessOperational",
      restored: operationalRestored,
      localCount: c.shifts + c.dayCloses + c.purchases,
      scorePct: categoryScore(operationalRestored, c.shifts + c.dayCloses),
    },
    {
      id: "historical",
      labelKey: "recoveryCompletenessHistorical",
      restored: historicalRestored,
      localCount: input.archivedSales,
      scorePct: input.archivedSales > 0 ? 100 : cloudExpected ? 60 : 100,
    },
  ];

  const weights = [20, 25, 10, 20, 15, 10];
  let earned = 0;
  let max = 0;
  for (let i = 0; i < categories.length; i++) {
    const w = weights[i] ?? 10;
    max += w;
    earned += (categories[i]!.scorePct / 100) * w;
  }

  if (input.validation.ok) earned = Math.min(max, earned + 5);

  const scorePct = max > 0 ? Math.round((earned / max) * 100) : 0;

  return {
    scorePct,
    categories,
    salesPullComplete: !input.salesPullTruncated,
    stockMovementsCloudAuthoritative: input.stockMovements >= 0,
  };
}
