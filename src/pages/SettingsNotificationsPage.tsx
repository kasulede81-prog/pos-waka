import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";

export function SettingsNotificationsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  if (!hasPermission(actor.role, "settings.view")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "settingsHubNotifications")}
        subtitle={t(lang, "settingsHubNotificationsSub")}
      />

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="flex min-h-[52px] cursor-pointer items-center gap-3 text-base font-bold text-stone-900">
          <input
            type="checkbox"
            checked={preferences.hapticsOn !== false}
            onChange={(e) => setPreferences({ hapticsOn: e.target.checked })}
            className="h-6 w-6 rounded border-2 border-stone-400 accent-waka-600"
          />
          {t(lang, "hapticsSetting")}
        </label>
        <label className="mt-4 flex min-h-[52px] cursor-pointer items-center gap-3 text-base font-bold text-stone-900">
          <input
            type="checkbox"
            checked={preferences.saleSoundOn !== false}
            onChange={(e) => setPreferences({ saleSoundOn: e.target.checked })}
            className="h-6 w-6 rounded border-2 border-stone-400 accent-waka-600"
          />
          {t(lang, "saleSoundSetting")}
        </label>
      </article>
    </div>
  );
}
