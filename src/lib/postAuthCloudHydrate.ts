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
  failCloudRecoverySession,
  getCloudRecoverySession,
  logRecoveryDiagnosticEvent,
  recordRecoveryIntegrityDiagnostics,
  recordRecoveryRetry,
  recordRecoveryRuntime,
  recordRecoveryTimeout,
  reportRecoveryStep,
  resetCloudRecoverySessionForRetry,
  unlockCoreRecoverySession,
  unlockCoreRecoveryWithDegradedValidation,
  syncRecoveryRestoredCountsFromStore,
  type CloudRecoveryEntityCounts,
  type CloudRecoveryStepId,
} from "./cloudRecoverySession";
import {
  evaluateCloudRecoveryLock,
  probeIndicatesCloudBusiness,
  resolveCloudShopProbe,
  shouldRequireRecoveryLock,
  validateCoreOperationalGate,
  type CloudShopProbe,
} from "./cloudRecoveryGate";
import type { CloudRecoveryValidationResult } from "./cloudRecoveryValidator";
import { ensureRecoverySessionActor } from "./recoverySystemActor";
import {
  RECOVERY_EMPTY_STORE_ERROR,
  storeHasCoreRecoveryData,
  verifyRecoveryHydration,
} from "./recoveryHydration";
import { recordStartupRecoveryFailure } from "./startupDiagnostics";
import { runBackgroundRecoveryCertification } from "./backgroundRecoveryCertification";
import { logRecovery, markRecoveryPerf, resetRecoveryDiagnostics } from "./recoveryDiagnostics";
import { beginRecoveryStageWatch, endRecoveryStageWatch } from "./recoveryWatchdog";
import {
  RECOVERY_GLOBAL_TIMEOUT_MS,
  RECOVERY_PERSIST_TIMEOUT_MS,
  RECOVERY_PROBE_TIMEOUT_MS,
  RECOVERY_STAFF_TIMEOUT_MS,
  RecoveryTimeoutError,
  withRecoveryTimeoutPromise,
} from "./recoveryTimeout";
import { smallShopFastPathFromCounts } from "./recoveryFastPath";
import {
  allCriticalModulesCheckpointed,
  canSkipRecoveryModule,
  markRecoveryModuleComplete,
  readRecoveryModuleCheckpoints,
} from "./recoveryModuleCheckpoints";
import { isCoreOperationalDatasetReady, recoveryStepToModule } from "./recoveryModuleClassification";

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
  /** True when cloud probe failed — blocking until online. */
  probeFailed?: boolean;
  /** Core catalog restored — POS may operate; certification may still run. */
  coreUnlocked?: boolean;
  certificationPending?: boolean;
  inventoryWarnings?: boolean;
  message?: string;
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

function reportRecoveryStepWithCheckpoint(
  step: CloudRecoveryStepId,
  counts?: Partial<CloudRecoveryEntityCounts>,
): void {
  reportRecoveryStep(step, counts);
  const module = recoveryStepToModule(step);
  if (module) markRecoveryModuleComplete(module, counts);
}

function reportRecoveryStepsFromStore(): void {
  const counts = readStoreRecoveryCounts();
  reportRecoveryStepWithCheckpoint("products", { products: counts.products });
  reportRecoveryStepWithCheckpoint("sales", { sales: counts.sales });
  reportRecoveryStepWithCheckpoint("customers", { customers: counts.customers });
  reportRecoveryStepWithCheckpoint("inventory", { inventory: counts.inventory });
  reportRecoveryStepWithCheckpoint("shifts", { shifts: counts.shifts });
  reportRecoveryStepWithCheckpoint("day_closes", { dayCloses: counts.dayCloses });
  reportRecoveryStepWithCheckpoint("cash", { cashRecords: counts.cashRecords });
}

function recoveryErrorFromUnknown(err: unknown, fallbackKey: string): { message: string; errorKey: string } {
  if (err instanceof Error) {
    const key = err.message.trim() || fallbackKey;
    return { message: err.message, errorKey: key };
  }
  return { message: fallbackKey, errorKey: fallbackKey };
}

function assertRecoveryHydratedOrThrow(): void {
  const verification = verifyRecoveryHydration();
  recordRecoveryIntegrityDiagnostics({
    finalStoreCounts: readStoreRecoveryCounts(),
    recoveryInvariantPassed: verification.hydrated,
  });
  if (!verification.hydrated) {
    throw new Error(RECOVERY_EMPTY_STORE_ERROR);
  }
}

