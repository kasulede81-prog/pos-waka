import { Navigate, useLocation } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { BackOfficePinForm } from "../components/settings/BackOfficePinForm";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";

export function SettingsPinPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const location = useLocation();
  const lockState = location.state as { setupLockPin?: boolean; notice?: string } | null;
  const fromLockSetup = Boolean(lockState?.setupLockPin);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <EnterprisePageContainer>
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubPin")}
        subtitle={t(lang, "settingsBackOfficePinSub")}
      />
      {fromLockSetup ? (
        <p className="rounded-2xl border border-waka-200 bg-waka-50 px-4 py-3 text-sm font-semibold text-waka-950">
          {lockState?.notice ?? t(lang, "lockPosSetupBanner")}
        </p>
      ) : null}
      <BackOfficePinForm lang={lang} />
    </EnterprisePageContainer>
  );
}
