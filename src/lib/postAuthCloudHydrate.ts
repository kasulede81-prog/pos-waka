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
  reportRecoveryStep,
  resetCloudRecoverySessionForRetry,
  updateRecoveryEntityCounts,
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

const HYDRATE_COOLDOWN_MS = 120_000;
const HYDRATE_FORCE_COOLDOWN_MS = 30_000;

let hydrateInFlight: Promise<void> | null = null;
let gatedRecoveryInFlight: Promise<CloudRecoveryGatedResult> | null = null;
let lastHydrateFinishedAt = 0;

export type CloudRecoveryGatedResult = {
  success: boolean;
  validation: CloudRecoveryValidationResult | null;
  error?: string;
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

function syncEntityCountsFromStore(): void {
  const s = usePosStore.getState();
  const shifts = s.preferences.shifts ?? [];
  const cashRecords =
    s.cashDrawerAdjustments.length + s.dayDrawerOpens.length + s.cashExpenses.length;
  updateRecoveryEntityCounts({
    products: s.products.length,
    sales: s.sales.length,
    customers: s.customers.length,
    inventory: s.inventoryCountSessions.length > 0 ? s.inventoryCountSessions.length : s.products.length,
    shifts: shifts.length,
    dayCloses: s.dayCloses.length,
    cashRecords,
  });
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
      failCloudRecoverySession("Organization is not available");
    }
    return;
  }

  try {
    await assertOrganizationOperationsAllowed({ userId, accountKey });
  } catch {
    if (opts?.recoveryMode) {
      failCloudRecoverySession("Organization operations blocked");
    }
    return;
  }

  if (opts?.recoveryMode) {
    reportRecoveryStep("probing");
  }

  const { hydrateLocalShopProfileFromCloud } = await import("./businessProfile");
  await hydrateLocalShopProfileFromCloud().catch(() => undefined);

  const localEmpty = isLocalShopDataEmpty();
  const needsBootstrap = needsCloudRecoveryBootstrap();
  const force = opts?.forcePull === true;
  let cloudProbe = opts?.cloudProbe ?? null;
  if (!cloudProbe && localEmpty) {
    const probeResult = await resolveCloudShopProbe();
    cloudProbe = probeResult.status === "success" ? probeResult.probe : null;
  }
  const cloudHasData = cloudProbe?.hasSnapshot || cloudProbe?.hasCloudProducts;

  const { pullCloudAndMergeIntoStore, syncShopWithCloud, pushShopPendingToCloud } = await import(
    "../offline/cloudSync",
  );

  const shouldRecoverFromCloud = force || localEmpty || needsBootstrap || cloudHasData;
  const onStep = opts?.recoveryMode
    ? (step: import("./cloudRecoverySession").CloudRecoveryStepId, counts?: Partial<import("./cloudRecoverySession").CloudRecoveryEntityCounts>) => {
        reportRecoveryStep(step, counts);
      }
    : undefined;

  if (shouldRecoverFromCloud) {
    if (localEmpty) {
      if (opts?.recoveryMode) {
        reportRecoveryStep("snapshot");
      }
      const restored = await restoreShopFromCloudSnapshot(opts?.onProgress).catch(() => false);
      if (restored) {
        syncEntityCountsFromStore();
        const { markBootstrapSyncComplete } = await import("./syncCheckpoints");
        markBootstrapSyncComplete();
        if (opts?.recoveryMode) {
          reportRecoveryStep("products", { products: usePosStore.getState().products.length });
          reportRecoveryStep("sales", { sales: usePosStore.getState().sales.length });
          reportRecoveryStep("customers", { customers: usePosStore.getState().customers.length });
          reportRecoveryStep("inventory", {
            inventory: usePosStore.getState().inventoryCountSessions.length || usePosStore.getState().products.length,
          });
          reportRecoveryStep("shifts", {
            shifts: (usePosStore.getState().preferences.shifts ?? []).length,
          });
          reportRecoveryStep("day_closes", { dayCloses: usePosStore.getState().dayCloses.length });
          reportRecoveryStep("cash", {
            cashRecords:
              usePosStore.getState().cashDrawerAdjustments.length +
              usePosStore.getState().dayDrawerOpens.length +
              usePosStore.getState().cashExpenses.length,
          });
        }
        const { applyShopRecoverySignalsForCurrentShop } = await import("./shopRecoverySignals");
        await applyShopRecoverySignalsForCurrentShop().catch(() => undefined);
      } else {
        await pullCloudAndMergeIntoStore({ forceFull: true, onRecoveryStep: onStep }).catch(() => undefined);
        syncEntityCountsFromStore();
      }
    } else if (needsBootstrap || force) {
      await pullCloudAndMergeIntoStore({ forceFull: true, onRecoveryStep: onStep }).catch(() => undefined);
      syncEntityCountsFromStore();
    }
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
      failCloudRecoverySession(probeResult.error);
      return { success: false, validation: null, error: probeResult.error, probeFailed: true };
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
      syncEntityCountsFromStore();

      const { buildCloudRecoverySimulationReport, recordCloudRecoveryValidation } = await import(
        "./cloudRecoveryValidator"
      );
      const validation = buildCloudRecoverySimulationReport();
      recordCloudRecoveryValidation(validation);

      const gate = validateRecoveryCompletionGate(probe, validation);
      if (!gate.ok) {
        failCloudRecoverySession(gate.message, validation);
        return { success: false, validation, error: gate.message };
      }

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
      captureAppException(err, { scope: "cloud_recovery_gated" });
      reportSyncIssue("cloud_recovery_gated_failed");
      const message = err instanceof Error ? err.message : "Recovery failed";
      failCloudRecoverySession(message);
      return { success: false, validation: null, error: message };
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
