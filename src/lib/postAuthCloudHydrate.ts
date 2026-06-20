import { getDeviceOnline } from "./deviceOnline";
import { shouldPausePosBackgroundWork } from "./backgroundWorkPolicy";
import { runWhenIdle } from "./uiYield";
import { hasSupabaseConfig, supabase } from "./supabase";
import { usePosStore } from "../store/usePosStore";
import {
  isLocalShopDataEmpty,
  restoreShopFromCloudSnapshot,
  uploadShopCloudSnapshot,
} from "./cloudSnapshotSync";
import { needsCloudRecoveryBootstrap } from "./cloudAuthorityAudit";
import { captureAppException } from "./crashReporting";
import { reportSyncIssue } from "./monitoring";
import {
  beginCloudRecoverySession,
  completeCloudRecoverySession,
  failCloudRecoverySession,
  getCloudRecoverySession,
  reportRecoveryStep,
  resetCloudRecoverySessionForRetry,
  syncRecoveryRestoredCountsFromStore,
  type CloudRecoveryEntityCounts,
} from "./cloudRecoverySession";
import {
  evaluateCloudRecoveryLock,
  probeIndicatesCloudBusiness,
  resolveCloudShopProbe,
  shouldRequireRecoveryLock,
  validateRecoveryCompletionGate,
  type CloudShopProbe,
} from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import { ensureRecoverySessionActor } from "./recoverySystemActor";
import { recordStartupRecoveryFailure } from "./startupDiagnostics";

const HYDRATE_COOLDOWN_MS = 120_000;
const HYDRATE_FORCE_COOLDOWN_MS = 30_000;

let hydrateInFlight: Promise<void> | null = null;
let gatedRecoveryInFlight: Promise<CloudRecoveryGatedResult> | null = null;
let lastHydrateFinishedAt = 0;

export type CloudRecoveryGatedResult = {
  success: boolean;
  validation: CloudRecoveryValidationResult | null;
  error?: string;
  errorKey?: string;
  /** True when cloud probe failed — app must stay locked (fail closed). */
  probeFailed?: boolean;
};

async function waitForPosStoreHydrated(timeoutMs = 30_000): Promise<boolean> {
  if (usePosStore.getState()._hydrated) return true;
  return new Promise((resolve) => {
    let unsub: (() => void) | null = null;
    const timeoutId = window.setTimeout(() => {
      unsub?.();
      resolve(usePosStore.getState()._hydrated);
    }, timeoutMs);
    unsub = usePosStore.subscribe((state) => {
      if (state._hydrated) {
        window.clearTimeout(timeoutId);
        unsub?.();
        resolve(true);
      }
    });
  });
}

function readStoreRecoveryCounts(): CloudRecoveryEntityCounts {
  const s = usePosStore.getState();
  const shifts = s.preferences.shifts ?? [];
  const cashRecords =
    s.cashDrawerAdjustments.length + s.dayDrawerOpens.length + s.cashExpenses.length;
  return {
    products: s.products.length,
    sales: s.sales.length,
    customers: s.customers.length,
    inventory: s.inventoryCountSessions.length > 0 ? s.inventoryCountSessions.length : s.products.length,
    shifts: shifts.length,
    dayCloses: s.dayCloses.length,
    cashRecords,
  };
}

function syncRestoredCountsFromStore(): void {
  syncRecoveryRestoredCountsFromStore(readStoreRecoveryCounts());
}

function reportRecoveryStepsFromStore(): void {
  const counts = readStoreRecoveryCounts();
  reportRecoveryStep("products", { products: counts.products });
  reportRecoveryStep("sales", { sales: counts.sales });
  reportRecoveryStep("customers", { customers: counts.customers });
  reportRecoveryStep("inventory", { inventory: counts.inventory });
  reportRecoveryStep("shifts", { shifts: counts.shifts });
  reportRecoveryStep("day_closes", { dayCloses: counts.dayCloses });
  reportRecoveryStep("cash", { cashRecords: counts.cashRecords });
}

function recoveryErrorFromUnknown(err: unknown, fallbackKey: string): { message: string; errorKey: string } {
  if (err instanceof Error) {
    const key = err.message.trim() || fallbackKey;
    return { message: err.message, errorKey: key };
  }
  return { message: fallbackKey, errorKey: fallbackKey };
}

