/**
 * First-time owner / device classification for startup and recovery gating.
 * Does NOT use owner_onboarding_status.complete — only local device evidence.
 */

import { getActiveAccountKey } from "../offline/accountScope";
import { isLocalShopDataEmpty } from "./cloudSnapshotSync";
import { isShopOnboardingComplete } from "./onboardingState";
import { readSyncCheckpoints } from "./syncCheckpoints";
import { usePosStore } from "../store/usePosStore";
import { withTimeout } from "./promiseTimeout";
import { isRecoveryOfflineBypassActive, logStartupPhase } from "./startupDiagnostics";
import { hasSupabaseConfig } from "./supabase";
import { isCloudRecoveryLockActive, readLastCloudRecoveryDiagnostics } from "./cloudRecoverySession";

const FIRST_TIME_OWNER_MARKER_PREFIX = "waka.firstTimeOwner.v1:";

export type DeviceClassification = {
  /** No prior local POS data or bootstrap on this device/account namespace. */
  isFirstTimeOnDevice: boolean;
  localShopDataEmpty: boolean;
  onboardingWizardComplete: boolean;
  bootstrapSyncComplete: boolean;
  hasFirstTimeOwnerMarker: boolean;
  hadPriorRecoverySession: boolean;
  reasons: string[];
};

export type RecoveryApplicability = {
  skipRecovery: boolean;
  recoveryApplicable: boolean;
  reason: string;
  classification: DeviceClassification;
};

export function markFirstTimeOwnerOnDevice(userId: string): void {
  if (!userId) return;
  try {
    globalThis.localStorage?.setItem(
      `${FIRST_TIME_OWNER_MARKER_PREFIX}${userId}`,
      JSON.stringify({ markedAt: Date.now() }),
    );
  } catch {
    /* quota */
  }
}

