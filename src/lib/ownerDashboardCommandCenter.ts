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
import { dateKeyKampala } from "./datesUg";
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

/** Linear mutation token — count + deterministic 32-bit roll. Not a crypto hash. */
function mutationFingerprint(parts: string[]): string {
  let h = 0;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h = (Math.imul(31, h) + part.charCodeAt(i)) | 0;
    }
  }
  return `${parts.length}:${h}`;
}

function salesMutationFingerprint(sales: OwnerCommandCenterInput["sales"]): string {
  return mutationFingerprint(
    sales.map(
      (s) =>
        `${s.id}:${s.updatedAt ?? ""}:${s.status ?? ""}:${s.saleVoidedAt ?? ""}:${s.totalUgx}:${s.estimatedProfitUgx}`,
    ),
  );
}

function returnsMutationFingerprint(returns: OwnerCommandCenterInput["returnRecords"]): string {
  return mutationFingerprint(
    returns.map(
      (r) => `${r.id}:${r.saleId ?? ""}:${r.refundAmountUgx}:${r.quantity}:${r.createdAt}:${r.cogsUgx ?? ""}`,
    ),
  );
}

function voidsMutationFingerprint(voids: OwnerCommandCenterInput["voidRecords"]): string {
  return mutationFingerprint(voids.map((v) => `${v.id}:${v.saleId}:${v.amountUgx}:${v.createdAt}`));
}

function dayCloseMutationFingerprint(closes: OwnerCommandCenterInput["dayCloses"]): string {
  return mutationFingerprint(
    closes.map((c) => {
      const snap = c.documentSnapshot;
      return [
        c.id,
        c.dateKey,
        c.supersededAt ?? "",
        c.updatedAt ?? c.createdAt,
        c.expectedCashUgx,
        c.countedCashUgx,
        c.differenceUgx,
        c.totalSalesUgx,
        c.profitEstimateUgx,
        c.totalDebtUgx,
        snap?.expectedCashUgx ?? "",
        snap?.totalSalesUgx ?? "",
        snap?.profitEstimateUgx ?? "",
        snap?.expenseUgx ?? "",
        snap?.totalDebtUgx ?? "",
        snap?.transactionCount ?? "",
        snap?.cashFromSalesUgx ?? "",
      ].join(":");
    }),
  );
}

/** Fields consumed by sumCashExpensesInBounds / OnDay (approval + void + amount + paidOn). */
function expensesMutationFingerprint(expenses: OwnerCommandCenterInput["cashExpenses"]): string {
  return mutationFingerprint(
    expenses
      .map(
        (e) =>
          `${e.id}:${e.amountUgx}:${e.approvalStatus ?? "approved"}:${e.deletedAt ?? ""}:${e.paidOn}`,
      )
      .sort(),
  );
}

/** Fields consumed by adjustmentInBounds + cash-control inflow/outflow totals. */
function adjustmentsMutationFingerprint(
  adjustments: OwnerCommandCenterInput["cashDrawerAdjustments"],
): string {
  return mutationFingerprint(
    adjustments
      .map((a) => `${a.id}:${a.amountUgx}:${a.type}:${a.occurredAt}:${a.deletedAt ?? ""}`)
      .sort(),
  );
}

/**
 * Fields consumed by inventory value, stock KPIs, low-stock, and pharmacy expiry.
 * Archive/removal is identity (id); catalog products have no in-place archived flag.
 */
function productsMutationFingerprint(products: OwnerCommandCenterInput["products"]): string {
  return mutationFingerprint(
    products
      .map(
        (p) =>
          `${p.id}:${p.costPricePerUnitUgx}:${p.stockOnHand}:${p.minimumStockAlert}:${p.expiryDate ?? ""}:${p.buyingPackCostUgx ?? ""}:${p.conversionRate ?? ""}:${p.packCostUnitsDepleted ?? ""}`,
      )
      .sort(),
  );
}

export function buildOwnerCommandCenterFingerprint(input: OwnerCommandCenterInput): string {
  const { bounds, sales, products, shifts, customers, suppliers, debtPayments, stockMovements, purchases } = input;
  return [
    bounds.fromKey,
    bounds.toKey,
    bounds.isSingleDay ? "1d" : "rng",
    salesMutationFingerprint(sales),
    productsMutationFingerprint(products),
    shifts.length,
    customers.length,
    suppliers.length,
    debtPayments.length,
    stockMovements.length,
    input.archivedStockMovements?.length ?? 0,
    purchases.length,
    input.inventoryCountSessions.length,
    adjustmentsMutationFingerprint(input.cashDrawerAdjustments),
    expensesMutationFingerprint(input.cashExpenses),
    input.auditLogs.length,
    input.acknowledgements.length,
    input.syncPendingCount,
    input.syncErrorCount,
    input.expectedCashUgx ?? "na",
    input.pharmacyMode ? "rx" : "std",
    dayCloseMutationFingerprint(input.dayCloses),
    returnsMutationFingerprint(input.returnRecords),
    voidsMutationFingerprint(input.voidRecords),
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
    archivedStockMovements: input.archivedStockMovements,
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
    archivedStockMovements: input.archivedStockMovements,
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
    archivedStockMovements: input.archivedStockMovements,
    suppliers: input.suppliers,
    purchases: input.purchases,
    supplierPayments: input.supplierPayments,
    preferences: input.preferences,
  });
  const snapshotTrimStatus = partial ? buildSnapshotTrimStatus(partial) : "ok";

  const financial = buildFinancialExtended({
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
    dayCloses: input.dayCloses,
    currentPeriod: {
      revenueUgx: overview.revenueUgx,
      profitUgx: overview.profitUgx,
      transactionCount: overview.transactionCount,
      costIncomplete: overview.costIncomplete,
    },
  });

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
      primaryDayKey: dateKeyKampala(new Date()),
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
      expensesPeriodUgx: financial.expensesPeriodUgx,
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
    financial,
  };
}

export function getCachedOwnerCommandCenterBundle(
  input: OwnerCommandCenterInput,
): OwnerCommandCenterBundle {
  const fp = buildOwnerCommandCenterFingerprint(input);
  return getCachedComputation("ownerCommandCenterBundle", fp, () => buildOwnerCommandCenterBundle(input));
}
