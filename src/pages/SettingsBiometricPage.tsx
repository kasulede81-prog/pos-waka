import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { BiometricAuthSettingsForm } from "../components/settings/BiometricAuthSettingsForm";

export function SettingsBiometricPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();

  if (actor.role !== "owner") {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "biometricSettingsTitle")}
        subtitle={t(lang, "biometricSettingsPageSub")}
      />
      <BiometricAuthSettingsForm lang={lang} />
    </div>
  );
}
