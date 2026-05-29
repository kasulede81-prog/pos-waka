import { useEffect, useRef, useState, type ReactNode } from "react";
import { bootstrapPosFromDisk, flushPendingPersist, usePosStore } from "../store/usePosStore";
import { getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";
import { hideNativeSplashWhenReady } from "../lib/nativeSplash";
import { hasSupabaseConfig } from "../lib/supabase";
import { isLocalShopDataEmpty } from "../lib/cloudSnapshotSync";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { t } from "../lib/i18n";
import type { Language } from "../types";

type Props = {
  children: ReactNode;
  lang?: Language;
  /**
   * Stable per-account namespace key from `useAuth`. Re-bootstraps the
   * POS store from disk whenever the signed-in account changes so the UI
   * never carries data across users on the same device.
   */
  accountKey: string | null;
};

function LoadingSkeleton({ lang, cloudRestore }: { lang: Language; cloudRestore?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#fffaf5] px-5 pt-[max(2rem,env(safe-area-inset-top))]">
      <WakaPosLogo size="splash" className="mb-8 mt-4" />
      <div className="mx-auto w-full max-w-md space-y-6">
        <p className="text-center text-lg font-black text-stone-800">{t(lang, "openingShop")}</p>
        <p className="text-center text-xs font-medium text-stone-500">
          {cloudRestore ? t(lang, "openingShopCloudHint") : t(lang, "openingShopLocalHint")}
        </p>
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

export function PosDataProvider({ children, lang = "en", accountKey }: Props) {
  const [ready, setReady] = useState(() => !accountKey || isStoreReadyForAccount(accountKey));
  const [error, setError] = useState<string | null>(null);
  const [cloudRestore, setCloudRestore] = useState(false);
  const bootGenRef = useRef(0);

  useEffect(() => {
    const gen = ++bootGenRef.current;
    setError(null);

    if (!accountKey) {
      setReady(true);
      return;
    }

    if (getActiveAccountKey() !== accountKey) {
      flushPendingPersist();
      usePosStore.getState().resetForSignOut();
      setActiveAccountKey(accountKey);
    }

    if (isStoreReadyForAccount(accountKey)) {
      setReady(true);
      hideNativeSplashWhenReady();
      return;
    }

    setReady(false);

    void bootstrapPosFromDisk()
      .catch(() => {
        if (bootGenRef.current === gen) setError("load");
      })
      .finally(async () => {
        if (bootGenRef.current !== gen) return;
        const shouldPullCloud =
          hasSupabaseConfig && accountKey.startsWith("sb:") && isLocalShopDataEmpty();
        if (shouldPullCloud) {
          setCloudRestore(true);
          const { hydrateAccountFromCloud } = await import("../lib/postAuthCloudHydrate");
          await hydrateAccountFromCloud({ forcePull: true }).catch(() => undefined);
          setCloudRestore(false);
        }
        setReady(true);
        void hideNativeSplashWhenReady();
      });

    return () => {
      bootGenRef.current += 1;
    };
  }, [accountKey]);

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

  if (!ready) {
    return <LoadingSkeleton lang={lang} cloudRestore={cloudRestore} />;
  }

  return <>{children}</>;
}