async function runCloudDataRestore(opts: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
  recoveryMode?: boolean;
  cloudProbe?: CloudShopProbe | null;
}): Promise<void> {
  const localEmpty = isLocalShopDataEmpty();
  const needsBootstrap = needsCloudRecoveryBootstrap();
  const force = opts?.forcePull === true;
  const cloudProbe = opts?.cloudProbe ?? null;
  const cloudHasData = cloudProbe?.hasSnapshot || cloudProbe?.hasCloudProducts;
  const shouldRecoverFromCloud = force || localEmpty || needsBootstrap || cloudHasData;
  if (!shouldRecoverFromCloud) return;

  const { pullCloudAndMergeIntoStore } = await import("../offline/cloudSync");
  const cloudRecovery = opts?.recoveryMode === true;
  const onStep = cloudRecovery
    ? (
        step: import("./cloudRecoverySession").CloudRecoveryStepId,
        counts?: Partial<import("./cloudRecoverySession").CloudRecoveryEntityCounts>,
      ) => {
        reportRecoveryStep(step, counts);
      }
    : undefined;

  if (localEmpty) {
    if (cloudRecovery) {
      reportRecoveryStep("snapshot");
    }

    let restored = false;
    try {
      restored = await restoreShopFromCloudSnapshot(opts?.onProgress, { cloudRecovery });
    } catch (err) {
      const { message, errorKey } = recoveryErrorFromUnknown(err, "cloud_snapshot_restore_failed");
      if (cloudRecovery) {
        failCloudRecoverySession(message, null, errorKey);
        recordStartupRecoveryFailure(message, errorKey);
      }
      throw err;
    }

    if (restored) {
      syncRestoredCountsFromStore();
      if (cloudRecovery) {
        reportRecoveryStepsFromStore();
      }
      const { applyShopRecoverySignalsForCurrentShop } = await import("./shopRecoverySignals");
      await applyShopRecoverySignalsForCurrentShop().catch(() => undefined);
      return;
    }

    const merged = await pullCloudAndMergeIntoStore({
      forceFull: true,
      onRecoveryStep: onStep,
      cloudRecovery,
    });
    if (!merged) {
      if (cloudRecovery) {
        const errorKey = "cloud_merge_failed";
        const message = "Cloud data merge did not complete";
        failCloudRecoverySession(message, null, errorKey);
        recordStartupRecoveryFailure(message, errorKey);
        throw new Error(errorKey);
      }
      return;
    }
    syncRestoredCountsFromStore();
    return;
  }

  if (needsBootstrap || force) {
    const merged = await pullCloudAndMergeIntoStore({
      forceFull: true,
      onRecoveryStep: onStep,
      cloudRecovery,
    });
    if (!merged) {
      if (cloudRecovery) {
        const errorKey = "cloud_merge_failed";
        failCloudRecoverySession("Cloud data merge did not complete", null, errorKey);
        recordStartupRecoveryFailure("Cloud data merge did not complete", errorKey);
        throw new Error(errorKey);
      }
      return;
    }
    syncRestoredCountsFromStore();
  }
}

async function runHydrateAccountFromCloud(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
  recoveryMode?: boolean;
  cloudProbe?: CloudShopProbe | null;
}): Promise<void> {
  const { withGlobalSyncMutex } = await import("./globalSyncMutex");
  return withGlobalSyncMutex("hydrateAccountFromCloud", () => runHydrateAccountFromCloudInner(opts));
}

