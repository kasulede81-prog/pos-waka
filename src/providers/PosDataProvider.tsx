import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { bootstrapPosFromDisk, flushPendingPersist, usePosStore } from "../store/usePosStore";

import { getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";

import { initInventorySyncChannel } from "../lib/inventorySyncChannel";

import { hideNativeSplashWhenReady } from "../lib/nativeSplash";

import { hasSupabaseConfig } from "../lib/supabase";

import { WakaPosLogo } from "../components/brand/WakaLogo";

import { t } from "../lib/i18n";

import type { Language } from "../types";

import { CloudRecoveryScreen } from "../components/recovery/CloudRecoveryScreen";

import {
  isCloudRecoveryLockActive,
  resetCloudRecoverySessionForRetry,
} from "../lib/cloudRecoverySession";

import { runCloudRecoveryGated, shouldRequireRecoveryLock } from "../lib/postAuthCloudHydrate";

type Props = {
  children: ReactNode;
  lang?: Language;
  accountKey: string | null;
};

function LoadingSkeleton({ lang }: { lang: Language }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#fffaf5] px-5 pt-[max(2rem,env(safe-area-inset-top))]">
      <WakaPosLogo size="splash" className="mb-8 mt-4" />
      <div className="mx-auto w-full max-w-md space-y-6">
        <p className="text-center text-lg font-black text-stone-800">{t(lang, "openingShop")}</p>
        <p className="text-center text-xs font-medium text-stone-500">{t(lang, "openingShopLocalHint")}</p>
        <p className="text-center text-sm font-medium leading-relaxed text-waka-900/90">{t(lang, "loadingTrustLine")}</p>
        <div className="space-y-3 rounded-3xl border border-stone-100 bg-white/90 p-5 shadow-waka-sm">
          <div className="h-14 w-full rounded-2xl waka-skeleton-bar" />
          <div className="h-14 w-full rounded-2xl waka-skeleton-bar opacity-90" />
          <div className="h-14 w-[72%] rounded-2xl waka-skeleton-bar opacity-75" />
        </div>
      </div>
    </div>
  );
}

function isStoreReadyForAccount(accountKey: string | null): boolean {
  return Boolean(accountKey && usePosStore.getState()._hydrated && getActiveAccountKey() === accountKey);
}

/** Fail closed — if lock check throws, assume recovery is required. */
async function needsRecoveryLockFailClosed(): Promise<boolean> {
  if (!hasSupabaseConfig) return false;
  return shouldRequireRecoveryLock().catch(() => true);
}

type BootPhase = "disk" | "recovery" | "ready";

export function PosDataProvider({ children, lang = "en", accountKey }: Props) {
  const [bootPhase, setBootPhase] = useState<BootPhase>(() => (!accountKey ? "ready" : "disk"));
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootGenRef = useRef(0);

  const runRecovery = useCallback(async (gen: number) => {
    setRecoveryFailed(false);
    setProbeFailed(false);
    setBootPhase("recovery");

    const result = await runCloudRecoveryGated({ forcePull: true });

    if (bootGenRef.current !== gen) return;

    if (result.success) {
      setBootPhase("ready");
      void hideNativeSplashWhenReady();
    } else if (result.probeFailed) {
      setProbeFailed(true);
    } else {
      setRecoveryFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!accountKey) return;

    const dispose = initInventorySyncChannel((msg) => {
      usePosStore.getState().applyRemoteInventorySync(msg);
    });

    return dispose;
  }, [accountKey]);

  useEffect(() => {
    const gen = ++bootGenRef.current;
    setError(null);
    setRecoveryFailed(false);
    setProbeFailed(false);

    if (!accountKey) {
      setBootPhase("ready");
      return;
    }

    if (getActiveAccountKey() !== accountKey) {
      flushPendingPersist();
      usePosStore.getState().resetForSignOut();
      setActiveAccountKey(accountKey);
    }

    void (async () => {
      const needsRecoveryCheck =
        hasSupabaseConfig && accountKey.startsWith("sb:") && (await needsRecoveryLockFailClosed());

      if (isStoreReadyForAccount(accountKey) && !needsRecoveryCheck && !isCloudRecoveryLockActive()) {
        setBootPhase("ready");
        void hideNativeSplashWhenReady();
        return;
      }

      setBootPhase("disk");

      try {
        await bootstrapPosFromDisk();
      } catch {
        if (bootGenRef.current === gen) setError("load");
        return;
      }

      if (bootGenRef.current !== gen) return;

      const needsRecovery =
        hasSupabaseConfig && accountKey.startsWith("sb:") && (await needsRecoveryLockFailClosed());

      if (needsRecovery) {
        await runRecovery(gen);
        return;
      }

      setBootPhase("ready");
      void hideNativeSplashWhenReady();
    })();

    return () => {
      bootGenRef.current += 1;
    };
  }, [accountKey, runRecovery]);

  const handleRetryRecovery = useCallback(() => {
    const gen = bootGenRef.current;
    resetCloudRecoverySessionForRetry();
    void runRecovery(gen);
  }, [runRecovery]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-stone-100 px-6 text-center">
        <div className="max-w-sm rounded-3xl border-2 border-amber-100 bg-amber-50/90 p-8 shadow-waka-sm">
          <p className="text-xl font-black text-stone-900">{t(lang, "localDataError")}</p>
          <p className="mt-3 text-base font-medium leading-relaxed text-stone-700">{t(lang, "localDataErrorHint")}</p>
          <p className="mt-4 text-sm font-semibold text-waka-900">{t(lang, "loadingTrustLine")}</p>
        </div>
      </div>
    );
  }

  if (bootPhase === "recovery" || isCloudRecoveryLockActive()) {
    return (
      <CloudRecoveryScreen
        lang={lang}
        failed={recoveryFailed}
        probeFailed={probeFailed}
        onRetry={handleRetryRecovery}
      />
    );
  }

  if (bootPhase !== "ready") {
    return <LoadingSkeleton lang={lang} />;
  }

  return <>{children}</>;
}
