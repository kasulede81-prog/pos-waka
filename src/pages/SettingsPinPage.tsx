import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { BackOfficePinForm } from "../components/settings/BackOfficePinForm";

export function SettingsPinPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubPin")}
        subtitle={t(lang, "settingsBackOfficePinSub")}
      />
      <BackOfficePinForm lang={lang} />
    </div>
  );
}