async function runHydrateAccountFromCloudInner(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
  recoveryMode?: boolean;
  cloudProbe?: CloudShopProbe | null;
}): Promise<void> {
  if (!hasSupabaseConfig) return;

  await waitForPosStoreHydrated();

  const { data } = await supabase!.auth.getSession();
  const userId = data.session?.user?.id ?? null;
  const { getActiveAccountKey } = await import("../offline/accountScope");
  const accountKey = getActiveAccountKey();
  const {
    assertOrganizationOperationsAllowed,
    refreshOrganizationDeletionState,
    isOrganizationBlocked,
  } = await import("./organizationDeletionState");

  if (userId && accountKey) {
    await refreshOrganizationDeletionState(userId, accountKey);
  }
  if (isOrganizationBlocked(accountKey)) {
    if (opts?.recoveryMode) {
      failCloudRecoverySession("Organization is not available", null, "organization_blocked");
      recordStartupRecoveryFailure("Organization is not available", "organization_blocked");
    }
    throw new Error("organization_blocked");
  }

  try {
    await assertOrganizationOperationsAllowed({ userId, accountKey });
  } catch (err) {
    if (opts?.recoveryMode) {
      const { message, errorKey } = recoveryErrorFromUnknown(err, "organization_blocked");
      failCloudRecoverySession(message, null, errorKey);
      recordStartupRecoveryFailure(message, errorKey);
    }
    throw err;
  }

  if (opts?.recoveryMode) {
    const actorResult = await ensureRecoverySessionActor();
    if (!actorResult.ok) {
      failCloudRecoverySession(actorResult.message, null, actorResult.errorKey);
      recordStartupRecoveryFailure(actorResult.message, actorResult.errorKey);
      throw new Error(actorResult.errorKey);
    }
    reportRecoveryStep("probing");
  }

  const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
  await hydrateLocalShopProfileFromCloud().catch(() => undefined);

  let cloudProbe = opts?.cloudProbe ?? null;
  if (!cloudProbe && isLocalShopDataEmpty()) {
    const probeResult = await resolveCloudShopProbe();
    cloudProbe = probeResult.status === "success" ? probeResult.probe : null;
  }

  const { syncShopWithCloud, pushShopPendingToCloud } = await import("../offline/cloudSync");
  const localEmpty = isLocalShopDataEmpty();
  const needsBootstrap = needsCloudRecoveryBootstrap();
  const force = opts?.forcePull === true;
  const cloudHasData = cloudProbe?.hasSnapshot || cloudProbe?.hasCloudProducts;
  const shouldRecoverFromCloud = force || localEmpty || needsBootstrap || cloudHasData;

  if (shouldRecoverFromCloud) {
    await runCloudDataRestore({ ...opts, cloudProbe });
  } else if (getDeviceOnline()) {
    await syncShopWithCloud({ pull: false }).catch(() => undefined);
  }

  if (getDeviceOnline() && shouldRecoverFromCloud && !opts?.recoveryMode) {
    await pushShopPendingToCloud().catch(() => undefined);
    const { isNativeApp } = await import("./nativeApp");
    runWhenIdle(() => void uploadShopCloudSnapshot().catch(() => false), isNativeApp() ? 12_000 : 3000);
  }

  if (!opts?.recoveryMode) {
    try {
      const { buildCloudRecoverySimulationReport, recordCloudRecoveryValidation } = await import(
        "./cloudRecoveryValidator"
      );
      recordCloudRecoveryValidation(buildCloudRecoverySimulationReport());
    } catch {
      /* non-blocking */
    }
  }
}

/**
 * P0 gated recovery — blocks app until hydrate + validation pass.
 * No snapshot upload until validation succeeds.
 */
