import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { OfficeHubArrangePanel } from "../components/office/OfficeHubArrangePanel";

export function SettingsOfficeMenuPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <BackOfficePageLayout
      header={
        <SettingsPageHeader
          lang={lang}
          title={t(lang, "settingsHubOfficeMenu")}
          subtitle={t(lang, "settingsHubOfficeMenuSub")}
        />
      }
      className="pb-8"
    >
      <OfficeHubArrangePanel lang={lang} embedded />
    </BackOfficePageLayout>
  );
}
