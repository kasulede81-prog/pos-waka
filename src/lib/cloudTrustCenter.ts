/**
 * Cloud Trust Center — cloud vs local entity counts and certification parity.
 */

import { usePosStore } from "../store/usePosStore";
import { hasSupabaseConfig, supabase } from "./supabase";
import { readSyncCheckpoints } from "./syncCheckpoints";
import { getCloudRecoverySession } from "./cloudRecoverySession";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { getCompletedFinancials } from "./financialMetrics";
import { verifyInventoryIntegrity, type InventoryIntegrityMismatch } from "./inventoryIntegrity";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { storeHasCoreRecoveryData } from "./recoveryHydration";
import {
  classifyInventoryIntegrityStatus,
  type InventoryIntegrityStatus,
} from "./recoveryInventoryReconciliation";
import { isBlockingRecoveryCertificationFailure } from "./recoveryEntityParity";

export type FullEntityCounts = {
  products: number;
  customers: number;
  sales: number;
  returns: number;
  debtPayments: number;
  expenses: number;
  suppliers: number;
  purchases: number;
  supplierPayments: number;
  cashAdjustments: number;
  dayOpens: number;
  shifts: number;
  dayCloses: number;
  inventoryCounts: number;
  stockMovements: number;
  staff: number;
  auditLogs: number;
};

export type EntityParityRow = {
  id: keyof FullEntityCounts;
  labelKey: string;
  cloudCount: number | null;
  downloadedCount: number | null;
  restoredCount: number;
  localCount: number;
  match: boolean;
  cloudError: string | null;
};

export type FinancialParitySnapshot = {
  revenueUgx: number;
  profitUgx: number;
  inventoryValueUgx: number;
  totalStockQuantity: number;
  totalCustomerDebtUgx: number;
};

export type CloudTrustCertificationReport = {
  checkedAt: string;
  certified: boolean;
  failures: string[];
  rows: EntityParityRow[];
  financial: FinancialParitySnapshot;
  bootstrapComplete: boolean;
  recoveryInvariantPassed: boolean;
  inventoryIntegrityOk: boolean;
  inventoryIntegrityStatus: InventoryIntegrityStatus;
  inventoryMismatches: InventoryIntegrityMismatch[];
  stockMovementCount: number;
};

export const FULL_ENTITY_IDS: (keyof FullEntityCounts)[] = [
  "products",
  "customers",
  "sales",
  "returns",
  "debtPayments",
  "expenses",
  "suppliers",
  "purchases",
  "supplierPayments",
  "cashAdjustments",
  "dayOpens",
  "shifts",
  "dayCloses",
  "inventoryCounts",
  "stockMovements",
  "staff",
  "auditLogs",
];

const ENTITY_LABEL_KEYS: Record<keyof FullEntityCounts, string> = {
  products: "cloudEntityProducts",
  customers: "cloudEntityCustomers",
  sales: "cloudEntitySales",
  returns: "cloudTrustReturns",
  debtPayments: "cloudTrustDebtPayments",
  expenses: "cloudEntityCashExpenses",
  suppliers: "cloudEntitySuppliers",
  purchases: "cloudEntityPurchases",
  supplierPayments: "cloudTrustSupplierPayments",
  cashAdjustments: "cloudEntityCashAdjustments",
  dayOpens: "cloudEntityDayDrawerOpens",
  shifts: "cloudEntityShifts",
  dayCloses: "cloudEntityDayCloses",
  inventoryCounts: "cloudEntityInventoryCounts",
  stockMovements: "cloudEntityStockMovements",
  staff: "cloudEntityStaff",
  auditLogs: "cloudEntityAuditLogs",
};