function recordProbeIntegrityDiagnostics(probe: CloudShopProbe): void {
  recordRecoveryIntegrityDiagnostics({
    snapshotRowFound: probe.snapshotRowFound,
    snapshotContainsCoreData: probe.snapshotContainsCoreData,
  });
}

async function runFullCloudPull(opts: {
  onStep?: (
    step: import("./cloudRecoverySession").CloudRecoveryStepId,
    counts?: Partial<import("./cloudRecoverySession").CloudRecoveryEntityCounts>,
  ) => void;
  cloudRecovery: boolean;
  afterSnapshotRestore?: boolean;
}): Promise<void> {
  recordRecoveryIntegrityDiagnostics({ fullPullAttempted: true });
  beginRecoveryStageWatch("full_cloud_pull", 20_000);
  recordRecoveryRuntime({ currentStage: "full_cloud_pull", stageStartedAt: new Date().toISOString() });
  try {
    const { pullCloudAndMergeIntoStore } = await import("../offline/cloudSync");
    const merged = await withRecoveryTimeoutPromise(
      pullCloudAndMergeIntoStore({
        forceFull: !opts.afterSnapshotRestore,
        afterSnapshotRestore: opts.afterSnapshotRestore,
        onRecoveryStep: opts.onStep,
        cloudRecovery: opts.cloudRecovery,
      }),
      {
        kind: "entity_pull",
        timeoutMs: RECOVERY_GLOBAL_TIMEOUT_MS,
        onRetry: () => recordRecoveryRetry(),
      },
    );
    if (!merged) {
      if (opts.cloudRecovery) {
        const errorKey = "cloud_merge_failed";
        const message = "Cloud data merge did not complete";
        failCloudRecoverySession(message, null, errorKey);
        recordStartupRecoveryFailure(message, errorKey);
        throw new Error(errorKey);
      }
      return;
    }
    syncRestoredCountsFromStore();
    recordRecoveryIntegrityDiagnostics({
      fullPullDownloadedCounts: { ...getCloudRecoverySession().downloadedCounts },
      finalStoreCounts: readStoreRecoveryCounts(),
    });
    if (opts.cloudRecovery) {
      await pullAndFinalizeRecoveryStaff(opts.onStep);
    }
  } finally {
    endRecoveryStageWatch();
  }
}

async function pullAndFinalizeRecoveryStaff(
  onStep?: (
    step: CloudRecoveryStepId,
    counts?: Partial<CloudRecoveryEntityCounts>,
  ) => void,
): Promise<void> {
  assertRecoveryHydratedOrThrow();
  beginRecoveryStageWatch("staff", 10_000);
  recordRecoveryRuntime({ currentStage: "staff", stageStartedAt: new Date().toISOString() });
  try {
    const { pullAndMergeStaffAccountsForRecovery } = await import("./staffRecovery");
    const staffCount = await withRecoveryTimeoutPromise(pullAndMergeStaffAccountsForRecovery(), {
      kind: "staff",
      timeoutMs: RECOVERY_STAFF_TIMEOUT_MS,
      onRetry: () => recordRecoveryRetry(),
    });
    reportRecoveryStepWithCheckpoint("staff");
    void staffCount;
    void onStep;
    syncRestoredCountsFromStore();
  } catch (err) {
    if (err instanceof RecoveryTimeoutError) {
      recordRecoveryTimeout();
      throw err;
    }
    throw err;
  } finally {
    endRecoveryStageWatch();
  }
}

async function finishGracefulCoreUnlock(opts: {
  probe: CloudShopProbe;
  validation: CloudRecoveryValidationResult;
  message: string;
  degraded?: boolean;
}): Promise<CloudRecoveryGatedResult> {
  const { markBootstrapSyncComplete } = await import("./syncCheckpoints");
  const usedSnapshot =
    getCloudRecoverySession().integrityDiagnostics.snapshotRestoreProducedData === true;
  const bootstrapAt =
    usedSnapshot && opts.probe.snapshotUpdatedAt ? opts.probe.snapshotUpdatedAt : new Date().toISOString();
  markBootstrapSyncComplete(bootstrapAt);

  if (opts.degraded) {
    unlockCoreRecoveryWithDegradedValidation(opts.validation, opts.message);
  } else {
    unlockCoreRecoverySession();
  }
  markRecoveryPerf("coreRecoveredMs");
  markRecoveryPerf("posUnlockedMs");
  logRecovery("core_unlock", { degraded: opts.degraded === true });

  const restoredCounts = readStoreRecoveryCounts();
  void runBackgroundRecoveryCertification({
    probe: opts.probe,
    validation: opts.validation,
    restoredCounts,
    skipHeavyPull: smallShopFastPathFromCounts(restoredCounts),
  });

  return {
    success: true,
    validation: opts.validation,
    coreUnlocked: true,
    certificationPending: true,
    inventoryWarnings: opts.degraded === true,
    message: opts.message,
  };
}

