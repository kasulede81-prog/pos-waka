/**
 * Recovery lock gate — when to block the app and how to validate completion.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import { needsCloudRecoveryBootstrap } from "./cloudAuthorityAudit";
import { isLocalShopDataEmpty, probeCloudShopHasData } from "./cloudSnapshotSync";
import type { CloudTrustCertificationReport } from "./cloudTrustCenter";
import { hasSupabaseConfig, supabase } from "./supabase";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import {
  entityCountMismatchBlocksRecovery,
  isBlockingRecoveryCertificationFailure,
} from "./recoveryEntityParity";

export type CloudShopProbe = {
  hasSnapshot: boolean;
  snapshotUpdatedAt: string | null;
  hasCloudProducts: boolean;
  snapshotRowFound: boolean;
  snapshotContainsCoreData: boolean;
};

export type CloudProbeResult =
  | { status: "success"; probe: CloudShopProbe }
  | { status: "failed"; error: string };

export type RecoveryLockEvaluation = {
  applicable: boolean;
  lockRequired: boolean;
  localEmpty: boolean;
  probeResult: CloudProbeResult | null;
};

export function probeIndicatesCloudBusiness(probe: CloudShopProbe): boolean {
  return probe.hasSnapshot || probe.hasCloudProducts;
}

/** Probe cloud shop data — never treat errors as "no cloud data". */
export async function resolveCloudShopProbe(): Promise<CloudProbeResult> {
  try {
    const probe = await probeCloudShopHasData();
    return { status: "success", probe };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cloud probe failed";
    return { status: "failed", error: message };
  }
}

/**
 * Evaluate whether recovery lock is required.
 * Fail closed: probe errors keep lockRequired true when recovery may be needed.
 */
export async function evaluateCloudRecoveryLock(): Promise<RecoveryLockEvaluation> {
  const notApplicable = (localEmpty: boolean): RecoveryLockEvaluation => ({
    applicable: false,
    lockRequired: false,
    localEmpty,
    probeResult: null,
  });

  if (!hasSupabaseConfig) return notApplicable(false);

  const accountKey = getActiveAccountKey();
  if (!accountKey?.startsWith("sb:")) return notApplicable(false);

  const localEmpty = isLocalShopDataEmpty();
  const needsBootstrap = needsCloudRecoveryBootstrap();
  if (!localEmpty && !needsBootstrap) return notApplicable(localEmpty);

  if (!supabase) {
    return { applicable: true, lockRequired: true, localEmpty, probeResult: null };
  }

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return notApplicable(localEmpty);

  const { resolvePrimaryOrganizationForUser } = await import("./fetchShopSubscription");
  const org = await resolvePrimaryOrganizationForUser(userId).catch(() => null);
  if (!org?.shopId) return notApplicable(localEmpty);

  const probeResult = await resolveCloudShopProbe();

  if (probeResult.status === "failed") {
    return { applicable: true, lockRequired: true, localEmpty, probeResult };
  }

  return {
    applicable: true,
    lockRequired: probeIndicatesCloudBusiness(probeResult.probe),
    localEmpty,
    probeResult,
  };
}

/** Org exists in cloud + local empty or bootstrap incomplete + cloud has recoverable data (or probe failed — fail closed). */
export async function shouldRequireRecoveryLock(): Promise<boolean> {
  const evaluation = await evaluateCloudRecoveryLock();
  return evaluation.lockRequired;
}

export type RecoveryCompletionGateResult = {
  ok: boolean;
  message: string;
  failures: string[];
  warnings: string[];
  inventoryWarnings: boolean;
};

const NON_BLOCKING_CERT_FAILURES = new Set([
  "inventory_integrity_warning",
  "stock_movement_count_mismatch",
]);

/** Strict gate after hydrate — required before unlocking the app. Bootstrap is marked after this passes. */
export function validateRecoveryCompletionGate(
  probe: CloudShopProbe,
  validation: CloudRecoveryValidationResult,
  opts?: { certification?: CloudTrustCertificationReport | null },
): RecoveryCompletionGateResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const c = validation.counts;

  const cloudExpectedData = probe.hasCloudProducts || probe.hasSnapshot;
  const hasCoreData = c.products > 0 || c.sales > 0 || c.customers > 0;

  if (cloudExpectedData && !hasCoreData) {
    failures.push("shop_still_empty");
  }

  if (probe.hasCloudProducts && c.products === 0) {
    failures.push("products_not_restored");
  }

  if (cloudExpectedData && c.products === 0) {
    failures.push("inventory_catalog_missing");
  }

  const criticalValidation = validation.failures.filter((f) => f.severity === "critical");
  if (criticalValidation.length > 0) {
    failures.push("integrity_critical");
  }

  const certification = opts?.certification;
  if (certification) {
    if (certification.inventoryIntegrityStatus === "critical") {
      failures.push("inventory_integrity_mismatch");
    } else if (certification.inventoryIntegrityStatus === "warning") {
      warnings.push("inventory_integrity_warning");
    }
    if (!certification.recoveryInvariantPassed) {
      failures.push("recovery_invariant_failed");
    }
    for (const f of certification.failures) {
      if (NON_BLOCKING_CERT_FAILURES.has(f)) {
        if (!warnings.includes(f)) warnings.push(f);
        continue;
      }
      if (f === "inventory_integrity_mismatch" && certification.inventoryIntegrityStatus !== "critical") {
        continue;
      }
      if (!isBlockingRecoveryCertificationFailure(f)) {
        if (!warnings.includes(f)) warnings.push(f);
        continue;
      }
      if (!failures.includes(f)) failures.push(f);
    }
    for (const row of certification.rows) {
      if (row.cloudCount !== null && row.cloudError === null && row.cloudCount !== row.localCount) {
        const key = `entity_count_mismatch_${row.id}`;
        if (entityCountMismatchBlocksRecovery(row.id)) {
          if (!failures.includes(key)) failures.push(key);
        } else if (!warnings.includes(key)) {
          warnings.push(key);
        }
      }
    }
  }

  const inventoryWarnings =
    warnings.includes("inventory_integrity_warning") ||
    validation.inventoryIntegrityStatus === "warning" ||
    validation.failures.some((f) => f.code === "inventory_integrity" && f.severity === "warning");

  const hasRecoveryWarnings = inventoryWarnings || warnings.length > 0;

  const ok = failures.length === 0;
  let message = "Recovery validation passed";
  if (!ok) {
    if (failures.includes("shop_still_empty")) {
      message = "Cloud shop data was not restored to this device";
    } else if (failures.some((f) => f.startsWith("entity_count_mismatch_"))) {
      message = "Cloud and local entity counts do not match";
    } else if (failures.includes("inventory_integrity_mismatch")) {
      message = "Inventory does not match after recovery";
    } else if (failures.includes("products_not_restored")) {
      message = "Products were not downloaded from cloud";
    } else if (failures.includes("integrity_critical")) {
      message = "Data integrity check failed after recovery";
    } else {
      message = "Recovery validation failed";
    }
  } else if (hasRecoveryWarnings) {
    message = "Recovery completed with warnings";
  }

  return { ok, message, failures, warnings, inventoryWarnings };
}
