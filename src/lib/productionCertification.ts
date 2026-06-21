/**
 * Production Certification — formal multi-device operational clone report.
 */

import { usePosStore } from "../store/usePosStore";
import { readSyncQueue } from "../offline/localDb";
import { countUnsyncedSales, wasLastSalesPullTruncated } from "../offline/cloudSync";
import type { PersistedSnapshot } from "../offline/localDb";
import {
  buildCloudTrustCertificationReport,
  fetchCloudEntityCounts,
  readFinancialParitySnapshot,
  readLocalEntityCounts,
  type CloudTrustCertificationReport,
  type FinancialParitySnapshot,
  type FullEntityCounts,
} from "./cloudTrustCenter";
import { getLastCloudRecoveryValidation } from "./cloudRecoveryValidator";
import { getCloudRecoverySession, readLastCloudRecoveryDiagnostics } from "./cloudRecoverySession";
import { readSyncHealthMeta } from "./syncMeta";
import { getOrCreateDeviceId } from "./deviceId";
import { dateKeyKampala } from "./datesUg";
import { getExpectedCashForDay } from "./cashReconciliation";
import { analyzeSnapshotTrim, MAX_CLOUD_SNAPSHOT_BYTES } from "./snapshotTrimDiagnostics";
import { getLastCloudSnapshotUploadIso } from "./cloudSnapshotSync";

export const CERTIFICATION_TEST_DATASET: FullEntityCounts = {
  products: 100,
  customers: 50,
  sales: 200,
  returns: 20,
  debtPayments: 20,
  expenses: 20,
  suppliers: 10,
  purchases: 10,
  supplierPayments: 10,
  staff: 5,
  shifts: 5,
  dayCloses: 2,
  inventoryCounts: 0,
  cashAdjustments: 0,
  dayOpens: 0,
  stockMovements: 0,
  auditLogs: 0,
};

/** Large-shop stress targets — unlimited recovery certification benchmarks. */
export const LARGE_SHOP_STRESS_TARGETS = {
  sales: 100_000,
  customers: 20_000,
  auditLogs: 1_000_000,
  products: 10_000,
} as const;

export const PRODUCTION_STRESS_LIMITS = {
  /** Snapshot upload trim only — recovery does not depend on snapshot size. */
  snapshotMaxBytes: MAX_CLOUD_SNAPSHOT_BYTES,
  snapshotSalesRetainAfterTrim: 300,
} as const;

export type ExtendedFinancialParity = FinancialParitySnapshot & {
  expectedCashTodayUgx: number;
  totalSupplierBalanceUgx: number;
};

export type PendingSyncSnapshot = {
  queueTotal: number;
  unsyncedSalesFlag: number;
  products: number;
  purchases: number;
  suppliers: number;
  shifts: number;
  dayCloses: number;
  cashAdjustments: number;
  dayDrawerOpens: number;
  inventoryCounts: number;
  supplierPayments: number;
  returns: number;
  expenses: number;
  totalEntityPending: number;
  totalPending: number;
};

export type OperationalFingerprint = {
  counts: FullEntityCounts;
  financial: ExtendedFinancialParity;
  stockByProductId: Record<string, number>;
  staffSignature: string;
  hash: string;
};

export type StressScenarioAssessment = {
  id: string;
  description: string;
  threshold: string;
  actual: string;
  predictedVerdict: "pass" | "fail";
  reason: string;
};

export type ProductionCertificationReport = CloudTrustCertificationReport & {
  deviceId: string;
  verdict: "PASS" | "FAIL";
  cloudCounts: FullEntityCounts | null;
  localCounts: FullEntityCounts;
  financial: ExtendedFinancialParity;
  pendingSync: PendingSyncSnapshot;
  recoveryDiagnostics: ReturnType<typeof readLastCloudRecoveryDiagnostics>;
  recoveryValidation: ReturnType<typeof getLastCloudRecoveryValidation>;
  inventoryIntegrityOk: boolean;
  cloudTrustPass: boolean;
  operationalFingerprint: OperationalFingerprint;
  stressScenarios: StressScenarioAssessment[];
  snapshotTrimAnalysis: ReturnType<typeof analyzeSnapshotTrim> | null;
  lastSnapshotUploadAt: string | null;
  syncHealthLastIssue: string | null;
  salesPullTruncated: boolean;
  largeShopMode: boolean;
};

function countPending(rows: unknown[]): number {
  return rows.filter((r) => (r as { pendingSync?: boolean }).pendingSync).length;
}

