/**
 * Phase SYNC-1.1 — pull reasons and scoped incremental work.
 * Does not change POS business rules; only what a given automatic pull fetches.
 */

export type SyncReason =
  | "startup"
  | "resume"
  | "visibility"
  | "reconnect"
  | "sale_ack"
  | "catalog_change"
  | "realtime"
  | "staff_ack"
  | "staff_realtime"
  | "safety_poll"
  | "recovery"
  | "manual"
  | "full_sync"
  | "foreground";

export type IncrementalPullEntity =
  | "products"
  | "customers"
  | "sales"
  | "cash_expenses"
  | "returns"
  | "purchases"
  | "suppliers"
  | "supplier_payments"
  | "debt_payments"
  | "cash_drawer_adjustments"
  | "day_drawer_opens"
  | "inventory_count_sessions"
  | "shifts"
  | "day_closes"
  | "stock_movements"
  | "catalog";

export const ALL_INCREMENTAL_PULL_ENTITIES: readonly IncrementalPullEntity[] = [
  "products",
  "customers",
  "sales",
  "cash_expenses",
  "returns",
  "purchases",
  "suppliers",
  "supplier_payments",
  "debt_payments",
  "cash_drawer_adjustments",
  "day_drawer_opens",
  "inventory_count_sessions",
  "shifts",
  "day_closes",
  "stock_movements",
  "catalog",
] as const;

/** Sale ACK: sales only. Stock is already applied locally on checkout. */
const SALE_ACK_ENTITIES: readonly IncrementalPullEntity[] = ["sales"];

/** After a catalog push ACK: catalog tree plus product category rows (rename). */
const CATALOG_CHANGE_ENTITIES: readonly IncrementalPullEntity[] = ["catalog", "products"];

export function incrementalEntitiesForReason(reason: string): IncrementalPullEntity[] {
  if (reason === "sale_ack") return [...SALE_ACK_ENTITIES];
  if (reason === "catalog_change") return [...CATALOG_CHANGE_ENTITIES];
  return [...ALL_INCREMENTAL_PULL_ENTITIES];
}

/** Hospitality / staff / device / PIN belong on resume/reconnect/startup, not sale ACK. */
export function shouldRunAncillaryCloudBundle(reason: string): boolean {
  return reason !== "sale_ack" && reason !== "catalog_change";
}

export function isEventPullReason(reason: string): boolean {
  return (
    reason === "realtime" ||
    reason === "sale_ack" ||
    reason === "catalog_change" ||
    reason === "reconnect" ||
    reason === "foreground" ||
    reason === "resume" ||
    reason === "visibility" ||
    reason === "startup" ||
    reason === "staff_ack" ||
    reason === "staff_realtime"
  );
}

/**
 * Sale ACK must not bypass pull rate limits (that was forcing a full bundle after every sale).
 * Startup / resume / reconnect / recovery / realtime may still force.
 */
export function shouldForceCloudPull(reason: string, requestedForce?: boolean): boolean {
  if (reason === "sale_ack" || reason === "catalog_change") return false;
  return requestedForce === true;
}

export function isPullReasonSubset(inner: string, outer: string): boolean {
  if (inner === outer) return true;
  const innerEntities = incrementalEntitiesForReason(inner);
  const outerEntities = incrementalEntitiesForReason(outer);
  if (innerEntities.length > outerEntities.length) return false;
  const outerSet = new Set(outerEntities);
  if (!innerEntities.every((entity) => outerSet.has(entity))) return false;
  if (shouldRunAncillaryCloudBundle(inner) && !shouldRunAncillaryCloudBundle(outer)) return false;
  return true;
}

export function mergeSyncPullReasons(current: string, incoming: string): string {
  if (isPullReasonSubset(current, incoming)) return incoming;
  if (isPullReasonSubset(incoming, current)) return current;
  return incoming;
}

export type IncrementalCheckpointTimes = {
  salesAt?: string;
  productsAt?: string;
  customersAt?: string;
  debtPaymentsAt?: string;
  expensesAt?: string;
  returnsAt?: string;
  purchasesAt?: string;
  suppliersAt?: string;
  supplierPaymentsAt?: string;
  cashDrawerAdjustmentsAt?: string;
  dayDrawerOpensAt?: string;
  inventoryCountSessionsAt?: string;
  shiftsAt?: string;
  dayClosesAt?: string;
  stockMovementsAt?: string;
  catalogAt?: string;
};

/** Only advance cursors for entities that were actually pulled. */
export function incrementalCheckpointPatch(
  pulledEntities: readonly IncrementalPullEntity[],
  checkpoints?: IncrementalCheckpointTimes,
): {
  sales?: boolean;
  products?: boolean;
  customers?: boolean;
  debts?: boolean;
  expenses?: boolean;
  returns?: boolean;
  purchases?: boolean;
  suppliers?: boolean;
  supplierPayments?: boolean;
  cashDrawerAdjustments?: boolean;
  dayDrawerOpens?: boolean;
  inventoryCountSessions?: boolean;
  shifts?: boolean;
  dayCloses?: boolean;
  stockMovements?: boolean;
  catalog?: boolean;
  salesAt?: string;
  productsAt?: string;
  customersAt?: string;
  debtPaymentsAt?: string;
  expensesAt?: string;
  returnsAt?: string;
  purchasesAt?: string;
  suppliersAt?: string;
  supplierPaymentsAt?: string;
  cashDrawerAdjustmentsAt?: string;
  dayDrawerOpensAt?: string;
  inventoryCountSessionsAt?: string;
  shiftsAt?: string;
  dayClosesAt?: string;
  stockMovementsAt?: string;
  catalogAt?: string;
} {
  const pulled = new Set(pulledEntities);
  return {
    sales: pulled.has("sales"),
    products: pulled.has("products"),
    customers: pulled.has("customers"),
    debts: pulled.has("debt_payments"),
    expenses: pulled.has("cash_expenses"),
    returns: pulled.has("returns"),
    purchases: pulled.has("purchases"),
    suppliers: pulled.has("suppliers"),
    supplierPayments: pulled.has("supplier_payments"),
    cashDrawerAdjustments: pulled.has("cash_drawer_adjustments"),
    dayDrawerOpens: pulled.has("day_drawer_opens"),
    inventoryCountSessions: pulled.has("inventory_count_sessions"),
    shifts: pulled.has("shifts"),
    dayCloses: pulled.has("day_closes"),
    stockMovements: pulled.has("stock_movements"),
    catalog: pulled.has("catalog"),
    salesAt: checkpoints?.salesAt,
    productsAt: checkpoints?.productsAt,
    customersAt: checkpoints?.customersAt,
    debtPaymentsAt: checkpoints?.debtPaymentsAt,
    expensesAt: checkpoints?.expensesAt,
    returnsAt: checkpoints?.returnsAt,
    purchasesAt: checkpoints?.purchasesAt,
    suppliersAt: checkpoints?.suppliersAt,
    supplierPaymentsAt: checkpoints?.supplierPaymentsAt,
    cashDrawerAdjustmentsAt: checkpoints?.cashDrawerAdjustmentsAt,
    dayDrawerOpensAt: checkpoints?.dayDrawerOpensAt,
    inventoryCountSessionsAt: checkpoints?.inventoryCountSessionsAt,
    shiftsAt: checkpoints?.shiftsAt,
    dayClosesAt: checkpoints?.dayClosesAt,
    stockMovementsAt: checkpoints?.stockMovementsAt,
    catalogAt: checkpoints?.catalogAt,
  };
}
