import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { HomeMenuArrangePanel } from "../components/home/HomeMenuArrangePanel";

export function SettingsHomeMenuPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <BackOfficePageLayout
      header={
        <SettingsPageHeader
          lang={lang}
          title={t(lang, "settingsHubHomeMenu")}
          subtitle={t(lang, "settingsHubHomeMenuSub")}
          backTo="/settings"
        />
      }
      className="pb-8"
    >
      <HomeMenuArrangePanel lang={lang} embedded />
    </BackOfficePageLayout>
  );
}
