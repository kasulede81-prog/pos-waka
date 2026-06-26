import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { bootstrapPosFromDisk, flushPendingPersist, usePosStore } from "../store/usePosStore";

import { getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";

import { initInventorySyncChannel } from "../lib/inventorySyncChannel";

import { forceHideNativeSplash, hideNativeSplashWhenReady, scheduleSplashMaxDuration, scheduleSplashSafetyTimeout } from "../lib/nativeSplash";

import { hasSupabaseConfig } from "../lib/supabase";

import { isLocalShopDataEmpty } from "../lib/cloudSnapshotSync";
import {
  logOnboardingRequired,
  shouldRunCloudRecoveryForAccount,
  userIdFromAccountKey,
} from "../lib/firstTimeOwnerDevice";

import { bootTrace } from "../lib/bootTrace";
import { CloudRecoveryScreen } from "../components/recovery/CloudRecoveryScreen";

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

import type { Language } from "../types";

import { t } from "../lib/i18n";

type Props = {
  children: ReactNode;
  lang?: Language;
  accountKey: string | null;
  onSignOut?: () => void | Promise<void>;
};

function isStoreReadyForAccount(accountKey: string | null): boolean {
  return Boolean(accountKey && usePosStore.getState()._hydrated && getActiveAccountKey() === accountKey);
}

async function markFreshAccountBootstrapReady(): Promise<void> {
  const { markBootstrapSyncComplete } = await import("../lib/syncCheckpoints");
  markBootstrapSyncComplete();
  resetCloudRecoverySessionForRetry();
}

type BootPhase = "disk" | "recovery" | "ready";

export function PosDataProvider({ children, lang = "en", accountKey, onSignOut = async () => {} }: Props) {
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => (!accountKey ? "ready" : "disk"));
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [startupStep, setStartupStep] = useState<StartupStepId>(() => "local_disk");
  const bootGenRef = useRef(0);

  useEffect(() => {
    scheduleSplashMaxDuration();
    scheduleSplashSafetyTimeout();
  }, []);

  useEffect(() => {
    if (!accountKey) return;
    void forceHideNativeSplash();
  }, [accountKey, bootPhase, error, recoveryFailed, probeFailed, stalled]);

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
  }, [bootPhase, error, recoveryFailed, probeFailed]);

  const runRecovery = useCallback(async (gen: number, userId: string | null) => {
    setRecoveryFailed(false);
    setProbeFailed(false);
    setBootPhase("recovery");
    recordStartupStep("cloud_recovery");

    const result = await runCloudRecoveryGated({ forcePull: true });

    if (bootGenRef.current !== gen) return;

    if (result.success) {
      recordStartupRecoveryValidated();
      setBootPhase("ready");
      recordStartupStep("ready");
      logStartupPhase("dashboard_ready", { via: "cloud_recovery" });
      logOnboardingRequired(userId);
      bootTrace("BOOT-014", "Cloud Recovery", "SUCCESS", { userId });
      void hideNativeSplashWhenReady();
    } else if (result.probeFailed) {
      recordStartupStep("cloud_probe", { failureReason: result.error ?? "Cloud probe failed" });
      setProbeFailed(true);
    } else {
      recordStartupStep("cloud_recovery", { failureReason: result.error ?? "Recovery failed" });
      setRecoveryFailed(true);
    }
  }, []);

  const runBoot = useCallback(
    async (gen: number) => {
      bootTrace("BOOT-012", "PosDataProvider.runBoot", "START", { accountKey });
      setError(null);
      setRecoveryFailed(false);
      setProbeFailed(false);
      setStalled(false);

      const userId = userIdFromAccountKey(accountKey);

      if (!accountKey) {
        setBootPhase("ready");
        recordStartupStep("ready");
        logStartupPhase("dashboard_ready", { via: "no_account" });
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

      recordStartupStep("recovery_check");
      const needsRecoveryCheck =
        hasSupabaseConfig && accountKey.startsWith("sb:") && (await shouldRunCloudRecoveryForAccount(userId));

      if (isStoreReadyForAccount(accountKey) && !needsRecoveryCheck && !isCloudRecoveryLockActive()) {
        setBootPhase("ready");
        recordStartupStep("ready");
        logStartupPhase("dashboard_ready", { via: "store_already_ready" });
        logOnboardingRequired(userId);
        void hideNativeSplashWhenReady();
        return;
      }

      setBootPhase("disk");
      recordStartupStep("local_disk");

      try {
        await bootstrapPosFromDisk();
      } catch {
        if (bootGenRef.current === gen) {
          setError("load");
          setBootPhase("ready");
          recordStartupStep("local_disk", { failureReason: "Local data load failed" });
        }
        return;
      }

      if (bootGenRef.current !== gen) return;

      const needsRecovery =
        hasSupabaseConfig && accountKey.startsWith("sb:") && (await shouldRunCloudRecoveryForAccount(userId));

      if (needsRecovery) {
        bootTrace("BOOT-014", "Cloud Recovery", "START", { userId });
        await runRecovery(gen, userId);
        return;
      }

      if (hasSupabaseConfig && accountKey.startsWith("sb:") && isLocalShopDataEmpty()) {
        await markFreshAccountBootstrapReady();
      }

      if (isCloudRecoveryLockActive()) {
        resetCloudRecoverySessionForRetry();
      }

      if (bootGenRef.current !== gen) return;

      recordStartupStep("finalizing");
      setBootPhase("ready");
      recordStartupStep("ready");
      logStartupPhase("dashboard_ready", { via: "first_time_or_local_boot" });
      logOnboardingRequired(userId);
      bootTrace("BOOT-012", "PosDataProvider.runBoot", "SUCCESS", { via: "first_time_or_local_boot" });
      void hideNativeSplashWhenReady();
    },
    [accountKey, runRecovery],
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
    };
  }, [accountKey, runBoot]);

  useEffect(() => {
    if (bootPhase === "ready" || !accountKey) return;
    const id = window.setTimeout(() => {
      setBootPhase("ready");
      recordStartupStep("ready");
      logStartupPhase("dashboard_ready", { via: "boot_timeout_escape" });
      logOnboardingRequired(userIdFromAccountKey(accountKey));
      bootTrace("BOOT-012", "PosDataProvider.runBoot", "TIMEOUT", { via: "boot_timeout_escape", accountKey });
      if (isCloudRecoveryLockActive()) {
        resetCloudRecoverySessionForRetry();
      }
      void hideNativeSplashWhenReady();
    }, 12_000);
    return () => window.clearTimeout(id);
  }, [bootPhase, accountKey]);

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
    setRecoveryOfflineBypass();
    resetCloudRecoverySessionForRetry();
    setRecoveryFailed(false);
    setProbeFailed(false);
    setStalled(false);
    recordStartupStep("finalizing");
    setBootPhase("ready");
    recordStartupStep("ready");
    logStartupPhase("dashboard_ready", { via: "continue_offline" });
    void hideNativeSplashWhenReady();
  }, []);

  const canContinueOffline = !isLocalShopDataEmpty() && usePosStore.getState()._hydrated;

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

  if (error) {
    return (
      <div className={`flex min-h-dvh flex-col items-center justify-center gap-4 ${STARTUP_SCREEN_BG} px-6 py-[max(2rem,env(safe-area-inset-top))]`}>
        <div className="max-w-sm space-y-4 rounded-3xl border-2 border-amber-100 bg-amber-50/90 p-8 shadow-waka-sm">
          <p className="text-xl font-black text-stone-900">{t(lang, "localDataError")}</p>
          <p className="text-base font-medium leading-relaxed text-stone-700">{t(lang, "localDataErrorHint")}</p>
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

  if (bootPhase === "recovery") {
    return (
      <CloudRecoveryScreen
        lang={lang}
        failed={recoveryFailed}
        probeFailed={probeFailed}
        onRetry={handleRetryRecovery}
        onSignOut={handleSignOut}
        onContinueOffline={handleContinueOffline}
        canContinueOffline={canContinueOffline}
      />
    );
  }

  if (bootPhase !== "ready") {
    return <StartupLoadingScreen lang={lang} step={startupStep} />;
  }

  return <>{children}</>;
}
