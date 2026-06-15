import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { DesktopHomeTiles } from "../components/home/DesktopHomeTiles";
import { DesktopStatusChips } from "../components/home/DesktopStatusChips";
import { DesktopLicenseBar } from "../components/home/DesktopLicenseBar";

type Props = { lang: Language };

export function DesktopHomePage({ lang }: Props) {
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim());

  return (
    <div className="-mx-3 flex min-h-[calc(100dvh-8rem)] flex-col bg-gradient-to-br from-stone-100 via-white to-waka-50/40 sm:-mx-4 md:-mx-6">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8">
        {shopName ? (
          <p className="mb-6 text-center text-sm font-bold uppercase tracking-[0.2em] text-stone-500">
            {shopName}
          </p>
        ) : null}
        <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="shrink-0 border-t border-stone-200/80 bg-white/80 px-4 py-4 backdrop-blur-sm sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <DesktopStatusChips lang={lang} />
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
