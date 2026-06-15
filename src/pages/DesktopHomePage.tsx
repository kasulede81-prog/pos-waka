import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { DesktopHomeTiles } from "../components/home/DesktopHomeTiles";
import { DesktopStatusChips } from "../components/home/DesktopStatusChips";
import { DesktopLicenseBar } from "../components/home/DesktopLicenseBar";
import { DesktopSubscriptionBanner } from "../components/home/DesktopSubscriptionBanner";

type Props = { lang: Language };

export function DesktopHomePage({ lang }: Props) {
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim());

  return (
    <div className="-mx-3 flex min-h-[calc(100dvh-8rem)] flex-col bg-gradient-to-b from-stone-900 via-stone-900 to-stone-800 sm:-mx-4 md:-mx-6">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8">
        {shopName ? (
          <p className="mb-5 text-center text-xs font-bold uppercase tracking-[0.28em] text-stone-400">
            {shopName}
          </p>
        ) : null}
        <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="shrink-0 border-t border-stone-700/80 bg-stone-900/95 px-4 py-4 backdrop-blur-sm sm:px-8">
        <div className="mx-auto w-full max-w-4xl">
          <DesktopStatusChips lang={lang} />
          <DesktopSubscriptionBanner lang={lang} />
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
