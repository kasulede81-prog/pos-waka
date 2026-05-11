import { useEffect, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { bootstrapPosFromDisk } from "../store/usePosStore";
import { t } from "../lib/i18n";
import type { Language } from "../types";

type Props = {
  children: ReactNode;
  lang?: Language;
};

function LoadingSkeleton({ lang }: { lang: Language }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-waka-50/90 via-stone-50 to-stone-100 px-5 pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div>
          <div className="h-8 w-40 rounded-xl waka-skeleton-bar" />
          <div className="mt-3 h-4 w-full max-w-xs rounded-lg waka-skeleton-bar opacity-80" />
        </div>
        <p className="text-center text-lg font-black text-stone-800">{t(lang, "openingShop")}</p>
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

export function PosDataProvider({ children, lang = "en" }: Props) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
