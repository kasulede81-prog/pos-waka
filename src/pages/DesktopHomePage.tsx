import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useEffect } from "react";
import { prefetchOfficeHub } from "../lib/prefetchRoutes";
import { runWhenIdle } from "../lib/uiYield";
import { DesktopHomeTiles } from "../components/home/DesktopHomeTiles";
import { DesktopStatusChips } from "../components/home/DesktopStatusChips";
import { DesktopLicenseBar } from "../components/home/DesktopLicenseBar";
import { DesktopSubscriptionBanner } from "../components/home/DesktopSubscriptionBanner";

type Props = { lang: Language };

export function DesktopHomePage({ lang }: Props) {
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim());

  useEffect(() => {
    runWhenIdle(() => prefetchOfficeHub());
  }, []);

  return (
    <div className="flex min-h-full flex-col lg:min-h-[calc(100dvh-4.5rem)]">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-8 sm:py-8">
        {shopName ? (
          <p className="mb-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-waka-900/70 sm:mb-5">
            {shopName}
          </p>
        ) : null}
        <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="shrink-0 border-t border-waka-200/80 bg-white/90 px-4 py-4 backdrop-blur-sm sm:px-8">
        <div className="mx-auto w-full max-w-4xl">
          <DesktopStatusChips lang={lang} />
          <DesktopSubscriptionBanner lang={lang} />
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
