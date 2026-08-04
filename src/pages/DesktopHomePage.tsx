import { useMemo } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useEffect } from "react";
import { prefetchOfficeHub } from "../lib/prefetchRoutes";
import { runWhenIdle } from "../lib/uiYield";
import { DesktopHomeTiles } from "../components/home/DesktopHomeTiles";
import { DesktopLicenseBar } from "../components/home/DesktopLicenseBar";
import { useSessionActor } from "../context/SessionActorContext";

type Props = { lang: Language };

function homeGreetingKey(hour: number): string {
  if (hour < 12) return "desktopHomeGreetingMorning";
  if (hour < 17) return "desktopHomeGreetingAfternoon";
  return "desktopHomeGreetingEvening";
}

/**
 * Phase 34.1 — executive Home shell.
 * Health/subscription live above the fold inside DesktopHomeTiles; footer keeps license only.
 */
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
      <div className="flex flex-1 flex-col items-center px-4 py-4 sm:px-8 sm:py-6 lg:px-10 xl:px-14">
        <header className="mb-3 w-full max-w-none text-center sm:mb-4 sm:text-left">
          {firstName ? (
            <h1 className="text-lg font-black tracking-tight text-foreground sm:text-xl">
              {t(lang, greetingKey).replace("{name}", firstName)}
            </h1>
          ) : (
            <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
          )}
          <p className="mt-0.5 text-sm font-medium text-muted-foreground">
            {shopName ? `${shopName} · ` : ""}
            {t(lang, "desktopHomeGreetingSub")}
          </p>
        </header>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="shrink-0 border-t border-border bg-card/90 px-4 py-3 backdrop-blur-sm sm:px-8 lg:px-10 xl:px-14">
        <div className="mx-auto w-full max-w-none">
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
