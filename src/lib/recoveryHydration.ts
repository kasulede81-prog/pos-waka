/**
 * Live-store hydration checks for gated cloud recovery.
 */

import { usePosStore } from "../store/usePosStore";

export type CoreStoreCounts = {
  products: number;
  sales: number;
  customers: number;
};

export function readCoreStoreCounts(): CoreStoreCounts {
  const s = usePosStore.getState();
  return {
    products: s.products.length,
    sales: s.sales.length,
    customers: s.customers.length,
  };
}

export function storeHasCoreRecoveryData(): boolean {
  const counts = readCoreStoreCounts();
  return counts.products > 0 || counts.sales > 0 || counts.customers > 0;
}

export function verifyRecoveryHydration(): { hydrated: boolean; counts: CoreStoreCounts } {
  const counts = readCoreStoreCounts();
  return {
    hydrated: counts.products > 0 || counts.sales > 0 || counts.customers > 0,
    counts,
  };
}

export const RECOVERY_EMPTY_STORE_ERROR = "RECOVERY_COMPLETED_WITH_EMPTY_STORE";
export const MERGE_PRODUCED_EMPTY_STORE_ERROR = "merge_produced_empty_store";