function snapshotFromStore(): PersistedSnapshot | null {
  const s = usePosStore.getState();
  if (!s._hydrated) return null;
  return {
    products: s.products,
    customers: s.customers,
    sales: s.sales,
    preferences: s.preferences,
    debtPayments: s.debtPayments,
    dayCloses: s.dayCloses,
    auditLogs: s.auditLogs,
    suppliers: s.suppliers,
    purchases: s.purchases,
    supplierPayments: s.supplierPayments,
    stockMovements: s.stockMovements,
    voidRecords: s.voidRecords,
    returnRecords: s.returnRecords,
    cashExpenses: s.cashExpenses,
    cashDrawerAdjustments: s.cashDrawerAdjustments,
    dayDrawerOpens: s.dayDrawerOpens,
    inventoryCountSessions: s.inventoryCountSessions,
    archivedSales: s.archivedSales,
    archivedAuditLogs: s.archivedAuditLogs,
    archivedDayCloses: s.archivedDayCloses,
    archivedVoidRecords: s.archivedVoidRecords,
    archivedReturnRecords: s.archivedReturnRecords,
    updatedAt: new Date().toISOString(),
  };
}

export function readExtendedFinancialParity(): ExtendedFinancialParity {
  const s = usePosStore.getState();
  const base = readFinancialParitySnapshot();
  const today = dateKeyKampala(new Date());
  const shifts = s.preferences.shifts ?? [];
  let supplierBalance = 0;
  for (const sup of s.suppliers) supplierBalance += Math.max(0, sup.balanceOwedUgx ?? 0);
  const expectedCashTodayUgx = getExpectedCashForDay({
    sales: s.sales,
    returns: s.returnRecords,
    products: s.products,
    debtPayments: s.debtPayments,
    cashExpenses: s.cashExpenses,
    supplierPayments: s.supplierPayments,
    cashDrawerAdjustments: s.cashDrawerAdjustments,
    shifts,
    dayDrawerOpens: s.dayDrawerOpens,
    formulaVersion: s.preferences.cashDrawerFormulaVersion ?? "v1",
    day: today,
  });
  return {
    ...base,
    expectedCashTodayUgx,
    totalSupplierBalanceUgx: supplierBalance,
  };
}

export async function readPendingSyncSnapshot(): Promise<PendingSyncSnapshot> {
  const s = usePosStore.getState();
  const shifts = s.preferences.shifts ?? [];
  const queue = await readSyncQueue().catch(() => []);
  const products = countPending(s.products);
  const purchases = countPending(s.purchases);
  const suppliers = countPending(s.suppliers);
  const shiftPending = countPending(shifts);
  const dayCloses = countPending(s.dayCloses);
  const cashAdjustments = countPending(s.cashDrawerAdjustments);
  const dayDrawerOpens = countPending(s.dayDrawerOpens);
  const inventoryCounts = countPending(s.inventoryCountSessions);
  const supplierPayments = countPending(s.supplierPayments);
  const returns = countPending(s.returnRecords);
  const expenses = countPending(s.cashExpenses);
  const unsyncedSalesFlag = countUnsyncedSales();
  const totalEntityPending =
    products +
    purchases +
    suppliers +
    shiftPending +
    dayCloses +
    cashAdjustments +
    dayDrawerOpens +
    inventoryCounts +
    supplierPayments +
    returns +
    expenses +
    unsyncedSalesFlag;
  return {
    queueTotal: queue.length,
    unsyncedSalesFlag,
    products,
    purchases,
    suppliers,
    shifts: shiftPending,
    dayCloses,
    cashAdjustments,
    dayDrawerOpens,
    inventoryCounts,
    supplierPayments,
    returns,
    expenses,
    totalEntityPending,
    totalPending: queue.length + totalEntityPending,
  };
}

export function computeStaffSignature(): string {
  const staff = usePosStore.getState().preferences.staffAccounts ?? [];
  return staff
    .map((a) => `${a.id}:${a.name}:${a.role}:${a.active ? 1 : 0}`)
    .sort()
    .join("|");
}

export function computeOperationalFingerprint(): OperationalFingerprint {
  const counts = readLocalEntityCounts();
  const financial = readExtendedFinancialParity();
  const s = usePosStore.getState();
  const stockByProductId: Record<string, number> = {};
  for (const p of s.products) {
    stockByProductId[p.id] = p.stockOnHand ?? 0;
  }
  const staffSignature = computeStaffSignature();
  const payload = JSON.stringify({ counts, financial, stockByProductId, staffSignature });
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return {
    counts,
    financial,
    stockByProductId,
    staffSignature,
    hash: `fp_${hash.toString(16)}`,
  };
}

export function fingerprintsMatch(a: OperationalFingerprint, b: OperationalFingerprint): boolean {
  return a.hash === b.hash && a.staffSignature === b.staffSignature;
}

