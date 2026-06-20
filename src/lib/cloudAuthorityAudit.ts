/**
 * Cloud authority classification and recovery readiness scoring.
 */

import { countUnsyncedSales } from "../offline/cloudSync";
import { readSyncCheckpoints } from "./syncCheckpoints";
import { readSyncHealthMeta } from "./syncMeta";
import { getLastSnapshotUploadTrimAnalysis } from "./snapshotTrimDiagnostics";
import { getLastCloudSnapshotUploadIso, isLocalShopDataEmpty } from "./cloudSnapshotSync";
import { usePosStore } from "../store/usePosStore";

export type CloudProtectionTier = "authoritative" | "partial" | "local_only";

export type CloudEntityDefinition = {
  id: string;
  labelKey: string;
  tier: CloudProtectionTier;
  weight: number;
  recoverableOnNewDevice: boolean;
};

/** PART 1 matrix — static classification. */
export const CLOUD_ENTITY_DEFINITIONS: CloudEntityDefinition[] = [
  { id: "products", labelKey: "cloudEntityProducts", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "sales", labelKey: "cloudEntitySales", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "customers", labelKey: "cloudEntityCustomers", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "debts", labelKey: "cloudEntityDebts", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "suppliers", labelKey: "cloudEntitySuppliers", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "purchases", labelKey: "cloudEntityPurchases", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "stock_movements", labelKey: "cloudEntityStockMovements", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "inventory_counts", labelKey: "cloudEntityInventoryCounts", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "shifts", labelKey: "cloudEntityShifts", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "day_closes", labelKey: "cloudEntityDayCloses", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "cash_adjustments", labelKey: "cloudEntityCashAdjustments", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "day_drawer_opens", labelKey: "cloudEntityDayDrawerOpens", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "cash_expenses", labelKey: "cloudEntityCashExpenses", tier: "authoritative", weight: 1, recoverableOnNewDevice: true },
  { id: "staff", labelKey: "cloudEntityStaff", tier: "partial", weight: 0.5, recoverableOnNewDevice: true },
  { id: "audit_logs", labelKey: "cloudEntityAuditLogs", tier: "partial", weight: 0.5, recoverableOnNewDevice: false },
  { id: "reports", labelKey: "cloudEntityReports", tier: "local_only", weight: 0, recoverableOnNewDevice: true },
  { id: "settings", labelKey: "cloudEntitySettings", tier: "partial", weight: 0.5, recoverableOnNewDevice: false },
];

export type CloudEntityStatus = {
  id: string;
  labelKey: string;
  tier: CloudProtectionTier;
  localCount: number;
  unsyncedCount: number;
  protectionLabelKey: CloudProtectionTier extends never ? never : string;
};

export type CloudRecoverySnapshot = {
  scorePct: number;
  authoritativeCount: number;
  partialCount: number;
  localOnlyCount: number;
  entities: CloudEntityStatus[];
  lastSuccessfulSyncAt: string | null;
  lastSnapshotUploadAt: string | null;
  unsyncedOperations: number;
  bootstrapComplete: boolean;
  badge: "protected" | "partial" | "at_risk";
  badgeKey: string;
  recoveryReady: boolean;
  localOnlyRisk: boolean;
};

function tierLabelKey(tier: CloudProtectionTier): string {
  if (tier === "authoritative") return "cloudProtectionAuthoritative";
  if (tier === "partial") return "cloudProtectionPartial";
  return "cloudProtectionLocalOnly";
}

function countUnsynced(rows: unknown[]): number {
  return rows.filter((r) => (r as { pendingSync?: boolean }).pendingSync).length;
}

