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
import {
  HOME_CONTENT_MEASURE_CLASS,
  HOME_FOOTER_GUTTER_CLASS,
  HOME_PAGE_GUTTER_CLASS,
} from "../lib/homePresentation";

type Props = { lang: Language };

function homeGreetingKey(hour: number): string {
  if (hour < 12) return "desktopHomeGreetingMorning";
  if (hour < 17) return "desktopHomeGreetingAfternoon";
  return "desktopHomeGreetingEvening";
}

/**
 * Phase 34.1 — executive Home shell.
 * Health/subscription live above the fold inside DesktopHomeTiles; footer keeps license only.
 * HOME CINEMATIC DENSITY V1 — tighter greeting + measure; tiles own the pulse composition.
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
    <div className="home-cinematic-shell flex flex-col">
      <div className={`${HOME_CONTENT_MEASURE_CLASS} ${HOME_PAGE_GUTTER_CLASS} flex flex-col`}>
        <header className="home-cinematic-greeting mb-2 w-full text-center sm:mb-2.5 sm:text-left">
          {firstName ? (
            <h1 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
              {t(lang, greetingKey).replace("{name}", firstName)}
            </h1>
          ) : (
            <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
          )}
          <p className="mt-0.5 text-xs font-medium text-muted-foreground sm:text-sm">
            {shopName ? `${shopName} · ` : ""}
            {t(lang, "desktopHomeGreetingSub")}
          </p>
        </header>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="border-t border-border bg-card/90 backdrop-blur-sm">
        <div className={`${HOME_CONTENT_MEASURE_CLASS} ${HOME_FOOTER_GUTTER_CLASS}`}>
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
