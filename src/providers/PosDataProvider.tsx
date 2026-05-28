import { useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { bootstrapPosFromDisk, flushPendingPersist, usePosStore } from "../store/usePosStore";
import { getActiveAccountKey, setActiveAccountKey } from "../offline/accountScope";
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

function LoadingSkeleton({ lang }: { lang: Language }) {
  return (
      <div className="flex min-h-dvh flex-col items-center bg-white px-5 pt-[max(2rem,env(safe-area-inset-top))]">
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

export function PosDataProvider({ children, lang = "en", accountKey }: Props) {
  const [ready, setReady] = useState(() => !accountKey || isStoreReadyForAccount(accountKey));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!accountKey) {
      setReady(true);
      return () => {
        cancelled = true;
      };
    }
    if (getActiveAccountKey() !== accountKey) {
      flushPendingPersist();
      usePosStore.getState().resetForSignOut();
      setActiveAccountKey(accountKey);
    }
    if (isStoreReadyForAccount(accountKey)) {
      setReady(true);
      if (Capacitor.isNativePlatform()) {
        void SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => undefined);
      }
      return () => {
        cancelled = true;
      };
    }
    setReady(false);
    void bootstrapPosFromDisk()
      .catch(() => {
        if (!cancelled) setError("load");
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
          if (Capacitor.isNativePlatform()) {
            void SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => undefined);
          }
        }
      });
    return () => {
      cancelled = true;
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
    return <LoadingSkeleton lang={lang} />;
  }

  return <>{children}</>;
}
