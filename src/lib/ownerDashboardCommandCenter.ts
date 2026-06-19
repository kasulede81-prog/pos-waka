/**
 * Cached owner command-center bundle — single integrity pass per refresh.
 */

import { partitionAttentionByAck } from "./ownerAlertAcknowledgement";
import { getCachedComputation } from "./computationResultCache";
import { buildRevenueSalesIndex } from "./financialMetrics";
import {
  buildAttentionCenter,
  buildCashControlSnapshot,
  buildFinancialSnapshot,
  buildIntegritySignals,
  buildInventoryRiskSnapshot,
  buildShiftAccountabilityRows,
  type OwnerCommandCenterInput,
} from "./ownerCommandCenter";
import {
  buildHistoricalShiftStats,
  buildOwnerDashboardIntegritySnapshot,
  type OwnerDashboardIntegritySnapshot,
} from "./ownerDashboardIntegrityCache";

export type OwnerCommandCenterBundle = {
  integrity: OwnerDashboardIntegritySnapshot;
  attention: ReturnType<typeof buildAttentionCenter>;
  attentionReviewed: ReturnType<typeof buildAttentionCenter>;
  integritySignals: ReturnType<typeof buildIntegritySignals>;
  shiftRows: ReturnType<typeof buildShiftAccountabilityRows>;
  cash: ReturnType<typeof buildCashControlSnapshot>;
  inventory: ReturnType<typeof buildInventoryRiskSnapshot>;
  financial: ReturnType<typeof buildFinancialSnapshot>;
};

export function buildOwnerCommandCenterFingerprint(input: OwnerCommandCenterInput): string {
  const { bounds, sales, products, shifts, customers, suppliers, debtPayments, stockMovements } = input;
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
    input.inventoryCountSessions.length,
    input.cashDrawerAdjustments.length,
    input.cashExpenses.length,
    input.ownerAlertsResolved.length,
    input.riskCards.length,
    input.acknowledgements.length,
    input.syncPendingCount,
    input.syncErrorCount,
    input.expectedCashUgx,
    input.pharmacyMode ? "rx" : "std",
  ].join(":");
}

export function buildOwnerCommandCenterBundle(input: OwnerCommandCenterInput): OwnerCommandCenterBundle {
  const historicalStats = buildHistoricalShiftStats(input.shifts);
  const salesIndex = buildRevenueSalesIndex(input.sales, input.returnRecords);

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

  const attentionRaw = buildAttentionCenter(input, integrity);
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

  return {
    integrity,
    attention,
    attentionReviewed,
    integritySignals: buildIntegritySignals(integrity, input.bounds),
    shiftRows: buildShiftAccountabilityRows(input.shifts, input.bounds, input.lang, historicalStats),
    cash: buildCashControlSnapshot({
      bounds: input.bounds,
      primaryDayKey: input.bounds.toKey,
      dayDrawerOpens: input.dayDrawerOpens,
      dayCloses: input.dayCloses,
      shifts: input.shifts,
      cashDrawerAdjustments: input.cashDrawerAdjustments,
      expectedCashUgx: input.expectedCashUgx,
      lang: input.lang,
    }),
    inventory: buildInventoryRiskSnapshot(input.products, input.inventoryCountSessions, input.pharmacyMode),
    financial: buildFinancialSnapshot({
      sales: input.sales,
      customers: input.customers,
      suppliers: input.suppliers,
      debtPayments: input.debtPayments,
      cashExpenses: input.cashExpenses,
      bounds: input.bounds,
      salesIndex,
    }),
  };
}

export function getCachedOwnerCommandCenterBundle(
  input: OwnerCommandCenterInput,
): OwnerCommandCenterBundle {
  const fp = buildOwnerCommandCenterFingerprint(input);
  return getCachedComputation("ownerCommandCenterBundle", fp, () => buildOwnerCommandCenterBundle(input));
}
