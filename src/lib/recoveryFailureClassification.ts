/**
 * Phase 24.1BB — precise recovery failure categories for UX.
 */

export type RecoveryFailureClass =
  | "core_data_missing"
  | "network_interruption"
  | "validation_failed"
  | "certification_pending"
  | "certification_warning"
  | "reports_unavailable"
  | "analytics_unavailable"
  | "organization_blocked"
  | "unknown";

export type RecoveryFailurePresentation = {
  class: RecoveryFailureClass;
  titleKey: string;
  subKey: string;
  blocking: boolean;
  canRetry: boolean;
  canContinue: boolean;
  canDetails: boolean;
};

const CORE_MISSING = new Set([
  "shop_still_empty",
  "products_not_restored",
  "inventory_catalog_missing",
  "merge_produced_empty_store",
  "RECOVERY_COMPLETED_WITH_EMPTY_STORE",
  "cloud_merge_failed",
]);

const NETWORK = new Set(["cloud_probe_failed", "cloud_snapshot_restore_failed", "cloud_pull_failed"]);

export function classifyRecoveryFailure(
  errorKey: string | null | undefined,
  opts?: { coreUnlocked?: boolean; certificationPending?: boolean },
): RecoveryFailurePresentation {
  const key = errorKey ?? "unknown";

  if (opts?.certificationPending && opts?.coreUnlocked) {
    return {
      class: "certification_pending",
      titleKey: "recoveryCertPendingTitle",
      subKey: "recoveryCertPendingSub",
      blocking: false,
      canRetry: false,
      canContinue: true,
      canDetails: true,
    };
  }

  if (opts?.coreUnlocked) {
    return {
      class: "certification_warning",
      titleKey: "recoveryCertWarningTitle",
      subKey: "recoveryCertWarningSub",
      blocking: false,
      canRetry: true,
      canContinue: true,
      canDetails: true,
    };
  }

  if (key === "organization_blocked") {
    return {
      class: "organization_blocked",
      titleKey: "recoveryOrgBlockedTitle",
      subKey: "recoveryOrgBlockedSub",
      blocking: true,
      canRetry: false,
      canContinue: false,
      canDetails: true,
    };
  }

  if (NETWORK.has(key)) {
    return {
      class: "network_interruption",
      titleKey: "recoveryNetworkTitle",
      subKey: "recoveryNetworkSub",
      blocking: true,
      canRetry: true,
      canContinue: true,
      canDetails: true,
    };
  }

  if (CORE_MISSING.has(key)) {
    return {
      class: "core_data_missing",
      titleKey: "recoveryCoreMissingTitle",
      subKey: "recoveryCoreMissingSub",
      blocking: true,
      canRetry: true,
      canContinue: false,
      canDetails: true,
    };
  }

  if (key.startsWith("entity_count_mismatch_") && !key.includes("products") && !key.includes("customers")) {
    return {
      class: "reports_unavailable",
      titleKey: "recoveryReportsUnavailableTitle",
      subKey: "recoveryReportsUnavailableSub",
      blocking: false,
      canRetry: true,
      canContinue: true,
      canDetails: true,
    };
  }

  return {
    class: "validation_failed",
    titleKey: "recoveryFailedTitle",
    subKey: "recoveryFailedSub",
    blocking: true,
    canRetry: true,
    canContinue: true,
    canDetails: true,
  };
}
