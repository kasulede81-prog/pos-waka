/**
 * Cached owner command-center bundle — single integrity pass per refresh.
 */

import { partitionAttentionByAck } from "./ownerAlertAcknowledgement";
import { getCachedComputation } from "./computationResultCache";
import {
  buildAttentionCenter,
  buildShiftAccountabilityRows,
  type OwnerCommandCenterAttentionInput,
  type OwnerCommandCenterInput,
} from "./ownerCommandCenter";
import {
  buildHistoricalShiftStats,
  buildOwnerDashboardIntegritySnapshot,
  type OwnerDashboardIntegritySnapshot,
} from "./ownerDashboardIntegrityCache";
import {
  buildOwnerCommandCenterContext,
  type OwnerCommandCenterOverview,
} from "./ownerCommandCenterContext";
import {
  buildCashControlExtended,
  buildDiagnosticsHints,
  buildExtendedIntegritySignals,
  buildFinancialExtended,
  buildInventoryExtended,
  buildLiveOperationsSnapshot,
  buildSnapshotTrimStatus,
  buildStaffControlRows,
  type OwnerCashExtended,
  type OwnerFinancialExtended,
  type OwnerInventoryExtended,
  type OwnerLiveOperationsSnapshot,
  type StaffControlRow,
} from "./ownerCommandCenterBuilders";
import { snapshotFromPartial } from "../offline/backupEngine";
import { listSyncConflicts } from "./syncConflictLog";
import { readSyncHealthMeta } from "./syncMeta";

export type OwnerCommandCenterBundle = {
  overview: OwnerCommandCenterOverview;
  integrity: OwnerDashboardIntegritySnapshot;
  attention: ReturnType<typeof buildAttentionCenter>;
  attentionReviewed: ReturnType<typeof buildAttentionCenter>;
  integritySignals: ReturnType<typeof buildExtendedIntegritySignals>;
  liveOps: OwnerLiveOperationsSnapshot;
  shiftRows: StaffControlRow[];
  cash: OwnerCashExtended;
  inventory: OwnerInventoryExtended;
  financial: OwnerFinancialExtended;
};

export function buildOwnerCommandCenterFingerprint(input: OwnerCommandCenterInput): string {
  const { bounds, sales, products, shifts, customers, suppliers, debtPayments, stockMovements, purchases } = input;
  const salesFp = `${sales.length}:${sales[0]?.id ?? ""}:${sales[sales.length - 1]?.id ?? ""}`;
  return [
    bounds.fromKey,
    bounds.toKey,
    bounds.isSingleDay ? "1d" : "rng",
    salesFp,
    products.length,
    shifts.length,
    customers.length,
    suppliers.length,
    debtPayments.length,
    stockMovements.length,
    purchases.length,
    input.inventoryCountSessions.length,
    input.cashDrawerAdjustments.length,
    input.cashExpenses.length,
    input.auditLogs.length,
    input.acknowledgements.length,
    input.syncPendingCount,
    input.syncErrorCount,
    input.expectedCashUgx,
    input.pharmacyMode ? "rx" : "std",
    input.devicesOnline ?? 0,
    input.devicesStale ?? 0,
  ].join(":");
}

