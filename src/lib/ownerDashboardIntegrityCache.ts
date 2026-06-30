/**
 * Single integrity evaluation per owner dashboard refresh — shared by all command-center sections.
 */

import type {
  Customer,
  DayDrawerOpen,
  DebtPayment,
  Product,
  Sale,
  ShiftRecord,
  StockMovement,
} from "../types";
import type { DateFilterBounds } from "./dateFilters";
import { enumerateDaysInBounds } from "./dateFilters";
import { verifyCustomerDebtIntegrity } from "./customerDebtIntegrity";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import {
  collectDayDrawerOpenDiagnostics,
  type DayDrawerOpenDiagnosticsSnapshot,
} from "./dayDrawerOpenDiagnostics";
import { evaluateDebtIntegrityStatus, evaluateInventoryIntegrityStatus } from "./productionReadiness";
import { computeSyncSalesStats } from "../offline/cloudSync";
import { readSyncHealthMeta, type SyncHealthMeta } from "./syncMeta";
import { dateKeyKampala } from "./datesUg";

export type OwnerDashboardIntegritySnapshot = {
  debtIntegrity: ReturnType<typeof verifyCustomerDebtIntegrity>;
  inventoryIntegrity: ReturnType<typeof verifyInventoryIntegrity>;
  debtCheck: ReturnType<typeof evaluateDebtIntegrityStatus>;
  inventoryCheck: ReturnType<typeof evaluateInventoryIntegrityStatus>;
  /** Drawer diagnostics for the latest day in the selected period. */
  drawerDiagnostics: DayDrawerOpenDiagnosticsSnapshot;
  /** Aggregated drawer conflict signals across all days in the period. */
  periodDrawerDuplicateOpens: number;
  periodDrawerDeviceConflicts: number;
  periodDrawerUnsynced: number;
  periodVerificationMismatches: number;
  syncStats: ReturnType<typeof computeSyncSalesStats>;
  syncPendingCount: number;
  syncErrorCount: number;
  syncHealth: SyncHealthMeta;
};

export type BuildIntegritySnapshotInput = {
  bounds: DateFilterBounds;
  customers: Customer[];
  sales: Sale[];
  debtPayments: DebtPayment[];
  products: Product[];
  stockMovements: StockMovement[];
  archivedStockMovements?: StockMovement[];
  dayDrawerOpens: DayDrawerOpen[];
  shifts: ShiftRecord[];
  syncPendingCount: number;
  syncErrorCount: number;
};

export function buildOwnerDashboardIntegritySnapshot(
  input: BuildIntegritySnapshotInput,
): OwnerDashboardIntegritySnapshot {
  const debtIntegrity = verifyCustomerDebtIntegrity(input.customers, input.sales, input.debtPayments, {
    heal: false,
  });
  const inventoryIntegrity = verifyInventoryIntegrity({
    products: input.products,
    movements: input.stockMovements,
    archivedMovements: input.archivedStockMovements,
  });

  const debtCheck = evaluateDebtIntegrityStatus(input.customers, input.sales, input.debtPayments);
  const inventoryCheck = evaluateInventoryIntegrityStatus({
    products: input.products,
    stockMovements: input.stockMovements,
    archivedStockMovements: input.archivedStockMovements,
  });

  const primaryDayKey = input.bounds.toKey;
  const drawerDiagnostics = collectDayDrawerOpenDiagnostics(
    input.dayDrawerOpens,
    input.shifts,
    primaryDayKey,
  );

  let periodDrawerDuplicateOpens = 0;
  let periodDrawerDeviceConflicts = 0;
  let periodDrawerUnsynced = 0;
  let periodVerificationMismatches = 0;

  const days = enumerateDaysInBounds(input.bounds);
  for (const dayKey of days) {
    const diag = collectDayDrawerOpenDiagnostics(input.dayDrawerOpens, input.shifts, dayKey);
    periodDrawerDuplicateOpens += diag.duplicateOpenCount;
    periodDrawerDeviceConflicts += diag.conflictingDeviceCount > 1 ? diag.conflictingDeviceCount : 0;
    periodVerificationMismatches += diag.verificationMismatchCount;
  }
  periodDrawerUnsynced = input.dayDrawerOpens.filter((r) => !r.deletedAt && r.pendingSync).length;

  const syncStats = computeSyncSalesStats(input.sales);
  const syncHealth = readSyncHealthMeta();

  return {
    debtIntegrity,
    inventoryIntegrity,
    debtCheck,
    inventoryCheck,
    drawerDiagnostics,
    periodDrawerDuplicateOpens,
    periodDrawerDeviceConflicts,
    periodDrawerUnsynced,
    periodVerificationMismatches,
    syncStats,
    syncPendingCount: input.syncPendingCount,
    syncErrorCount: input.syncErrorCount,
    syncHealth,
  };
}

/** Shift accountability stats from full history (not period-filtered). */
export function buildHistoricalShiftStats(shifts: ShiftRecord[]): Map<
  string,
  {
    lifetimeShortageCount: number;
    lifetimeShortageUgx: number;
    shortageCount30d: number;
    shortageUgx30d: number;
    overageCount: number;
    cumulativeOverageUgx: number;
    floatMismatchCount: number;
  }
> {
  const cutoffKey = dateKeyKampala(new Date(Date.now() - 30 * 86400000));
  const byUser = new Map<
    string,
    {
      lifetimeShortageCount: number;
      lifetimeShortageUgx: number;
      shortageCount30d: number;
      shortageUgx30d: number;
      overageCount: number;
      cumulativeOverageUgx: number;
      floatMismatchCount: number;
    }
  >();

  const touch = (uid: string) => {
    const id = uid || "unknown";
    if (!byUser.has(id)) {
      byUser.set(id, {
        lifetimeShortageCount: 0,
        lifetimeShortageUgx: 0,
        shortageCount30d: 0,
        shortageUgx30d: 0,
        overageCount: 0,
        cumulativeOverageUgx: 0,
        floatMismatchCount: 0,
      });
    }
    return byUser.get(id)!;
  };

  for (const sh of shifts) {
    const uid = sh.actorUserId || "unknown";
    const row = touch(uid);
    const dayKey = dateKeyKampala(sh.startAt);
    const in30d = dayKey >= cutoffKey;

    const diff = sh.cashDifferenceUgx;
    if (diff != null && diff < 0) {
      row.lifetimeShortageCount += 1;
      row.lifetimeShortageUgx += Math.abs(diff);
      if (in30d) {
        row.shortageCount30d += 1;
        row.shortageUgx30d += Math.abs(diff);
      }
    } else if (diff != null && diff > 0) {
      row.overageCount += 1;
      row.cumulativeOverageUgx += diff;
    }

    if (sh.verificationVarianceUgx != null && sh.verificationVarianceUgx !== 0) {
      row.floatMismatchCount += 1;
    }
  }

  return byUser;
}
