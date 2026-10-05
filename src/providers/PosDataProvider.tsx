import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  bootstrapPosBackgroundFromDisk,
  bootstrapPosCriticalFromDisk,
  bootstrapPosInteractiveFromDisk,
  flushPendingPersist,
  usePosStore,
} from "../store/usePosStore";

import { getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";

import {
  getActiveShopState,
  isShopContextUnresolved,
  setActiveShopState,
} from "../offline/shopScope";

import { initInventorySyncChannel } from "../lib/inventorySyncChannel";

import { forceHideNativeSplash, hideNativeSplashWhenReady, scheduleSplashMaxDuration, scheduleSplashSafetyTimeout } from "../lib/nativeSplash";

import { hasSupabaseConfig } from "../lib/supabase";

import { isLocalShopDataEmpty } from "../lib/cloudSnapshotSync";
import {
  initializeActiveShopForAccount,
  resolveShopContextForBoot,
  SHOP_INIT_RETRY_DELAYS_MS,
} from "../lib/initializeActiveShop";
import {
  logOnboardingRequired,
  shouldRunCloudRecoveryForAccount,
  userIdFromAccountKey,
} from "../lib/firstTimeOwnerDevice";

import { bootTrace } from "../lib/bootTrace";
import { CloudRecoveryScreen } from "../components/recovery/CloudRecoveryScreen";
import { RecoveryBackgroundBanner } from "../components/recovery/RecoveryBackgroundBanner";

import {
  isCloudRecoveryLockActive,
  resetCloudRecoverySessionForRetry,
} from "../lib/cloudRecoverySession";

import { runCloudRecoveryGated } from "../lib/postAuthCloudHydrate";

import { StartupLoadingScreen, STARTUP_SCREEN_BG } from "../components/startup/StartupLoadingScreen";

import { StartupEscapeActions } from "../components/startup/StartupEscapeActions";

import {
  getStartupDiagnosticsSnapshot,
  logStartupPhase,
  markStartupStalled,
  recordStartupRecoveryValidated,
  recordStartupStep,
  resetStartupSessionForRetry,
  setRecoveryOfflineBypass,
  subscribeStartupDiagnostics,
  type StartupStepId,
} from "../lib/startupDiagnostics";

import { STARTUP_STALL_MS } from "../components/startup/StartupBootstrapGate";

import { scheduleStartupTask, resetStartupScheduler } from "../lib/startupScheduler";

import { markStartupPerf } from "../lib/startupPerformance";

import type { Language } from "../types";

import { t } from "../lib/i18n";

type Props = {
  children: ReactNode;
  lang?: Language;
  accountKey: string | null;
  onSignOut?: () => void | Promise<void>;
};

export { POS_BOOT_GATES } from "../lib/posBootGates";

function isStoreReadyForAccount(accountKey: string | null): boolean {
  return Boolean(accountKey && usePosStore.getState()._hydrated && getActiveAccountKey() === accountKey);
}

async function markFreshAccountBootstrapReady(): Promise<void> {
  const { markBootstrapSyncComplete } = await import("../lib/syncCheckpoints");
  const { fetchShopServerNow } = await import("../lib/serverNow");
  const at = await fetchShopServerNow();
  if (at) markBootstrapSyncComplete(at);
  resetCloudRecoverySessionForRetry();
}

type BootPhase = "disk" | "ready";

type RecoveryOverlayState = {
  failed: boolean;
  probeFailed: boolean;
};

export function PosDataProvider({ children, lang = "en", accountKey, onSignOut = async () => {} }: Props) {
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => (!accountKey ? "ready" : "disk"));
  const [recoveryOverlay, setRecoveryOverlay] = useState<RecoveryOverlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [startupStep, setStartupStep] = useState<StartupStepId>(() => "local_disk");
  const bootGenRef = useRef(0);
  /** The single pending shop-retry timer, and the resolver that releases its wait. */
  const shopRetryTimerRef = useRef<number | null>(null);
  const shopRetryReleaseRef = useRef<(() => void) | null>(null);

  /**
   * Cancel a pending shop retry AND release the loop waiting on it, so a superseded boot cannot
   * keep a timer armed — nor sit on an unresolved promise for the rest of the session.
   */
  const clearShopRetry = useCallback(() => {
    if (shopRetryTimerRef.current !== null) {
      window.clearTimeout(shopRetryTimerRef.current);
      shopRetryTimerRef.current = null;
    }
    const release = shopRetryReleaseRef.current;
    shopRetryReleaseRef.current = null;
    release?.();
  }, []);

  /** One bounded, cancellable wait between shop-resolution attempts. */
  const waitForShopRetry = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const settle = () => {
          shopRetryTimerRef.current = null;
          shopRetryReleaseRef.current = null;
          resolve();
        };
        shopRetryReleaseRef.current = settle;
        shopRetryTimerRef.current = window.setTimeout(settle, ms);
      }),
    [],
  );

  useEffect(() => {
    scheduleSplashMaxDuration();
    scheduleSplashSafetyTimeout();
  }, []);

  useEffect(() => {
    if (!accountKey) return;
    void forceHideNativeSplash();
  }, [accountKey, bootPhase, error, recoveryOverlay, stalled]);

  useEffect(() => {
    const sync = () => setStartupStep(getStartupDiagnosticsSnapshot().currentStep);
    sync();
    return subscribeStartupDiagnostics(sync);
  }, []);

  useEffect(() => {
    if (bootPhase === "ready" && !error) {
      setStalled(false);
      return;
    }
    const tick = () => {
      const snap = getStartupDiagnosticsSnapshot();
      const stallMs = Date.now() - new Date(snap.lastStepAt).getTime();
      if (stallMs >= STARTUP_STALL_MS) {
        markStartupStalled();
        setStalled(true);
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [bootPhase, error, recoveryOverlay]);

  const finishReady = useCallback((via: string, userId: string | null) => {
    recordStartupStep("finalizing");
    setBootPhase("ready");
    recordStartupStep("ready");
    logStartupPhase("dashboard_ready", { via });
    markStartupPerf("shell_render");
    markStartupPerf("first_interactive");
    markStartupPerf("dashboard_ready");
    logOnboardingRequired(userId);
    void hideNativeSplashWhenReady();
  }, []);

  const runRecovery = useCallback(async (gen: number, userId: string | null) => {
    setRecoveryOverlay({ failed: false, probeFailed: false });
    recordStartupStep("cloud_recovery");

    const result = await runCloudRecoveryGated({ forcePull: true });

    if (bootGenRef.current !== gen) return;

    if (result.success && result.coreUnlocked) {
      recordStartupRecoveryValidated();
      setRecoveryOverlay(null);
      logOnboardingRequired(userId);
      bootTrace("BOOT-014", "Cloud Recovery", "SUCCESS", { userId, via: "core_unlock" });
      void hideNativeSplashWhenReady();
    } else if (result.success) {
      recordStartupRecoveryValidated();
      setRecoveryOverlay(null);
      logOnboardingRequired(userId);
      bootTrace("BOOT-014", "Cloud Recovery", "SUCCESS", { userId });
      void hideNativeSplashWhenReady();
    } else if (result.probeFailed) {
      recordStartupStep("cloud_probe", { failureReason: result.error ?? "Cloud probe failed" });
      setRecoveryOverlay({ failed: false, probeFailed: true });
    } else {
      recordStartupStep("cloud_recovery", { failureReason: result.error ?? "Recovery failed" });
      setRecoveryOverlay({ failed: true, probeFailed: false });
    }
  }, []);

  const scheduleBackgroundHydration = useCallback((gen: number, userId: string | null) => {
    scheduleStartupTask({
      id: "bootstrap-interactive",
      priority: 1,
      run: async () => {
        if (bootGenRef.current !== gen) return;
        await bootstrapPosInteractiveFromDisk();
      },
    });

    scheduleStartupTask({
      id: "bootstrap-background",
      priority: 2,
      run: async () => {
        if (bootGenRef.current !== gen) return;
        await bootstrapPosBackgroundFromDisk();
      },
    });

    scheduleStartupTask({
      id: "cloud-recovery",
      priority: 3,
      run: async () => {
        if (bootGenRef.current !== gen) return;
        if (!hasSupabaseConfig || !accountKey?.startsWith("sb:")) return;

        const needsRecovery = await shouldRunCloudRecoveryForAccount(userId);
        if (needsRecovery) {
          bootTrace("BOOT-014", "Cloud Recovery", "START", { userId });
          await runRecovery(gen, userId);
          return;
        }

        if (isLocalShopDataEmpty()) {
          await markFreshAccountBootstrapReady();
        }
        if (isCloudRecoveryLockActive()) {
          resetCloudRecoverySessionForRetry();
        }
      },
    });
  }, [accountKey, runRecovery]);

  const runBoot = useCallback(
    async (gen: number) => {
      bootTrace("BOOT-012", "PosDataProvider.runBoot", "START", { accountKey });
      resetStartupScheduler();
      setError(null);
      setRecoveryOverlay(null);
      setStalled(false);

      const userId = userIdFromAccountKey(accountKey);

      if (!accountKey) {
        // No account: the shop lifecycle has nothing to resolve. Recorded explicitly so a later
        // reader of the state never mistakes "signed out" for "resolution still in flight".
        setActiveShopState("signed-out");
        finishReady("no_account", userId);
        return;
      }

      if (isCloudRecoveryLockActive()) {
        const stillNeedsRecovery = await shouldRunCloudRecoveryForAccount(userId);
        if (!stillNeedsRecovery) {
          resetCloudRecoverySessionForRetry();
        }
      }

      if (getActiveAccountKey() !== accountKey) {
        flushPendingPersist();
        usePosStore.getState().resetForSignOut();
        setActiveAccountKey(accountKey);
      }

      /**
       * SHOP CONTEXT GATE — the load-bearing check of this file.
       *
       * A shop-dependent POS must not become interactive while the account's shop context is
       * merely unresolved: every local read and write is namespace-relative, so with no shop the
       * POS silently operates in the shopless legacy partition, and only a refresh recovers it.
       * That is precisely the "sometimes it misbehaves, then refreshing fixes it" symptom.
       *
       * This is NOT `if (!getActiveShopId()) return;`. A null id is equally the correct value for a
       * confirmed no-shop account (legitimate onboarding) and for a signed-out one, and blocking
       * those would break both. Only the explicit `initializing` state — the one that means "we do
       * not know yet" — stops the boot.
       *
       * A failed attempt is retried on a bounded schedule before we get here; if it is still
       * unresolved at this point the POS stays in startup, and the existing stall escape actions
       * (retry / sign out) remain available rather than a half-working POS.
       */
      const shopBoot = await resolveShopContextForBoot(
        {
          // The generation is handed DOWN into the resolution rather than checked after it: this
          // function mutates the active shop, the lifecycle state and the persisted last shop at
          // several awaits, and the `bootGenRef` check below only runs once it has returned. An
          // attempt that has been superseded must not be able to publish any of them.
          initialize: (userId) => initializeActiveShopForAccount(userId, { isCurrent: () => bootGenRef.current === gen }),
          getState: getActiveShopState,
          getAccountKey: getActiveAccountKey,
          isCurrent: () => bootGenRef.current === gen,
          wait: waitForShopRetry,
        },
        { userId, accountKey },
      );

      if (bootGenRef.current !== gen) return;

      if (shopBoot.state === "initializing") {
        bootTrace("BOOT-013", "initialize_active_shop", "FAILED", {
          via: "shop_context_unresolved",
          attempts: shopBoot.attempts,
          maxAttempts: SHOP_INIT_RETRY_DELAYS_MS.length + 1,
        });
        // Deliberately no finishReady(): the retry schedule is exhausted and the stall escape
        // actions are the honest way out. Background hydration is not scheduled either — it would
        // hydrate the shopless namespace and a later shop activation would have to undo it.
        return;
      }

      if (isStoreReadyForAccount(accountKey)) {
        const stage = usePosStore.getState().hydrationStage;
        finishReady("store_already_ready", userId);
        bootTrace("BOOT-012", "PosDataProvider.runBoot", "SUCCESS", { via: "store_already_ready" });
        if (stage !== "complete") {
          scheduleBackgroundHydration(gen, userId);
        }
        return;
      }

      setBootPhase("disk");
      recordStartupStep("local_disk");

      try {
        bootTrace("BOOT-017", "critical_hydrate", "START");
        await bootstrapPosCriticalFromDisk();
        bootTrace("BOOT-017", "critical_hydrate", "SUCCESS");
      } catch {
        bootTrace("BOOT-017", "critical_hydrate", "FAILED");
        if (bootGenRef.current === gen) {
          setError("load");
          finishReady("critical_load_error", userId);
        }
        return;
      }

      if (bootGenRef.current !== gen) return;

      recordStartupStep("recovery_check");
      // Admin-reset safety net: check for (and apply) an outstanding admin
      // force-full-resync signal BEFORE the stale disk-hydrated business data
      // above is allowed to render. `bootstrapPosCriticalFromDisk` has already
      // loaded whatever this device had cached locally into the store, but
      // nothing has painted yet (`finishReady` below is what flips the UI on).
      // A short, fail-closed RPC check here — reusing the existing recovery
      // signal, never a second recovery system — means a device whose shop
      // was just reset authoritatively replaces its stale product cache
      // in-place before the user ever sees it, instead of only fixing itself
      // later via the unrelated PIN-recovery pipeline that runs after render.
      if (hasSupabaseConfig && accountKey?.startsWith("sb:")) {
        try {
          const { applyPendingForceFullResyncForCurrentShop } = await import("../lib/shopRecoverySignals");
          await applyPendingForceFullResyncForCurrentShop();
        } catch {
          // Never block boot on this check — offline/slow network just means
          // the device proceeds with whatever it already has, same as today.
        }
      }
      if (bootGenRef.current !== gen) return;

      // POS-ready after critical disk. Cloud recovery / queue / reports stay in background (POS_BOOT_GATES).
      finishReady("critical_hydrate", userId);
      bootTrace("BOOT-012", "PosDataProvider.runBoot", "SUCCESS", { via: "critical_hydrate" });

      scheduleBackgroundHydration(gen, userId);
    },
    [accountKey, finishReady, scheduleBackgroundHydration, waitForShopRetry],
  );

  useEffect(() => {
    if (!accountKey) return;

    const dispose = initInventorySyncChannel((msg) => {
      usePosStore.getState().applyRemoteInventorySync(msg);
    });

    return dispose;
  }, [accountKey]);

  useEffect(() => {
    const gen = ++bootGenRef.current;
    void runBoot(gen);
    return () => {
      bootGenRef.current += 1;
      // Releases a retry that is mid-wait and disarms its timer, so switching account (or
      // unmounting) can never leave a previous account's retry armed against the new one.
      clearShopRetry();
      resetStartupScheduler();
    };
  }, [accountKey, runBoot, clearShopRetry]);

  useEffect(() => {
    if (bootPhase === "ready" || !accountKey) return;
    const id = window.setTimeout(() => {
      /**
       * The escape exists so a slow boot cannot pin the app on a splash screen forever — but it
       * must not manufacture an interactive POS out of an unresolved shop context. Escaping while
       * the shop is still unknown is what made a slow boot indistinguishable from a broken one:
       * the POS came up shopless and only a refresh fixed it.
       *
       * Remaining in startup is safe here because it is bounded: the retry schedule is finishing,
       * and the stall actions (retry / sign out) appear shortly after. Nothing is fabricated.
       */
      if (isShopContextUnresolved()) {
        bootTrace("BOOT-012", "PosDataProvider.runBoot", "TIMEOUT", {
          via: "boot_timeout_escape_deferred_shop_unresolved",
          accountKey,
        });
        return;
      }
      finishReady("boot_timeout_escape", userIdFromAccountKey(accountKey));
      bootTrace("BOOT-012", "PosDataProvider.runBoot", "TIMEOUT", { via: "boot_timeout_escape", accountKey });
      if (isCloudRecoveryLockActive()) {
        resetCloudRecoverySessionForRetry();
      }
      scheduleBackgroundHydration(bootGenRef.current, userIdFromAccountKey(accountKey));
    }, 12_000);
    return () => window.clearTimeout(id);
  }, [bootPhase, accountKey, finishReady, scheduleBackgroundHydration]);

  const handleRetryRecovery = useCallback(() => {
    resetStartupSessionForRetry();
    setStalled(false);
    const gen = bootGenRef.current;
    resetCloudRecoverySessionForRetry();
    void runRecovery(gen, userIdFromAccountKey(accountKey));
  }, [accountKey, runRecovery]);

  const handleRetryStartup = useCallback(() => {
    resetStartupSessionForRetry();
    setStalled(false);
    setError(null);
    const gen = ++bootGenRef.current;
    void runBoot(gen);
  }, [runBoot]);

  const handleContinueOffline = useCallback(() => {
    if (isLocalShopDataEmpty()) return;
    // Offline continuation is for operating against a shop context we already have (restored from
    // disk or from the persisted last shop). With resolution still unresolved there is no context
    // to scope to, so continuing would run the POS in the shopless partition — the exact state
    // this batch exists to prevent. Legitimate offline use is unaffected: a shop resolved from
    // local state is `ready`, not `initializing`.
    if (isShopContextUnresolved()) return;
    setRecoveryOfflineBypass();
    resetCloudRecoverySessionForRetry();
    setRecoveryOverlay(null);
    setStalled(false);
    recordStartupStep("finalizing");
    recordStartupStep("ready");
    logStartupPhase("dashboard_ready", { via: "continue_offline" });
    void hideNativeSplashWhenReady();
  }, []);

  const canContinueOffline =
    !isLocalShopDataEmpty() && usePosStore.getState()._hydrated && !isShopContextUnresolved();

  const handleSignOut = useCallback(async () => {
    resetCloudRecoverySessionForRetry();
    await onSignOut();
  }, [onSignOut]);

  if (stalled && bootPhase !== "ready") {
    return (
      <div className={`min-h-dvh ${STARTUP_SCREEN_BG} px-5 py-[max(2rem,env(safe-area-inset-top))]`}>
        <StartupLoadingScreen lang={lang} step={startupStep} showLogo={false} />
        <div className="mx-auto mt-6 max-w-md">
          <StartupEscapeActions
            lang={lang}
            title={t(lang, "startupStalledTitle")}
            subtitle={t(lang, "startupStalledSub")}
            onRetry={error === "load" ? handleRetryStartup : handleRetryRecovery}
            onContinueOffline={handleContinueOffline}
            canContinueOffline={canContinueOffline}
            onSignOut={handleSignOut}
          />
        </div>
      </div>
    );
  }

  if (error && bootPhase !== "ready") {
    return (
      <div className={`flex min-h-dvh flex-col items-center justify-center gap-4 ${STARTUP_SCREEN_BG} px-6 py-[max(2rem,env(safe-area-inset-top))]`}>
        <div className="max-w-sm space-y-4 rounded-3xl border-2 border-amber-100 bg-amber-50/90 p-8 shadow-waka-sm">
          <p className="text-xl font-black text-foreground">{t(lang, "localDataError")}</p>
          <p className="text-base font-medium leading-relaxed text-muted-foreground">{t(lang, "localDataErrorHint")}</p>
          <StartupEscapeActions
            lang={lang}
            onRetry={handleRetryStartup}
            onContinueOffline={canContinueOffline ? handleContinueOffline : undefined}
            canContinueOffline={canContinueOffline}
            onSignOut={handleSignOut}
          />
        </div>
      </div>
    );
  }

  if (bootPhase !== "ready") {
    return <StartupLoadingScreen lang={lang} step={startupStep} />;
  }

  return (
    <>
      {children}
      <RecoveryBackgroundBanner lang={lang} onRetry={handleRetryRecovery} />
      {recoveryOverlay ? (
        <div className="fixed inset-0 z-[220]">
          <CloudRecoveryScreen
            lang={lang}
            failed={recoveryOverlay.failed}
            probeFailed={recoveryOverlay.probeFailed}
            onRetry={handleRetryRecovery}
            onSignOut={handleSignOut}
            onContinueOffline={handleContinueOffline}
            canContinueOffline={canContinueOffline}
          />
        </div>
      ) : null}
    </>
  );
}
