import type { ShopOpsDetail, SyncHealthRow } from "./wakaInternalAdmin";
import {
  computeShopHealth,
  detectFraudSignals,
  type HealthLevel,
  type ShopHealth,
} from "./internalOpsIntelligence";
import type { ParsedRescueDiagnostics } from "./rescueDiagnosticsParse";
import type { OpsAuditRow } from "./wakaInternalAdmin";

export type RescueHealthSummary = {
  score: number;
  level: HealthLevel;
  recoveryStatus: string;
  syncStatus: string;
  cloudStatus: string;
  lastSuccessfulSync: string | null;
  lastActivity: string | null;
  activeDevices: number;
  currentPlan: string;
  trialStatus: string;
  riskFlags: string[];
};

export type RescueFinancialSnapshot = {
  source: "cloud_backup" | "imported_diagnostics" | "partial";
  revenueUgx: number | null;
  expensesUgx: number | null;
  profitUgx: number | null;
  customerDebtUgx: number | null;
  supplierBalanceUgx: number | null;
  cashPositionUgx: number | null;
  note: string | null;
};

export type RescueAuditEvent = {
  id: string;
  at: string;
  user: string;
  category: string;
  severity: "info" | "warning" | "critical";
  action: string;
  summary: string;
  payload: Record<string, unknown> | null;
};

const ONLINE_MS = 15 * 60 * 1000;

function deviceOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_MS;
}

function syncStatusLabel(sy: SyncHealthRow | null, pendingImport: number | null): string {
  const pending = sy?.pending_outbound ?? pendingImport ?? 0;
  if (sy?.last_error?.trim()) return "Failed";
  if (pending > 10) return "Backlogged";
  if (pending > 0) return "Pending";
  if (sy?.last_push_ok_at || sy?.last_pull_at) return "Healthy";
  return "Unknown";
}

function cloudStatusLabel(detail: ShopOpsDetail): string {
  if (detail.cloud_snapshot_at) {
    const age = Date.now() - new Date(detail.cloud_snapshot_at).getTime();
    if (age < 24 * 3600_000) return "Recent backup";
    if (age < 7 * 86400_000) return "Stale backup";
    return "Old backup";
  }
  if ((detail.product_count_snapshot ?? 0) > 0) return "Snapshot only";
  return "No cloud backup";
}

function recoveryStatusLabel(diagnostics: ParsedRescueDiagnostics | null, hasCloudSnapshot: boolean): string {
  if (diagnostics?.cloudRecovery) {
    const r = diagnostics.cloudRecovery;
    if (r.recoveryLockActive) return "Recovery lock active";
    if (r.status === "active") return "Recovery in progress";
    if (r.status === "failed") return "Recovery failed";
    if (r.status === "complete") return "Recovery complete";
  }
  if (diagnostics?.cloudTrust?.bootstrapComplete) return "Bootstrap complete";
  if (hasCloudSnapshot) return "Cloud data available";
  return "Not applicable / unknown";
}

export function buildRescueHealthSummary(
  detail: ShopOpsDetail,
  diagnostics: ParsedRescueDiagnostics | null,
): { health: ShopHealth; summary: RescueHealthSummary } {
  const health = computeShopHealth({
    id: detail.shop.id,
    name: detail.shop.name,
    district: detail.shop.district,
    city: detail.shop.city,
    is_active: detail.shop.is_active,
    created_at: detail.shop.created_at ?? "",
    plan_code: detail.plan_code,
    trial_days_left: trialDaysLeft(detail),
    last_seen_at: detail.shop.last_seen_at,
    sale_count_30d: detail.sale_count_30d,
    gps_missing: false,
  });

  const fraud = detectFraudSignals(detail);
  const activeDevices = detail.devices.filter((d) => d.is_active && deviceOnline(d.last_seen_at)).length;
  const sy = detail.sync_health;
  const lastSync =
    sy?.last_push_ok_at && sy?.last_pull_at
      ? new Date(Math.max(new Date(sy.last_push_ok_at).getTime(), new Date(sy.last_pull_at).getTime())).toISOString()
      : sy?.last_push_ok_at ?? sy?.last_pull_at ?? null;

  const sub = detail.subscription;
  const trialStatus = sub?.trial_ends_at
    ? new Date(sub.trial_ends_at).getTime() > Date.now()
      ? `Trial until ${new Date(sub.trial_ends_at).toLocaleDateString("en-GB")}`
      : "Trial expired"
    : sub?.status ?? "—";

  return {
    health,
    summary: {
      score: health.score,
      level: health.level,
      recoveryStatus: recoveryStatusLabel(diagnostics, Boolean(detail.cloud_snapshot_at)),
      syncStatus: syncStatusLabel(sy, diagnostics?.pendingQueueTotal ?? null),
      cloudStatus: cloudStatusLabel(detail),
      lastSuccessfulSync: lastSync,
      lastActivity: detail.shop.last_seen_at ?? detail.last_sale_at,
      activeDevices,
      currentPlan: (detail.plan_code ?? "free").replace("_", " "),
      trialStatus,
      riskFlags: [...health.riskFlags, ...fraud],
    },
  };
}

