import { useMemo } from "react";
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
import { useSessionActor } from "../context/SessionActorContext";

type Props = { lang: Language };

function homeGreetingKey(hour: number): string {
  if (hour < 12) return "desktopHomeGreetingMorning";
  if (hour < 17) return "desktopHomeGreetingAfternoon";
  return "desktopHomeGreetingEvening";
}

export function DesktopHomePage({ lang }: Props) {
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim());
  const actor = useSessionActor();
  const greetingKey = useMemo(() => homeGreetingKey(new Date().getHours()), []);

  useEffect(() => {
    runWhenIdle(() => prefetchOfficeHub());
  }, []);

  const firstName = actor.displayName?.trim().split(/\s+/)[0];

  return (
    <div className="flex min-h-full flex-col lg:min-h-[calc(100dvh-4.5rem)]">
      <div className="flex flex-1 flex-col items-center px-4 py-5 sm:px-8 sm:py-8 lg:px-10 xl:px-14">
        <header className="mb-5 w-full max-w-none text-center sm:text-left">
          {firstName ? (
            <h1 className="text-xl font-black tracking-tight text-waka-950 sm:text-2xl">
              {t(lang, greetingKey).replace("{name}", firstName)}
            </h1>
          ) : (
            <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
          )}
          <p className="mt-1 text-sm font-medium text-waka-900/70">
            {shopName ? `${shopName} · ` : ""}
            {t(lang, "desktopHomeGreetingSub")}
          </p>
        </header>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="shrink-0 border-t border-waka-200/80 bg-white/90 px-4 py-4 backdrop-blur-sm sm:px-8 lg:px-10 xl:px-14">
        <div className="mx-auto w-full max-w-none">
          <DesktopStatusChips lang={lang} />
          <DesktopSubscriptionBanner lang={lang} />
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