export function clearFirstTimeOwnerMarker(userId: string): void {
  if (!userId) return;
  try {
    globalThis.localStorage?.removeItem(`${FIRST_TIME_OWNER_MARKER_PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}

export function hasFirstTimeOwnerMarker(userId: string | undefined | null): boolean {
  if (!userId) return false;
  try {
    return globalThis.localStorage?.getItem(`${FIRST_TIME_OWNER_MARKER_PREFIX}${userId}`) != null;
  } catch {
    return false;
  }
}

export function userIdFromAccountKey(accountKey: string | null | undefined): string | null {
  if (!accountKey?.startsWith("sb:")) return null;
  const id = accountKey.slice(3).trim();
  return id.length > 0 ? id : null;
}

function hadPriorRecoverySessionOnDevice(): boolean {
  const last = readLastCloudRecoveryDiagnostics();
  if (!last?.lastRecoveryAt) return false;
  return last.status === "complete" || last.status === "failed";
}

/** Classify this device/account namespace using local evidence only. */
export function classifyOwnerDeviceLocally(userId?: string | null): DeviceClassification {
  const prefs = usePosStore.getState().preferences;
  const localShopDataEmpty = isLocalShopDataEmpty();
  const onboardingWizardComplete = isShopOnboardingComplete(prefs);
  const bootstrapSyncComplete = readSyncCheckpoints().bootstrapComplete;
  const marker = hasFirstTimeOwnerMarker(userId);
  const hadPriorRecoverySession = hadPriorRecoverySessionOnDevice();

  const reasons: string[] = [];
  if (localShopDataEmpty) reasons.push("local_shop_data_empty");
  else reasons.push("local_operational_data_present");
  if (!onboardingWizardComplete) reasons.push("onboarding_wizard_incomplete");
  else reasons.push("onboarding_wizard_complete");
  if (!bootstrapSyncComplete) reasons.push("bootstrap_sync_incomplete");
  else reasons.push("bootstrap_sync_complete");
  if (marker) reasons.push("first_time_owner_marker");
  if (hadPriorRecoverySession) reasons.push("prior_recovery_session");

  const isFirstTimeOnDevice =
    localShopDataEmpty &&
    !onboardingWizardComplete &&
    !bootstrapSyncComplete &&
    !hadPriorRecoverySession;

  return {
    isFirstTimeOnDevice,
    localShopDataEmpty,
    onboardingWizardComplete,
    bootstrapSyncComplete,
    hasFirstTimeOwnerMarker: marker,
    hadPriorRecoverySession,
    reasons,
  };
}

/**
 * Decide whether cloud recovery may run for the current owner on this device.
 * Brand-new owners (marker or empty device with no cloud business data) skip recovery.
 */
export async function evaluateRecoveryApplicability(userId?: string | null): Promise<RecoveryApplicability> {
  const classification = classifyOwnerDeviceLocally(userId);

  logStartupPhase("device_classification", {
    userId: userId ?? null,
    accountKey: getActiveAccountKey(),
    ...classification,
  });

  if (classification.hasFirstTimeOwnerMarker) {
    const result: RecoveryApplicability = {
      skipRecovery: true,
      recoveryApplicable: false,
      reason: "first_time_owner_marker",
      classification,
    };
    logStartupPhase("recovery_applicable", { applicable: false, reason: result.reason });
    return result;
  }

  if (!classification.isFirstTimeOnDevice) {
    const result: RecoveryApplicability = {
      skipRecovery: false,
      recoveryApplicable: true,
      reason: "prior_local_device_evidence",
      classification,
    };
    logStartupPhase("recovery_applicable", { applicable: true, reason: result.reason });
    return result;
  }

  if (isRecoveryOfflineBypassActive()) {
    const result: RecoveryApplicability = {
      skipRecovery: true,
      recoveryApplicable: false,
      reason: "recovery_offline_bypass",
      classification,
    };
    logStartupPhase("recovery_applicable", { applicable: false, reason: result.reason });
    return result;
  }

  const { shouldRequireRecoveryLock } = await import("./postAuthCloudHydrate");
  const lockRequired = await withTimeout(shouldRequireRecoveryLock().catch(() => false), 8000, false);

  if (!lockRequired) {
    const result: RecoveryApplicability = {
      skipRecovery: true,
      recoveryApplicable: false,
      reason: "no_cloud_business_data",
      classification,
    };
    logStartupPhase("recovery_applicable", { applicable: false, reason: result.reason });
    return result;
  }

  const result: RecoveryApplicability = {
    skipRecovery: false,
    recoveryApplicable: true,
    reason: "existing_shop_second_device",
    classification,
  };
  logStartupPhase("recovery_applicable", { applicable: true, reason: result.reason });
  return result;
}

/** True when PosDataProvider should enter gated cloud recovery. */
export async function shouldRunCloudRecoveryForAccount(userId?: string | null): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  if (isRecoveryOfflineBypassActive()) return false;
  const accountKey = getActiveAccountKey();
  if (!accountKey?.startsWith("sb:")) return false;

  const applicability = await evaluateRecoveryApplicability(userId);
  if (applicability.skipRecovery) {
    if (isCloudRecoveryLockActive()) {
      const { resetCloudRecoverySessionForRetry } = await import("./cloudRecoverySession");
      resetCloudRecoverySessionForRetry();
    }
    return false;
  }

  return applicability.recoveryApplicable;
}

export function isOnboardingWizardRequiredLocally(): boolean {
  return !isShopOnboardingComplete(usePosStore.getState().preferences);
}

export function resolvePostAuthDestination(userId: string): string {
  if (hasFirstTimeOwnerMarker(userId)) return "/onboarding";
  if (isOnboardingWizardRequiredLocally()) return "/onboarding";
  return "/";
}

export function logOnboardingRequired(userId?: string | null): void {
  const required = isOnboardingWizardRequiredLocally();
  logStartupPhase("onboarding_required", {
    required,
    reason: required ? "shop_onboarding_wizard_incomplete" : "shop_onboarding_wizard_complete",
    userId: userId ?? null,
    hasFirstTimeOwnerMarker: hasFirstTimeOwnerMarker(userId),
  });
}
