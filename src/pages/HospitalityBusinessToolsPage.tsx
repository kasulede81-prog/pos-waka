import { Link } from "react-router-dom";
import { Briefcase, Settings } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { actorHasEffectivePermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { PageBackBar } from "../components/layout/PageBackBar";
import { DesktopHomeTiles } from "../components/home/DesktopHomeTiles";
import { HOSPITALITY_HOME_ROUTE } from "../lib/hospitalityNav";
import { themeUi } from "../lib/themeTokens";
import clsx from "clsx";

/**
 * Shared Kiosk Duka launcher inside Hospitality. It renders the existing
 * `DesktopHomeTiles`, so the same launcher catalog, role permissions and
 * Home Menu visibility/order settings apply. Back Office and Settings keep
 * their existing route/PIN guards.
 */
export function HospitalityBusinessToolsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const canFloor = actorHasEffectivePermission(actor, "hospitality.floor", snapshot, authMode);
  const canBackOffice = actorHasEffectivePermission(actor, "back_office.access", snapshot, authMode);
  const canSettings = actorHasEffectivePermission(actor, "settings.view", snapshot, authMode);

  return (
    <div className="space-y-4 pb-8">
      <PageBackBar
        lang={lang}
        fallbackTo={canFloor ? HOSPITALITY_HOME_ROUTE : "/"}
        label={canFloor ? t(lang, "navHome") : t(lang, "desktopHomeTitle")}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-foreground">
            {t(lang, "hospitalityBusinessToolsTitle")}
          </h1>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            {t(lang, "hospitalityBusinessToolsSub")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canBackOffice ? (
            <Link
              to="/office"
              className={clsx(themeUi.btnSecondary, "inline-flex min-h-11 items-center gap-2 px-4")}
            >
              <Briefcase className="h-4 w-4" aria-hidden />
              {t(lang, "desktopHomeTileShop")}
            </Link>
          ) : null}
          {canSettings ? (
            <Link
              to="/settings"
              className={clsx(themeUi.btnSecondary, "inline-flex min-h-11 items-center gap-2 px-4")}
            >
              <Settings className="h-4 w-4" aria-hidden />
              {t(lang, "desktopHomeTileSettings")}
            </Link>
          ) : null}
        </div>
      </div>

      <p className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 text-xs font-semibold text-waka-950">
        {t(lang, "hospitalityBusinessToolsHint")}
      </p>

      <DesktopHomeTiles lang={lang} />
    </div>
  );
}
