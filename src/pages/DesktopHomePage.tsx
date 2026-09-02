import { useEffect, useMemo } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
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
import { HOME_TYPE_SCALE } from "../lib/homeComposition";

type Props = { lang: Language };

function homeGreetingKey(hour: number): string {
  if (hour < 12) return "desktopHomeGreetingMorning";
  if (hour < 17) return "desktopHomeGreetingAfternoon";
  return "desktopHomeGreetingEvening";
}

/**
 * Phase 34.1 — executive Home shell.
 * HOME CINEMATIC V3.1 — content-sized composition. Footer is a compact status line.
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
    <div className="home-cinematic-shell home-cinematic-shell--stage home-cinematic-shell--living min-h-full">
      <div className="home-cinematic-shell__wash" aria-hidden />
      <div className={`${HOME_CONTENT_MEASURE_CLASS} ${HOME_PAGE_GUTTER_CLASS} flex flex-col`}>
        <header className="home-cinematic-greeting home-console-greeting mb-1.5 hidden w-full text-center sm:mb-2 sm:text-left md:block">
          {firstName ? (
            <h1 className={`${HOME_TYPE_SCALE.greeting} text-foreground`}>
              {t(lang, greetingKey).replace("{name}", firstName)}
            </h1>
          ) : (
            <h1 className="sr-only">{t(lang, "desktopHomeTitle")}</h1>
          )}
          <p className={`mt-0.5 ${HOME_TYPE_SCALE.greetingSub}`}>
            {shopName ? `${shopName} · ` : ""}
            {t(lang, "desktopHomeGreetingSub")}
          </p>
        </header>
        <DesktopHomeTiles lang={lang} />
      </div>
      <footer className="home-license-footer">
        <div className={`${HOME_CONTENT_MEASURE_CLASS} ${HOME_FOOTER_GUTTER_CLASS}`}>
          <DesktopLicenseBar lang={lang} />
        </div>
      </footer>
    </div>
  );
}