export function assessStressScenarios(input: {
  counts: FullEntityCounts;
  snapshotBytes?: number;
  salesPullTruncated?: boolean;
  largeShopMode?: boolean;
}): StressScenarioAssessment[] {
  const { counts, snapshotBytes, salesPullTruncated, largeShopMode } = input;
  const recoveryBlocked = salesPullTruncated === true;

  const scenarios: StressScenarioAssessment[] = [
    {
      id: "sales_100k",
      description: "100,000 sales history",
      threshold: String(LARGE_SHOP_STRESS_TARGETS.sales),
      actual: String(counts.sales),
      predictedVerdict: recoveryBlocked ? "fail" : "pass",
      reason: recoveryBlocked
        ? "Sales pull reported truncation — cloud parity incomplete"
        : "Paginated sales pull recovers full history regardless of snapshot",
    },
    {
      id: "customers_20k",
      description: "20,000 customers",
      threshold: String(LARGE_SHOP_STRESS_TARGETS.customers),
      actual: String(counts.customers),
      predictedVerdict: recoveryBlocked ? "fail" : "pass",
      reason: recoveryBlocked
        ? "Recovery pull incomplete"
        : "Cursor-paginated customer pull has no fixed cap",
    },
    {
      id: "audit_1m",
      description: "1,000,000 audit logs",
      threshold: String(LARGE_SHOP_STRESS_TARGETS.auditLogs),
      actual: String(counts.auditLogs),
      predictedVerdict: recoveryBlocked ? "fail" : "pass",
      reason: recoveryBlocked
        ? "Recovery pull incomplete"
        : "Paginated audit recovery with progress reporting",
    },
    {
      id: "products_10k",
      description: "10,000 products",
      threshold: String(LARGE_SHOP_STRESS_TARGETS.products),
      actual: String(counts.products),
      predictedVerdict: recoveryBlocked ? "fail" : "pass",
      reason: recoveryBlocked
        ? "Recovery pull incomplete"
        : "Paginated product pull has no fixed cap",
    },
    {
      id: "snapshot_8mb",
      description: "Snapshot > 8 MB (upload trim)",
      threshold: `${PRODUCTION_STRESS_LIMITS.snapshotMaxBytes} bytes`,
      actual: snapshotBytes != null ? String(snapshotBytes) : "unknown",
      predictedVerdict: largeShopMode ? "pass" : snapshotBytes != null && snapshotBytes > PRODUCTION_STRESS_LIMITS.snapshotMaxBytes ? "fail" : "pass",
      reason:
        largeShopMode
          ? "Snapshot trim affects upload only — recovery uses paginated cloud pull"
          : snapshotBytes != null && snapshotBytes > PRODUCTION_STRESS_LIMITS.snapshotMaxBytes
            ? "Snapshot exceeds upload trim threshold"
            : "Snapshot within upload limit",
    },
    {
      id: "multi_device_recovery",
      description: "Multi-device recovery parity",
      threshold: "fingerprint match",
      actual: largeShopMode ? "large_shop_mode" : "standard",
      predictedVerdict: recoveryBlocked ? "fail" : "pass",
      reason: recoveryBlocked
        ? "Incomplete pull prevents operational fingerprint match"
        : "Cloud parity certification compares cloud vs local counts",
    },
  ];
  return scenarios;
}

function mergeProductionFailures(
  trust: CloudTrustCertificationReport,
  pending: PendingSyncSnapshot,
  validation: ReturnType<typeof getLastCloudRecoveryValidation>,
  cloudCounts: FullEntityCounts | null,
  localCounts: FullEntityCounts,
  salesPullTruncated: boolean,
): string[] {
  const failures = [...trust.failures];

  if (!trust.bootstrapComplete) failures.push("bootstrap_incomplete");
  if (!trust.recoveryInvariantPassed) failures.push("recovery_invariant_failed");
  if (!trust.inventoryIntegrityOk) failures.push("inventory_integrity_failed");

  if (pending.totalPending > 0) failures.push("pending_sync_present");
  if (salesPullTruncated) failures.push("sales_pull_truncated");

  if (validation) {
    for (const f of validation.failures) {
      failures.push(`recovery_validation_${f.code}`);
    }
  }

  const session = getCloudRecoverySession();
  if (session.status === "failed") failures.push("recovery_session_failed");
  if (session.errorKey) failures.push(`recovery_error_${session.errorKey}`);

  if (cloudCounts && cloudCounts.staff !== localCounts.staff) {
    failures.push("staff_count_mismatch");
  }

  return [...new Set(failures)];
}

