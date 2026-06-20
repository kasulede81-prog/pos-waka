/**
 * Recovery lock gate — when to block the app and how to validate completion.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import { needsCloudRecoveryBootstrap } from "./cloudAuthorityAudit";
import { isLocalShopDataEmpty, probeCloudShopHasData } from "./cloudSnapshotSync";
import { hasSupabaseConfig, supabase } from "./supabase";
import { readSyncCheckpoints } from "./syncCheckpoints";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";

export type CloudShopProbe = {
  hasSnapshot: boolean;
  snapshotUpdatedAt: string | null;
  hasCloudProducts: boolean;
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
};

/** Strict gate after hydrate — required before unlocking the app. */
export function validateRecoveryCompletionGate(
  probe: CloudShopProbe,
  validation: CloudRecoveryValidationResult,
): RecoveryCompletionGateResult {
  const failures: string[] = [];
  const c = validation.counts;
  const cp = readSyncCheckpoints();

  if (probe.hasCloudProducts && c.products === 0) {
    failures.push("products_not_restored");
  }

  const cloudExpectedData = probe.hasCloudProducts || probe.hasSnapshot;
  if (cloudExpectedData && c.products === 0 && c.sales === 0 && c.customers === 0) {
    failures.push("shop_still_empty");
  }

  if (!cp.bootstrapComplete) {
    failures.push("bootstrap_incomplete");
  }

  if (cloudExpectedData && c.products === 0) {
    failures.push("inventory_catalog_missing");
  }

  const criticalValidation = validation.failures.filter((f) => f.severity === "critical");
  if (criticalValidation.length > 0) {
    failures.push("integrity_critical");
  }

  const ok = failures.length === 0;
  let message = "Recovery validation passed";
  if (!ok) {
    if (failures.includes("shop_still_empty")) {
      message = "Cloud shop data was not restored to this device";
    } else if (failures.includes("bootstrap_incomplete")) {
      message = "Cloud bootstrap did not complete";
    } else if (failures.includes("products_not_restored")) {
      message = "Products were not downloaded from cloud";
    } else if (failures.includes("integrity_critical")) {
      message = "Data integrity check failed after recovery";
    } else {
      message = "Recovery validation failed";
    }
  }

  return { ok, message, failures };
}