async function resolveShopId(): Promise<string | null> {
  if (!hasSupabaseConfig || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const { resolvePrimaryOrganizationForUser } = await import("./fetchShopSubscription");
  const org = await resolvePrimaryOrganizationForUser(userId);
  return org?.shopId ?? null;
}

async function countTable(shopId: string, table: string, filter?: Record<string, unknown>): Promise<number> {
  let query = supabase!.from(table).select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      query = query.eq(key, value);
    }
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchCloudEntityCounts(): Promise<{
  counts: FullEntityCounts | null;
  errors: Partial<Record<keyof FullEntityCounts, string>>;
}> {
  const shopId = await resolveShopId();
  if (!shopId || !supabase) {
    return { counts: null, errors: { products: "no_shop_context" } };
  }

  const errors: Partial<Record<keyof FullEntityCounts, string>> = {};
  const safeCount = async (
    key: keyof FullEntityCounts,
    fn: () => Promise<number>,
  ): Promise<number> => {
    try {
      return await fn();
    } catch (err) {
      errors[key] = err instanceof Error ? err.message : "count_failed";
      return 0;
    }
  };

  const counts: FullEntityCounts = {
    products: await safeCount("products", () => countTable(shopId, "products", { is_active: true })),
    customers: await safeCount("customers", () => countTable(shopId, "customers")),
    sales: await safeCount("sales", () => countTable(shopId, "sales", { status: "completed" })),
    returns: await safeCount("returns", () => countTable(shopId, "sale_returns")),
    debtPayments: await safeCount("debtPayments", () => countTable(shopId, "customer_debt_payments")),
    expenses: await safeCount("expenses", () => countTable(shopId, "expenses")),
    suppliers: await safeCount("suppliers", () => countTable(shopId, "shop_suppliers")),
    purchases: await safeCount("purchases", () => countTable(shopId, "shop_purchases")),
    supplierPayments: await safeCount("supplierPayments", () => countTable(shopId, "shop_supplier_payments")),
    cashAdjustments: await safeCount("cashAdjustments", () => countTable(shopId, "shop_cash_drawer_adjustments")),
    dayOpens: await safeCount("dayOpens", () => countTable(shopId, "shop_day_drawer_opens")),
    shifts: await safeCount("shifts", () => countTable(shopId, "shop_shifts")),
    dayCloses: await safeCount("dayCloses", () => countTable(shopId, "shop_day_closes")),
    inventoryCounts: await safeCount("inventoryCounts", () => countTable(shopId, "shop_inventory_count_sessions")),
    stockMovements: await safeCount("stockMovements", () => countTable(shopId, "shop_stock_movements")),
    auditLogs: await safeCount("auditLogs", () => countTable(shopId, "audit_logs")),
    staff: 0,
  };

  try {
    const { data, error } = await supabase.rpc("shop_pos_staff_list", { p_shop_id: shopId });
    if (error) errors.staff = error.message;
    else counts.staff = Array.isArray(data) ? data.length : 0;
  } catch (err) {
    errors.staff = err instanceof Error ? err.message : "staff_count_failed";
  }

  return { counts, errors };
}

export function readLocalEntityCounts(): FullEntityCounts {
  const s = usePosStore.getState();
  const shifts = s.preferences.shifts ?? [];
  return {
    products: s.products.length,
    customers: s.customers.length,
    sales: s.sales.length,
    returns: s.returnRecords.length,
    debtPayments: s.debtPayments.length,
    expenses: s.cashExpenses.length,
    suppliers: s.suppliers.length,
    purchases: s.purchases.length,
    supplierPayments: s.supplierPayments.length,
    cashAdjustments: s.cashDrawerAdjustments.length,
    dayOpens: s.dayDrawerOpens.length,
    shifts: shifts.length,
    dayCloses: s.dayCloses.length,
    inventoryCounts: s.inventoryCountSessions.length,
    stockMovements: s.stockMovements.length,
    staff: (s.preferences.staffAccounts ?? []).length,
    auditLogs: s.auditLogs.length + s.archivedAuditLogs.length,
  };
}

export function readFinancialParitySnapshot(): FinancialParitySnapshot {
  const s = usePosStore.getState();
  const fin = getCompletedFinancials(s.sales, s.returnRecords, s.products);
  let totalStock = 0;
  for (const p of s.products) totalStock += p.stockOnHand ?? 0;
  let totalDebt = 0;
  for (const c of s.customers) totalDebt += c.debtBalanceUgx ?? 0;
  return {
    revenueUgx: fin.revenueUgx,
    profitUgx: fin.profitUgx,
    inventoryValueUgx: inventoryValueAtCostUgx(s.products),
    totalStockQuantity: totalStock,
    totalCustomerDebtUgx: totalDebt,
  };
}

export function buildEntityParityRows(input: {
  cloud: FullEntityCounts | null;
  cloudErrors?: Partial<Record<keyof FullEntityCounts, string>>;
  downloaded?: Partial<FullEntityCounts>;
  restored?: Partial<FullEntityCounts>;
  local: FullEntityCounts;
}): EntityParityRow[] {
  return FULL_ENTITY_IDS.map((id) => {
    const cloudCount = input.cloud ? input.cloud[id] : null;
    const downloadedCount = input.downloaded?.[id] ?? null;
    const restoredCount = input.restored?.[id] ?? input.local[id];
    const localCount = input.local[id];
    const cloudError = input.cloudErrors?.[id] ?? null;
    const match =
      cloudCount !== null &&
      cloudError === null &&
      cloudCount === localCount &&
      (downloadedCount === null || downloadedCount === cloudCount);
    return {
      id,
      labelKey: ENTITY_LABEL_KEYS[id],
      cloudCount,
      downloadedCount,
      restoredCount,
      localCount,
      match,
      cloudError,
    };
  });
}

const NON_BLOCKING_TRUST_WARNINGS = new Set(["inventory_integrity_warning", "stock_movement_count_mismatch"]);

function isNonBlockingTrustRowMismatch(entityId: keyof FullEntityCounts): boolean {
  return NON_BLOCKING_TRUST_WARNINGS.has(`entity_count_mismatch_${entityId}` as never) ||
    !isBlockingRecoveryCertificationFailure(`entity_count_mismatch_${entityId}`);
}

export function buildCloudTrustCertificationReport(input: {
  cloud: FullEntityCounts | null;
  cloudErrors?: Partial<Record<keyof FullEntityCounts, string>>;
  downloaded?: Partial<FullEntityCounts>;
  restored?: Partial<FullEntityCounts>;
  local?: FullEntityCounts;
  requireCloudParity?: boolean;
}): CloudTrustCertificationReport {
  const local = input.local ?? readLocalEntityCounts();
  const rows = buildEntityParityRows({
    cloud: input.cloud,
    cloudErrors: input.cloudErrors,
    downloaded: input.downloaded,
    restored: input.restored,
    local,
  });

  const failures: string[] = [];
  const s = usePosStore.getState();
  const inventory = verifyInventoryIntegrity({ products: s.products, movements: s.stockMovements });
  const inventoryIntegrityStatus = classifyInventoryIntegrityStatus(inventory.mismatches);
  if (inventoryIntegrityStatus === "critical") {
    failures.push("inventory_integrity_mismatch");
  } else if (inventoryIntegrityStatus === "warning") {
    failures.push("inventory_integrity_warning");
  }
  if (s.stockMovements.length > 0 && input.cloud && input.cloud.stockMovements !== s.stockMovements.length) {
    failures.push("stock_movement_count_mismatch");
  }

  const debt = verifyCustomerDebtIntegrity(s.customers, s.sales, s.debtPayments, { heal: false });
  if (!debt.ok) failures.push("debt_integrity_mismatch");

  if (!storeHasCoreRecoveryData() && input.requireCloudParity) {
    failures.push("core_entities_empty");
  }

  if (input.requireCloudParity && input.cloud) {
    for (const row of rows) {
      if (row.cloudError) {
        failures.push(`cloud_count_error_${row.id}`);
      } else if (row.cloudCount !== row.localCount) {
        failures.push(`entity_count_mismatch_${row.id}`);
      }
    }
  }

  const cp = readSyncCheckpoints();
  const session = getCloudRecoverySession();
  const recoveryInvariantPassed =
    session.integrityDiagnostics.recoveryInvariantPassed || storeHasCoreRecoveryData();

  const blockingFailures = failures.filter(isBlockingRecoveryCertificationFailure);

  return {
    checkedAt: new Date().toISOString(),
    certified:
      blockingFailures.length === 0 && rows.every((r) => r.match || r.cloudCount === null || isNonBlockingTrustRowMismatch(r.id)),
    failures,
    rows,
    financial: readFinancialParitySnapshot(),
    bootstrapComplete: cp.bootstrapComplete,
    recoveryInvariantPassed,
    inventoryIntegrityOk: inventory.ok,
    inventoryIntegrityStatus,
    inventoryMismatches: inventory.mismatches,
    stockMovementCount: s.stockMovements.length,
  };
}
