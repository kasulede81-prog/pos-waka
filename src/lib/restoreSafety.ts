import { countSalesWithSyncErrors, countUnsyncedSales } from "../offline/cloudSync";
import type { Language } from "../types";

export type RestoreRiskSummary = {
  pendingQueueCount: number;
  unsyncedSales: number;
  syncErrors: number;
  hasRisk: boolean;
};

export function assessRestoreRisk(pendingQueueCount: number): RestoreRiskSummary {
  const unsyncedSales = countUnsyncedSales();
  const syncErrors = countSalesWithSyncErrors();
  const hasRisk = pendingQueueCount > 0 || unsyncedSales > 0 || syncErrors > 0;
  return { pendingQueueCount, unsyncedSales, syncErrors, hasRisk };
}

/**
 * Two-step confirmation before restore. Returns true when the operator confirmed.
 */
export function confirmRestoreWithSafetyChecks(
  lang: Language,
  risk: RestoreRiskSummary,
  t: (lang: Language, key: string) => string,
  tTemplate: (lang: Language, key: string, vars: Record<string, string>) => string,
): boolean {
  if (risk.hasRisk) {
    const detail = tTemplate(lang, "backupRestoreUnsyncedWarning", {
      pending: String(risk.pendingQueueCount),
      unsynced: String(risk.unsyncedSales),
      errors: String(risk.syncErrors),
    });
    if (!window.confirm(detail)) return false;
  }
  if (!window.confirm(t(lang, "backupRestoreConfirm"))) return false;
  if (!window.confirm(t(lang, "backupRestoreFinalConfirm"))) return false;
  return true;
}