export function buildCloudRecoverySnapshotFromStore(): CloudRecoverySnapshot {
  const s = usePosStore.getState();
  const prefs = s.preferences;
  const shifts = prefs.shifts ?? [];

  const entityCounts: Record<string, { local: number; unsynced: number }> = {
    products: { local: s.products.length, unsynced: countUnsynced(s.products) },
    sales: { local: s.sales.length, unsynced: countUnsynced(s.sales) },
    customers: { local: s.customers.length, unsynced: 0 },
    debts: { local: s.debtPayments.length, unsynced: 0 },
    suppliers: { local: s.suppliers.length, unsynced: countUnsynced(s.suppliers) },
    purchases: { local: s.purchases.length, unsynced: countUnsynced(s.purchases) },
    stock_movements: { local: s.stockMovements.length, unsynced: 0 },
    inventory_counts: { local: s.inventoryCountSessions.length, unsynced: countUnsynced(s.inventoryCountSessions) },
    shifts: { local: shifts.length, unsynced: shifts.filter((sh) => sh.pendingSync).length },
    day_closes: { local: s.dayCloses.length, unsynced: countUnsynced(s.dayCloses) },
    cash_adjustments: { local: s.cashDrawerAdjustments.length, unsynced: countUnsynced(s.cashDrawerAdjustments) },
    day_drawer_opens: { local: s.dayDrawerOpens.length, unsynced: countUnsynced(s.dayDrawerOpens) },
    cash_expenses: { local: s.cashExpenses.length, unsynced: 0 },
    staff: { local: (prefs.staffAccounts ?? []).length, unsynced: 0 },
    audit_logs: { local: s.auditLogs.length + s.archivedAuditLogs.length, unsynced: 0 },
    reports: { local: 0, unsynced: 0 },
    settings: { local: 1, unsynced: 0 },
  };

  const entities: CloudEntityStatus[] = CLOUD_ENTITY_DEFINITIONS.map((def) => {
    const counts = entityCounts[def.id] ?? { local: 0, unsynced: 0 };
    return {
      id: def.id,
      labelKey: def.labelKey,
      tier: def.tier,
      localCount: counts.local,
      unsyncedCount: counts.unsynced,
      protectionLabelKey: tierLabelKey(def.tier),
    };
  });

  let earned = 0;
  let max = 0;
  let authoritativeCount = 0;
  let partialCount = 0;
  let localOnlyCount = 0;
  for (const def of CLOUD_ENTITY_DEFINITIONS) {
    max += def.weight;
    if (def.tier === "authoritative") {
      authoritativeCount += 1;
      earned += def.weight;
    } else if (def.tier === "partial") {
      partialCount += 1;
      earned += def.weight * 0.5;
    } else {
      localOnlyCount += 1;
    }
  }

  const scorePct = max > 0 ? Math.round((earned / max) * 100) : 0;
  const cp = readSyncCheckpoints();
  const health = readSyncHealthMeta();
  const lastUpload = getLastSnapshotUploadTrimAnalysis();
  void lastUpload;
  const unsyncedSales = countUnsyncedSales();
  const queueUnsynced = entityCounts.sales.unsynced + entityCounts.purchases.unsynced + entityCounts.cash_adjustments.unsynced;
  const unsyncedOperations = unsyncedSales + queueUnsynced;

  const localOnlyRisk =
    localOnlyCount > 0 &&
    (s.stockMovements.length > 0 || s.archivedSales.length > 0 || s.auditLogs.length > 50);

  let badge: CloudRecoverySnapshot["badge"] = "protected";
  let badgeKey = "cloudProtectionBadgeProtected";
  if (scorePct < 85 || localOnlyRisk || unsyncedOperations > 20) {
    badge = "at_risk";
    badgeKey = "cloudProtectionBadgeAtRisk";
  } else if (scorePct < 97 || partialCount > 0) {
    badge = "partial";
    badgeKey = "cloudProtectionBadgePartial";
  }

  const recoveryReady =
    scorePct >= 90 &&
    cp.bootstrapComplete &&
    unsyncedOperations < 50 &&
    !localOnlyRisk;

  return {
    scorePct,
    authoritativeCount,
    partialCount,
    localOnlyCount,
    entities,
    lastSuccessfulSyncAt: health.lastSuccessAt ?? cp.lastSalesSyncAt ?? null,
    lastSnapshotUploadAt: getLastCloudSnapshotUploadIso() ?? null,
    unsyncedOperations,
    bootstrapComplete: cp.bootstrapComplete,
    badge,
    badgeKey,
    recoveryReady,
    localOnlyRisk,
  };
}

/** Broader empty check for new-device recovery (PART 2). */
export function isLocalOperationalCacheEmpty(): boolean {
  return isLocalShopDataEmpty();
}

export function needsCloudRecoveryBootstrap(): boolean {
  const cp = readSyncCheckpoints();
  return isLocalOperationalCacheEmpty() || !cp.bootstrapComplete;
}