export async function runCloudRecoveryGated(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<CloudRecoveryGatedResult> {
  if (gatedRecoveryInFlight) return gatedRecoveryInFlight;

  gatedRecoveryInFlight = (async (): Promise<CloudRecoveryGatedResult> => {
    if (!hasSupabaseConfig) {
      return { success: true, validation: null };
    }

    const lockEval = await evaluateCloudRecoveryLock();
    if (!lockEval.lockRequired) {
      return { success: true, validation: null };
    }

    beginCloudRecoverySession();
    reportRecoveryStep("probing");

    const probeResult =
      lockEval.probeResult?.status === "success"
        ? lockEval.probeResult
        : await resolveCloudShopProbe();

    if (probeResult.status === "failed") {
      failCloudRecoverySession(probeResult.error, null, "cloud_probe_failed");
      recordStartupRecoveryFailure(probeResult.error, "cloud_probe_failed");
      return { success: false, validation: null, error: probeResult.error, errorKey: "cloud_probe_failed", probeFailed: true };
    }

    if (!probeIndicatesCloudBusiness(probeResult.probe)) {
      resetCloudRecoverySessionForRetry();
      return { success: true, validation: null };
    }

    const probe = probeResult.probe;

    try {
      await runHydrateAccountFromCloudInner({
        forcePull: opts?.forcePull ?? true,
        onProgress: opts?.onProgress,
        recoveryMode: true,
        cloudProbe: probe,
      });

      reportRecoveryStep("validation");
      syncRestoredCountsFromStore();

      const { buildCloudRecoverySimulationReport, recordCloudRecoveryValidation } = await import(
        "./cloudRecoveryValidator"
      );
      const validation = buildCloudRecoverySimulationReport();
      recordCloudRecoveryValidation(validation);

      const gate = validateRecoveryCompletionGate(probe, validation);
      if (!gate.ok) {
        const { clearBootstrapSyncComplete } = await import("./syncCheckpoints");
        clearBootstrapSyncComplete();
        failCloudRecoverySession(gate.message, validation, gate.failures[0] ?? "recovery_validation_failed");
        recordStartupRecoveryFailure(gate.message, gate.failures[0] ?? "recovery_validation_failed");
        return { success: false, validation, error: gate.message, errorKey: gate.failures[0] };
      }

      const { markBootstrapSyncComplete } = await import("./syncCheckpoints");
      markBootstrapSyncComplete();

      const s = usePosStore.getState();
      const { buildRecoveryCompletenessReport } = await import("./cloudRecoveryCompleteness");
      const { wasLastSalesPullTruncated } = await import("../offline/cloudSync");
      const completeness = buildRecoveryCompletenessReport({
        validation,
        probe,
        stockMovements: s.stockMovements.length,
        inventoryCountSessions: s.inventoryCountSessions.length,
        archivedSales: s.archivedSales.length,
        salesPullTruncated: wasLastSalesPullTruncated(),
      });

      if (getDeviceOnline()) {
        await import("../offline/cloudSync").then((m) => m.pushShopPendingToCloud().catch(() => undefined));
        await uploadShopCloudSnapshot({ force: true }).catch(() => false);
      }

      completeCloudRecoverySession(validation, completeness);
      return { success: true, validation };
    } catch (err) {
      const { clearBootstrapSyncComplete } = await import("./syncCheckpoints");
      clearBootstrapSyncComplete();
      captureAppException(err, { scope: "cloud_recovery_gated" });
      reportSyncIssue("cloud_recovery_gated_failed");
      const { message, errorKey } = recoveryErrorFromUnknown(err, "cloud_recovery_gated_failed");
      if (getCloudRecoverySession().status === "active") {
        failCloudRecoverySession(message, null, errorKey);
      }
      recordStartupRecoveryFailure(message, errorKey);
      return { success: false, validation: null, error: message, errorKey };
    }
  })().finally(() => {
    gatedRecoveryInFlight = null;
    lastHydrateFinishedAt = Date.now();
  });

  return gatedRecoveryInFlight;
}

/**
 * After sign-in: restore cloud snapshot when local data is empty, else light push-only sync.
 * Debounced so duplicate auth callbacks do not stack heavy work and freeze the UI.
 */
export async function hydrateAccountFromCloud(opts?: {
  forcePull?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  if (!hasSupabaseConfig) return;
  if (shouldPausePosBackgroundWork()) return;

  const needsLock = await shouldRequireRecoveryLock();
  if (needsLock) {
    await runCloudRecoveryGated(opts);
    return;
  }

  const force = opts?.forcePull === true;
  const minGap = force ? HYDRATE_FORCE_COOLDOWN_MS : HYDRATE_COOLDOWN_MS;
  if (!force && Date.now() - lastHydrateFinishedAt < minGap) return;
  if (hydrateInFlight) return hydrateInFlight;

  hydrateInFlight = runHydrateAccountFromCloud(opts)
    .catch((err) => {
      captureAppException(err, { scope: "cloud_hydrate" });
      reportSyncIssue("cloud_hydrate_failed");
    })
    .finally(() => {
      lastHydrateFinishedAt = Date.now();
      hydrateInFlight = null;
    });

  return hydrateInFlight;
}

export { evaluateCloudRecoveryLock, shouldRequireRecoveryLock };