export async function buildProductionCertificationReport(input?: {
  cloud?: FullEntityCounts | null;
  cloudErrors?: Partial<Record<keyof FullEntityCounts, string>>;
  requireCloudParity?: boolean;
  largeShopMode?: boolean;
}): Promise<ProductionCertificationReport> {
  let cloud = input?.cloud;
  let cloudErrors = input?.cloudErrors;
  if (cloud === undefined) {
    const fetched = await fetchCloudEntityCounts();
    cloud = fetched.counts;
    cloudErrors = fetched.errors;
  }

  const localCounts = readLocalEntityCounts();
  const trust = buildCloudTrustCertificationReport({
    cloud,
    cloudErrors,
    local: localCounts,
    requireCloudParity: input?.requireCloudParity ?? true,
  });

  const pendingSync = await readPendingSyncSnapshot();
  const validation = getLastCloudRecoveryValidation();
  const recoveryDiagnostics = readLastCloudRecoveryDiagnostics();
  const financial = readExtendedFinancialParity();
  const operationalFingerprint = computeOperationalFingerprint();
  const snap = snapshotFromStore();
  const snapshotTrimAnalysis = snap ? analyzeSnapshotTrim(snap) : null;
  const salesPullTruncated = wasLastSalesPullTruncated();
  const largeShopMode = input?.largeShopMode ?? true;
  const stressScenarios = assessStressScenarios({
    counts: localCounts,
    snapshotBytes: snapshotTrimAnalysis?.originalBytes,
    salesPullTruncated,
    largeShopMode,
  });

  const failures = mergeProductionFailures(
    trust,
    pendingSync,
    validation,
    cloud,
    localCounts,
    salesPullTruncated,
  );
  const cloudTrustPass = trust.certified;
  const verdict: "PASS" | "FAIL" = failures.length === 0 && cloudTrustPass ? "PASS" : "FAIL";

  return {
    ...trust,
    deviceId: getOrCreateDeviceId(),
    verdict,
    certified: verdict === "PASS",
    failures,
    cloudCounts: cloud,
    localCounts,
    financial,
    pendingSync,
    recoveryDiagnostics,
    recoveryValidation: validation,
    inventoryIntegrityOk: trust.inventoryIntegrityOk,
    cloudTrustPass,
    operationalFingerprint,
    stressScenarios,
    snapshotTrimAnalysis,
    lastSnapshotUploadAt: getLastCloudSnapshotUploadIso(),
    syncHealthLastIssue: readSyncHealthMeta().lastIssueCode ?? null,
    salesPullTruncated,
    largeShopMode,
  };
}

export function formatProductionCertificationMarkdown(report: ProductionCertificationReport): string {
  const lines: string[] = [
    "# Waka POS Production Certification Report",
    "",
    `**Verdict:** ${report.verdict}`,
    `**Checked at:** ${report.checkedAt}`,
    `**Device ID:** ${report.deviceId}`,
    `**Operational fingerprint:** ${report.operationalFingerprint.hash}`,
    "",
    "## Cloud Trust",
    `- Cloud Trust Pass: ${report.cloudTrustPass ? "yes" : "no"}`,
    `- Bootstrap complete: ${report.bootstrapComplete ? "yes" : "no"}`,
    `- Recovery invariant: ${report.recoveryInvariantPassed ? "pass" : "fail"}`,
    `- Inventory integrity: ${report.inventoryIntegrityOk ? "pass" : "fail"}`,
    `- Pending sync total: ${report.pendingSync.totalPending}`,
    `- Last snapshot upload: ${report.lastSnapshotUploadAt ?? "none"}`,
    "",
    "## Entity counts (cloud vs local)",
    "",
    "| Entity | Cloud | Local | Match |",
    "| --- | --- | --- | --- |",
  ];

  for (const row of report.rows) {
    lines.push(
      `| ${row.id} | ${row.cloudCount ?? "—"} | ${row.localCount} | ${row.match ? "PASS" : "FAIL"} |`,
    );
  }

  lines.push("", "## Financial totals", "");
  lines.push(`- Revenue (UGX): ${report.financial.revenueUgx}`);
  lines.push(`- Profit (UGX): ${report.financial.profitUgx}`);
  lines.push(`- Expected cash today (UGX): ${report.financial.expectedCashTodayUgx}`);
  lines.push(`- Inventory value (UGX): ${report.financial.inventoryValueUgx}`);
  lines.push(`- Stock quantity: ${report.financial.totalStockQuantity}`);
  lines.push(`- Customer debt (UGX): ${report.financial.totalCustomerDebtUgx}`);
  lines.push(`- Supplier balance (UGX): ${report.financial.totalSupplierBalanceUgx}`);

  if (report.failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const f of report.failures) lines.push(`- ${f}`);
  }

  if (report.recoveryValidation) {
    lines.push("", "## Recovery validation", "");
    lines.push(`- OK: ${report.recoveryValidation.ok}`);
    for (const f of report.recoveryValidation.failures) {
      lines.push(`- [${f.severity}] ${f.code}: ${f.message}`);
    }
  }

  lines.push("", "## Stress scenarios (code prediction)", "");
  for (const s of report.stressScenarios) {
    lines.push(`- ${s.description}: **${s.predictedVerdict.toUpperCase()}** (${s.reason})`);
  }

  return lines.join("\n");
}