function canSkipSnapshotRestore(live: CloudRecoveryEntityCounts): boolean {
  return canSkipRecoveryModule("products", live) && live.products > 0;
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

  const cloudRecovery = opts?.recoveryMode === true;
  const liveCounts = readStoreRecoveryCounts();

  if (cloudRecovery && allCriticalModulesCheckpointed(liveCounts) && isCoreOperationalDatasetReady()) {
    logRecovery("resume", { modules: Object.keys(readRecoveryModuleCheckpoints()).join(",") });
    reportRecoveryStepsFromStore();
    syncRestoredCountsFromStore();
    return;
  }

  const onStep = cloudRecovery
    ? (step: CloudRecoveryStepId, counts?: Partial<CloudRecoveryEntityCounts>) => {
        reportRecoveryStepWithCheckpoint(step, counts);
      }
    : undefined;

  if (localEmpty) {
    if (cloudRecovery) {
      recordRecoveryIntegrityDiagnostics({ snapshotRestoreAttempted: true });
      reportRecoveryStep("snapshot");
    }

    const skipSnapshot = cloudRecovery && canSkipSnapshotRestore(liveCounts);

    let snapshotRestoreSucceeded = skipSnapshot;
    if (!skipSnapshot) {
      try {
        beginRecoveryStageWatch("snapshot", 12_000);
        recordRecoveryRuntime({ currentStage: "snapshot", stageStartedAt: new Date().toISOString() });
        snapshotRestoreSucceeded = await withRecoveryTimeoutPromise(
          restoreShopFromCloudSnapshot(opts?.onProgress, { cloudRecovery }),
          {
            kind: "snapshot",
            timeoutMs: RECOVERY_PERSIST_TIMEOUT_MS,
            onRetry: () => recordRecoveryRetry(),
          },
        );
      } catch (err) {
        if (err instanceof RecoveryTimeoutError) {
          recordRecoveryTimeout();
        }
        const { message, errorKey } = recoveryErrorFromUnknown(err, "cloud_snapshot_restore_failed");
        if (cloudRecovery) {
          failCloudRecoverySession(message, null, errorKey);
          recordStartupRecoveryFailure(message, errorKey);
        }
        throw err;
      } finally {
        endRecoveryStageWatch();
      }
    } else {
      logRecovery("resume", { skipped: "snapshot" });
    }

    const counts = readStoreRecoveryCounts();
    const hasCoreData = storeHasCoreRecoveryData();

    if (snapshotRestoreSucceeded && hasCoreData) {
      recordRecoveryIntegrityDiagnostics({
        snapshotRestoreProducedData: true,
        finalStoreCounts: counts,
      });
      syncRestoredCountsFromStore();
      if (cloudRecovery) {
        reportRecoveryStepsFromStore();
        const snapshotAt = cloudProbe?.snapshotUpdatedAt;
        if (snapshotAt) {
          const { seedEntitySyncCursorsAt } = await import("./syncCheckpoints");
          seedEntitySyncCursorsAt(snapshotAt);
        }
        await pullAndFinalizeRecoveryStaff(onStep);
      }
    } else if (snapshotRestoreSucceeded && !hasCoreData) {
      reportRecoveryStep("snapshot_empty_after_restore");
      logRecoveryDiagnosticEvent("snapshot_empty_after_restore");
      recordRecoveryIntegrityDiagnostics({ snapshotRestoreProducedData: false });
      await runFullCloudPull({ onStep, cloudRecovery });
    } else {
      await runFullCloudPull({ onStep, cloudRecovery });
    }
    const { scheduleShopRecovery } = await import("./shopRecoveryOrchestration");
    await scheduleShopRecovery("owner_login").catch(() => undefined);
    return;
  }

  if (needsBootstrap || force) {
    await runFullCloudPull({ onStep: onStep, cloudRecovery });
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
    if (opts?.cloudProbe) {
      recordProbeIntegrityDiagnostics(opts.cloudProbe);
    }
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
 * P0 gated recovery — download + core unlock, then background certification (Phase 24.1BB).
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

    const runGated = async (): Promise<CloudRecoveryGatedResult> => {
      resetRecoveryDiagnostics();
      logRecovery("download_start");
      beginCloudRecoverySession();
      reportRecoveryStep("probing");

      const probeResult =
        lockEval.probeResult?.status === "success"
          ? lockEval.probeResult
          : await withRecoveryTimeoutPromise(resolveCloudShopProbe(), {
              kind: "probe",
              timeoutMs: RECOVERY_PROBE_TIMEOUT_MS,
              onRetry: () => recordRecoveryRetry(),
            });

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
      recordProbeIntegrityDiagnostics(probe);

      try {
        beginRecoveryStageWatch("cloud_restore", 20_000);
        recordRecoveryRuntime({ currentStage: "cloud_restore", stageStartedAt: new Date().toISOString() });
        await withRecoveryTimeoutPromise(
          runHydrateAccountFromCloudInner({
            forcePull: opts?.forcePull ?? true,
            onProgress: opts?.onProgress,
            recoveryMode: true,
            cloudProbe: probe,
          }),
          {
            kind: "entity_pull",
            timeoutMs: RECOVERY_GLOBAL_TIMEOUT_MS,
            retries: 0,
          },
        );
        endRecoveryStageWatch();

        syncRestoredCountsFromStore();
        logRecovery("persist");

        reportRecoveryStep("validation");
        const { buildCloudRecoverySimulationReport, recordCloudRecoveryValidation } = await import(
          "./cloudRecoveryValidator"
        );
        const validation = buildCloudRecoverySimulationReport({ recoveryMode: true });
        recordCloudRecoveryValidation(validation);

        const coreGate = validateCoreOperationalGate(probe, validation);
        if (!coreGate.ok) {
          if (storeHasCoreRecoveryData()) {
            return finishGracefulCoreUnlock({
              probe,
              validation,
              message: `${coreGate.message} (non-blocking — core data restored)`,
              degraded: true,
            });
          }
          const { clearBootstrapSyncComplete } = await import("./syncCheckpoints");
          clearBootstrapSyncComplete();
          recordRecoveryIntegrityDiagnostics({ recoveryInvariantPassed: false });
          failCloudRecoverySession(coreGate.message, validation, coreGate.failures[0] ?? "recovery_validation_failed");
          recordStartupRecoveryFailure(coreGate.message, coreGate.failures[0] ?? "recovery_validation_failed");
          return { success: false, validation, error: coreGate.message, errorKey: coreGate.failures[0] };
        }

        try {
          assertRecoveryHydratedOrThrow();
        } catch (hydrateErr) {
          if (storeHasCoreRecoveryData()) {
            return finishGracefulCoreUnlock({
              probe,
              validation,
              message: "Core data restored with hydration warnings",
              degraded: true,
            });
          }
          throw hydrateErr;
        }

        return finishGracefulCoreUnlock({
          probe,
          validation,
          message: "Core business data restored",
        });
      } catch (err) {
        endRecoveryStageWatch();
        if (err instanceof RecoveryTimeoutError) {
          recordRecoveryTimeout();
        }
        const { buildCloudRecoverySimulationReport } = await import("./cloudRecoveryValidator");
        const validation = buildCloudRecoverySimulationReport({ recoveryMode: true });
        if (storeHasCoreRecoveryData()) {
          syncRestoredCountsFromStore();
          return finishGracefulCoreUnlock({
            probe,
            validation,
            message: err instanceof Error ? err.message : "Recovery completed with warnings",
            degraded: true,
          });
        }
        const { clearBootstrapSyncComplete } = await import("./syncCheckpoints");
        clearBootstrapSyncComplete();
        captureAppException(err, { scope: "cloud_recovery_gated" });
        reportSyncIssue("cloud_recovery_gated_failed");
        const { message, errorKey } = recoveryErrorFromUnknown(err, "cloud_recovery_gated_failed");
        if (getCloudRecoverySession().status === "active") {
          failCloudRecoverySession(message, validation, errorKey);
        }
        recordStartupRecoveryFailure(message, errorKey);
        return { success: false, validation, error: message, errorKey };
      }
    };

    return withRecoveryTimeoutPromise(runGated(), {
      kind: "global",
      timeoutMs: RECOVERY_GLOBAL_TIMEOUT_MS + 30_000,
      retries: 0,
    }).catch(async (err) => {
      if (storeHasCoreRecoveryData()) {
        const probe = lockEval.probeResult?.status === "success" ? lockEval.probeResult.probe : null;
        if (probe) {
          const { buildCloudRecoverySimulationReport } = await import("./cloudRecoveryValidator");
          return finishGracefulCoreUnlock({
            probe,
            validation: buildCloudRecoverySimulationReport({ recoveryMode: true }),
            message: "Recovery timed out — continuing with restored core data",
            degraded: true,
          });
        }
      }
      throw err;
    });
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

export { evaluateCloudRecoveryLock, shouldRequireRecoveryLock, verifyRecoveryHydration };

