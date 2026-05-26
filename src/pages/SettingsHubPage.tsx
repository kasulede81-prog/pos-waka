import { Navigate, useSearchParams } from "react-router-dom";
import { Store, Sliders, Bell, KeyRound, Printer } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { PageBackBar } from "../components/layout/PageBackBar";
import { OfficeNavSection } from "../components/office/OfficeNavSection";
import { OfficeNavCard } from "../components/office/OfficeNavCard";

export function SettingsHubPage({ lang }: { lang: Language }) {
  const [searchParams] = useSearchParams();
  if (searchParams.get("onboard") === "1") {
    return <Navigate to="/settings/shop?onboard=1" replace />;
  }

  const actor = useSessionActor();
  if (!hasPermission(actor.role, "settings.view")) {
    return <Navigate to="/" replace />;
  }

  const canShop = hasPermission(actor.role, "settings.shop");

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/office" label={t(lang, "officeBackToHub")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "settingsHubTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "settingsHubSub")}</p>
      </div>

      <OfficeNavSection title={t(lang, "settingsHubGroupShop")}>
        {canShop ? (
          <OfficeNavCard
            to="/settings/shop"
            title={t(lang, "settingsHubShop")}
            subtitle={t(lang, "settingsHubShopSub")}
            Icon={Store}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/selling"
            title={t(lang, "settingsHubSelling")}
            subtitle={t(lang, "settingsHubSellingSub")}
            Icon={Sliders}
          />
        ) : null}
        {canShop ? (
          <OfficeNavCard
            to="/settings/pin"
            title={t(lang, "settingsHubPin")}
            subtitle={t(lang, "settingsHubPinSub")}
            Icon={KeyRound}
          />
        ) : null}
        <OfficeNavCard
          to="/office/hardware"
          title={t(lang, "officeCardHardware")}
          subtitle={t(lang, "officeCardHardwareSub")}
          Icon={Printer}
        />
      </OfficeNavSection>

      <OfficeNavSection title={t(lang, "settingsHubGroupApp")}>
        <OfficeNavCard
          to="/settings/notifications"
          title={t(lang, "settingsHubNotifications")}
          subtitle={t(lang, "settingsHubNotificationsSub")}
          Icon={Bell}
        />
      </OfficeNavSection>
    </div>
  );
}