export function buildOwnerCommandCenterBundle(input: OwnerCommandCenterInput): OwnerCommandCenterBundle {
  const historicalStats = buildHistoricalShiftStats(input.shifts);
  const { overview, ownerAlertsResolved, riskCards, revenueIndex } = buildOwnerCommandCenterContext({
    lang: input.lang,
    bounds: input.bounds,
    sales: input.sales,
    products: input.products,
    auditLogs: input.auditLogs,
    returnRecords: input.returnRecords,
    voidRecords: input.voidRecords,
    dayCloses: input.dayCloses,
    preferences: input.preferences,
  });

  const attentionInput: OwnerCommandCenterAttentionInput = {
    ...input,
    ownerAlertsResolved,
    riskCards,
  };

  const integrity = buildOwnerDashboardIntegritySnapshot({
    bounds: input.bounds,
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
    products: input.products,
    stockMovements: input.stockMovements,
    dayDrawerOpens: input.dayDrawerOpens,
    shifts: input.shifts,
    syncPendingCount: input.syncPendingCount,
    syncErrorCount: input.syncErrorCount,
  });

  const baseShiftRows = buildShiftAccountabilityRows(
    input.shifts,
    input.bounds,
    input.lang,
    historicalStats,
  );
  const shiftRows = buildStaffControlRows(
    baseShiftRows,
    input.sales,
    input.voidRecords,
    input.returnRecords,
    input.auditLogs,
    input.bounds,
  );

  const attentionRaw = buildAttentionCenter(attentionInput, integrity, baseShiftRows);
  const criticalPart = partitionAttentionByAck(attentionRaw.critical, input.acknowledgements);
  const warningsPart = partitionAttentionByAck(attentionRaw.warnings, input.acknowledgements);

  const attention = {
    critical: criticalPart.active,
    warnings: warningsPart.active,
    information: attentionRaw.information,
  };
  const attentionReviewed = {
    critical: criticalPart.reviewed,
    warnings: warningsPart.reviewed,
    information: [] as typeof attentionRaw.information,
  };

  const syncHealth = input.syncHealth ?? readSyncHealthMeta();
  const diagnostics = buildDiagnosticsHints({
    products: input.products,
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
    stockMovements: input.stockMovements,
    suppliers: input.suppliers,
    purchases: input.purchases,
    supplierPayments: input.supplierPayments,
  });
  const partial = snapshotFromPartial({
    products: input.products,
    customers: input.customers,
    sales: input.sales,
    debtPayments: input.debtPayments,
    stockMovements: input.stockMovements,
    suppliers: input.suppliers,
    purchases: input.purchases,
    supplierPayments: input.supplierPayments,
    preferences: input.preferences,
  });
  const snapshotTrimStatus = partial ? buildSnapshotTrimStatus(partial) : "ok";

  return {
    overview,
    integrity,
    attention,
    attentionReviewed,
    integritySignals: buildExtendedIntegritySignals(integrity, input.bounds, {
      staleDeviceCount: input.devicesStale ?? 0,
      syncConflictCount: listSyncConflicts({ unacknowledgedOnly: true }).length,
      snapshotTrimStatus,
      restoreStatus: diagnostics.restoreStatus,
    }),
    liveOps: buildLiveOperationsSnapshot({
      shifts: input.shifts,
      dayDrawerOpens: input.dayDrawerOpens,
      primaryDayKey: input.bounds.toKey,
      syncPendingCount: input.syncPendingCount,
      syncHealth,
      devicesOnline: input.devicesOnline,
      devicesStale: input.devicesStale,
    }),
    shiftRows,
    cash: buildCashControlExtended({
      bounds: input.bounds,
      primaryDayKey: input.bounds.toKey,
      dayDrawerOpens: input.dayDrawerOpens,
      dayCloses: input.dayCloses,
      shifts: input.shifts,
      cashDrawerAdjustments: input.cashDrawerAdjustments,
      cashExpenses: input.cashExpenses,
      expectedCashUgx: input.expectedCashUgx,
      lang: input.lang,
    }),
    inventory: buildInventoryExtended(
      input.products,
      input.inventoryCountSessions,
      input.pharmacyMode,
      input.sales,
      input.bounds,
      input.auditLogs,
    ),
    financial: buildFinancialExtended({
      sales: input.sales,
      returnRecords: input.returnRecords,
      products: input.products,
      customers: input.customers,
      suppliers: input.suppliers,
      purchases: input.purchases,
      debtPayments: input.debtPayments,
      cashExpenses: input.cashExpenses,
      bounds: input.bounds,
      salesIndex: revenueIndex,
    }),
  };
}

export function getCachedOwnerCommandCenterBundle(
  input: OwnerCommandCenterInput,
): OwnerCommandCenterBundle {
  const fp = buildOwnerCommandCenterFingerprint(input);
  return getCachedComputation("ownerCommandCenterBundle", fp, () => buildOwnerCommandCenterBundle(input));
}