function trialDaysLeft(detail: ShopOpsDetail): number | null {
  const end = detail.subscription?.trial_ends_at;
  if (!end) return null;
  const ms = new Date(end).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export function buildRescueFinancialSnapshot(
  detail: ShopOpsDetail,
  diagnostics: ParsedRescueDiagnostics | null,
  cloudBackupFinancial: Partial<RescueFinancialSnapshot> | null,
): RescueFinancialSnapshot {
  const imported = diagnostics?.cloudTrust?.financial;
  if (imported) {
    return {
      source: "imported_diagnostics",
      revenueUgx: imported.revenueUgx,
      expensesUgx: null,
      profitUgx: imported.profitUgx,
      customerDebtUgx: imported.totalCustomerDebtUgx,
      supplierBalanceUgx: imported.totalSupplierBalanceUgx,
      cashPositionUgx: imported.expectedCashTodayUgx,
      note: "From imported device diagnostics",
    };
  }
  if (cloudBackupFinancial && cloudBackupFinancial.revenueUgx != null) {
    return {
      source: "cloud_backup",
      revenueUgx: cloudBackupFinancial.revenueUgx ?? null,
      expensesUgx: cloudBackupFinancial.expensesUgx ?? null,
      profitUgx: cloudBackupFinancial.profitUgx ?? null,
      customerDebtUgx: cloudBackupFinancial.customerDebtUgx ?? null,
      supplierBalanceUgx: cloudBackupFinancial.supplierBalanceUgx ?? null,
      cashPositionUgx: cloudBackupFinancial.cashPositionUgx ?? null,
      note: "Estimated from cloud backup snapshot (read-only)",
    };
  }
  return {
    source: "partial",
    revenueUgx: null,
    expensesUgx: null,
    profitUgx: null,
    customerDebtUgx: null,
    supplierBalanceUgx: null,
    cashPositionUgx: null,
    note: `Cloud tables: ${detail.sale_count_30d} sales (30d). Import diagnostics for full financial parity.`,
  };
}

function auditCategory(action: string): string {
  if (action.includes("password") || action.includes("pin") || action.includes("verification")) return "account";
  if (action.includes("sync") || action.includes("device")) return "sync";
  if (action.includes("subscription") || action.includes("plan") || action.includes("payment")) return "billing";
  if (action.includes("rescue") || action.includes("support")) return "support";
  if (action.includes("suspend") || action.includes("active")) return "shop";
  return "admin";
}

function auditSeverity(action: string, payload: Record<string, unknown> | null): RescueAuditEvent["severity"] {
  if (action.includes("failed") || action.includes("suspend") || action.includes("force_logout")) return "warning";
  if (payload?.ok === false) return "critical";
  return "info";
}

export function mapOpsAuditToRescueEvents(rows: OpsAuditRow[], adminEmails: Map<string, string>): RescueAuditEvent[] {
  return rows.map((row) => {
    const payload = row.payload ?? {};
    const result = payload.result != null ? String(payload.result) : payload.ok === false ? "failed" : "ok";
    const reason = payload.reason != null ? String(payload.reason) : payload.detail != null ? String(payload.detail) : null;
    return {
      id: row.id,
      at: row.created_at,
      user: (row.actor && adminEmails.get(row.actor)) ?? row.actor ?? "Admin",
      category: auditCategory(row.action),
      severity: auditSeverity(row.action, payload),
      action: row.action,
      summary: `${row.action.replace(/_/g, " ")} · ${result}${reason ? ` · ${reason}` : ""}`,
      payload: row.payload,
    };
  });
}

export type RescueAuditFilters = {
  query: string;
  dateFrom: string;
  dateTo: string;
  user: string;
  category: string;
  severity: string;
};

export function filterRescueAuditEvents(events: RescueAuditEvent[], filters: RescueAuditFilters): RescueAuditEvent[] {
  const q = filters.query.trim().toLowerCase();
  return events.filter((e) => {
    if (filters.dateFrom && e.at.slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && e.at.slice(0, 10) > filters.dateTo) return false;
    if (filters.user && filters.user !== "all" && e.user !== filters.user) return false;
    if (filters.category && filters.category !== "all" && e.category !== filters.category) return false;
    if (filters.severity && filters.severity !== "all" && e.severity !== filters.severity) return false;
    if (q) {
      const hay = `${e.action} ${e.summary} ${e.category} ${e.user}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function exportRescueSupportLogs(input: {
  shopId: string;
  shopName: string;
  events: RescueAuditEvent[];
  health: RescueHealthSummary;
  diagnostics: ParsedRescueDiagnostics | null;
}): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      shopId: input.shopId,
      shopName: input.shopName,
      health: input.health,
      auditTimeline: input.events,
      importedDiagnostics: input.diagnostics
        ? { kind: input.diagnostics.kind, exportedAt: input.diagnostics.exportedAt }
        : null,
    },
    null,
    2,
  );
}

export function computeCloudBackupFinancial(snapshot: unknown): Partial<RescueFinancialSnapshot> | null {
  const root = snapshot && typeof snapshot === "object" ? (snapshot as Record<string, unknown>) : null;
  if (!root) return null;
  const inner = (root.snapshot && typeof root.snapshot === "object" ? root.snapshot : root) as Record<string, unknown>;

  const sales = Array.isArray(inner.sales) ? inner.sales : [];
  const expenses = Array.isArray(inner.cashExpenses) ? inner.cashExpenses : Array.isArray(inner.expenses) ? inner.expenses : [];
  const customers = Array.isArray(inner.customers) ? inner.customers : [];
  const suppliers = Array.isArray(inner.suppliers) ? inner.suppliers : [];

  let revenueUgx = 0;
  for (const s of sales) {
    const r = s as Record<string, unknown>;
    if (r.status != null && String(r.status) !== "completed") continue;
    revenueUgx += Number(r.totalUgx ?? r.total_ugx ?? 0) || 0;
  }

  let expensesUgx = 0;
  for (const e of expenses) {
    const r = e as Record<string, unknown>;
    expensesUgx += Number(r.amountUgx ?? r.amount_ugx ?? 0) || 0;
  }

  let customerDebtUgx = 0;
  for (const c of customers) {
    const r = c as Record<string, unknown>;
    customerDebtUgx += Math.max(0, Number(r.outstandingDebtUgx ?? r.outstanding_debt_ugx ?? r.debtUgx ?? 0) || 0);
  }

  let supplierBalanceUgx = 0;
  for (const sup of suppliers) {
    const r = sup as Record<string, unknown>;
    supplierBalanceUgx += Math.max(0, Number(r.balanceOwedUgx ?? r.balance_owed_ugx ?? 0) || 0);
  }

  if (revenueUgx === 0 && expensesUgx === 0 && customerDebtUgx === 0 && supplierBalanceUgx === 0) {
    return null;
  }

  return {
    revenueUgx,
    expensesUgx,
    profitUgx: revenueUgx - expensesUgx,
    customerDebtUgx,
    supplierBalanceUgx,
    cashPositionUgx: null,
  };
}

export function inventoryIntegrityFromSources(
  detail: ShopOpsDetail,
  diagnostics: ParsedRescueDiagnostics | null,
): {
  productCount: number;
  movementCount: number;
  status: string;
  mismatchCount: number;
  warnings: string[];
  mismatches: Array<{ product: string; recorded: number; expected: number; difference: number }>;
} {
  const mismatches =
    diagnostics?.cloudTrust?.inventoryMismatches ??
    diagnostics?.cloudRecovery?.inventoryReconciliation?.mismatches ??
    [];
  const status =
    diagnostics?.cloudTrust?.inventoryIntegrityStatus ??
    diagnostics?.cloudRecovery?.inventoryReconciliation?.inventoryIntegrityStatus ??
    (detail.product_count_table !== detail.product_count_snapshot &&
    detail.product_count_snapshot != null &&
    detail.product_count_table != null
      ? "cloud_table_mismatch"
      : "unknown");

  const warnings: string[] = [];
  if ((detail.product_count_snapshot ?? 0) > (detail.product_count_table ?? 0)) {
    warnings.push("Products in cloud backup exceed live cloud table count");
  }
  if (diagnostics?.cloudTrust && !diagnostics.cloudTrust.inventoryIntegrityOk) {
    warnings.push("Imported diagnostics report inventory integrity issues");
  }

  return {
    productCount: detail.product_count,
    movementCount: diagnostics?.cloudTrust?.stockMovementCount ?? 0,
    status,
    mismatchCount: mismatches.length,
    warnings,
    mismatches: mismatches.map((m) => ({
      product: m.productName || m.productId,
      recorded: m.recorded,
      expected: m.expected,
      difference: m.difference,
    })),
  };
}
