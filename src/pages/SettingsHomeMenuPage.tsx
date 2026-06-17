import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { HomeMenuArrangePanel } from "../components/home/HomeMenuArrangePanel";

export function SettingsHomeMenuPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubHomeMenu")}
        subtitle={t(lang, "settingsHubHomeMenuSub")}
      />
      <HomeMenuArrangePanel lang={lang} embedded />
    </div>
  );
}
