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
import { isCompletedSale } from "./saleStatus";
import { isSaleLineId } from "./pendingSaleMerge";
import { md5Hex } from "./md5";

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

/**
 * Content-aware companion to EntityParityRow's row-count check, scoped to lines that
 * have been financially corrected (financial_revision > 0). A stale snapshot/restore
 * can carry the RIGHT row count but the WRONG cogsUgx on a corrected line — plain entity
 * counts can never catch that; this fingerprint exists specifically to.
 *
 * Deliberately NOT a full-table hash: cost is bounded by the corrected-row count, not
 * total sale volume, since corrections should always be a tiny fraction of a shop's
 * sales. It proves "corrections we already know about survived intact" — it does NOT
 * prove correctness of a line that was never corrected (financial_revision === 0 on
 * both sides looks identical regardless of whether the underlying cogsUgx is right).
 */
export type FinancialFingerprint = {
  correctedLineCount: number;
  revisionSum: number;
  revisionMax: number;
  correctedLinesDigest: string;
};

export type CloudTrustCertificationReport = {
  checkedAt: string;
  certified: boolean;
  failures: string[];
  rows: EntityParityRow[];
  financial: FinancialParitySnapshot;
  financialFingerprint: {
    local: FinancialFingerprint;
    cloud: FinancialFingerprint | null;
    cloudError: string | null;
    match: boolean;
  };
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

/**
 * Local half of the financial fingerprint. Deliberately mirrors the EXACT scope the
 * cloud query uses (shop_get_financial_fingerprint, migration 159: completed sales'
 * sale_line_items only) rather than a naive `sales.flatMap(s => s.lines)`, which would
 * diverge from the cloud side in two confirmed ways:
 *   - archivedSales holds real, cloud-synced completed sales moved out of `sales` purely
 *     for local list-rendering performance — they must be included.
 *   - `sales` can also hold local-only pending/cancelled sales that never reach
 *     sale_line_items server-side at all (shop_push_sale_complete only writes rows for
 *     completed, non-cancelled sales) — they must be excluded, or the local count would
 *     include lines the cloud side can never have.
 * A line with an invalid/missing id (the one confirmed gap — legacy-localStorage
 * imports, see migrateLegacyStore.ts) is skipped rather than crashing or corrupting the
 * digest — such a line was never pushed to sale_line_items either, so the cloud side
 * doesn't have it, and it can never have financial_revision > 0 in the first place since
 * only the correction RPC (which requires a real sale_line_items.id) can set it.
 */
export function readLocalFinancialFingerprint(): FinancialFingerprint {
  const s = usePosStore.getState();
  const completedLines = [...s.sales, ...s.archivedSales]
    .filter(isCompletedSale)
    .flatMap((sale) => sale.lines)
    .filter((line) => isSaleLineId(line.id) && (line.financialRevision ?? 0) > 0);

  const correctedLineCount = completedLines.length;
  const revisionSum = completedLines.reduce((sum, l) => sum + (l.financialRevision ?? 0), 0);
  const revisionMax = completedLines.reduce((max, l) => Math.max(max, l.financialRevision ?? 0), 0);
  const correctedLinesDigest =
    correctedLineCount === 0
      ? ""
      : md5Hex(
          [...completedLines]
            .sort((a, b) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0))
            .map((l) => `${l.id}:${l.financialRevision ?? 0}`)
            .join(","),
        );

  return { correctedLineCount, revisionSum, revisionMax, correctedLinesDigest };
}

export async function fetchCloudFinancialFingerprint(): Promise<{
  fingerprint: FinancialFingerprint | null;
  error: string | null;
}> {
  const shopId = await resolveShopId();
  if (!shopId || !supabase) {
    return { fingerprint: null, error: "no_shop_context" };
  }
  try {
    const { data, error } = await supabase.rpc("shop_get_financial_fingerprint", { p_shop_id: shopId });
    if (error) return { fingerprint: null, error: error.message };
    const row = data as
      | { ok?: boolean; error?: string; correctedLineCount?: number; revisionSum?: number; revisionMax?: number; correctedLinesDigest?: string }
      | null;
    if (!row || row.ok !== true) {
      return { fingerprint: null, error: row?.error ?? "fingerprint_fetch_failed" };
    }
    return {
      fingerprint: {
        correctedLineCount: row.correctedLineCount ?? 0,
        revisionSum: row.revisionSum ?? 0,
        revisionMax: row.revisionMax ?? 0,
        correctedLinesDigest: row.correctedLinesDigest ?? "",
      },
      error: null,
    };
  } catch (err) {
    return { fingerprint: null, error: err instanceof Error ? err.message : "fingerprint_fetch_failed" };
  }
}

function financialFingerprintsMatch(a: FinancialFingerprint, b: FinancialFingerprint): boolean {
  return (
    a.correctedLineCount === b.correctedLineCount &&
    a.revisionSum === b.revisionSum &&
    a.revisionMax === b.revisionMax &&
    a.correctedLinesDigest === b.correctedLinesDigest
  );
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
  /** Pass the result of fetchCloudFinancialFingerprint() to enable the check. */
  cloudFinancialFingerprint?: { fingerprint: FinancialFingerprint | null; error: string | null };
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
  const inventory = verifyInventoryIntegrity({
    products: s.products,
    movements: s.stockMovements,
    archivedMovements: s.archivedStockMovements,
  });
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

  const localFingerprint = readLocalFinancialFingerprint();
  const cloudFingerprintResult = input.cloudFinancialFingerprint;
  const cloudFingerprint = cloudFingerprintResult?.fingerprint ?? null;
  const fingerprintError = cloudFingerprintResult?.error ?? null;
  const fingerprintMatch = cloudFingerprint !== null && financialFingerprintsMatch(localFingerprint, cloudFingerprint);

  if (input.requireCloudParity && cloudFingerprintResult) {
    if (fingerprintError) {
      failures.push("financial_fingerprint_fetch_error");
    } else if (!fingerprintMatch) {
      failures.push("financial_fingerprint_mismatch");
    }
  }

  const blockingFailures = failures.filter(isBlockingRecoveryCertificationFailure);

  return {
    checkedAt: new Date().toISOString(),
    certified:
      blockingFailures.length === 0 && rows.every((r) => r.match || r.cloudCount === null || isNonBlockingTrustRowMismatch(r.id)),
    failures,
    rows,
    financial: readFinancialParitySnapshot(),
    financialFingerprint: {
      local: localFingerprint,
      cloud: cloudFingerprint,
      cloudError: fingerprintError,
      match: cloudFingerprint === null ? true : fingerprintMatch,
    },
    bootstrapComplete: cp.bootstrapComplete,
    recoveryInvariantPassed,
    inventoryIntegrityOk: inventory.ok,
    inventoryIntegrityStatus,
    inventoryMismatches: inventory.mismatches,
    stockMovementCount: s.stockMovements.length,
  };
}
