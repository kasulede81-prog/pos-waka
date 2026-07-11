import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsAutoSaveShell } from "../components/enterprise/SettingsAutoSaveShell";
import { usePreferencesPatch } from "../components/enterprise/preferencesAutoSaveContext";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";

function NotificationsSettingsBody({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const savePreferences = usePreferencesPatch();

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <WakaSwitch
        checked={preferences.hapticsOn !== false}
        onCheckedChange={(checked) => savePreferences({ hapticsOn: checked })}
        label={t(lang, "hapticsSetting")}
      />
      <WakaSwitch
        checked={preferences.saleSoundOn !== false}
        onCheckedChange={(checked) => savePreferences({ saleSoundOn: checked })}
        label={t(lang, "saleSoundSetting")}
        className="mt-4 border-t border-border pt-4"
      />
    </article>
  );
}

export function SettingsNotificationsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  if (!actorHasPermission(actor, "settings.view")) {
    return <Navigate to="/settings" replace />;
  }
  return (
    <SettingsAutoSaveShell
      lang={lang}
      title={t(lang, "settingsHubNotifications")}
      subtitle={t(lang, "settingsHubNotificationsSub")}
    >
      <NotificationsSettingsBody lang={lang} />
    </SettingsAutoSaveShell>
  );
}
