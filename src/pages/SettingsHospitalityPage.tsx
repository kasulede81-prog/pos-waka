import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { isHospitalityMode, isKitchenEnabledForHospitality } from "../lib/hospitality";

export function SettingsHospitalityPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  const kitchenOn = isKitchenEnabledForHospitality(
    preferences.businessType,
    preferences.hospitalityKitchenEnabled,
  );

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "hospitalitySettingsTitle")}
        subtitle={t(lang, "hospitalitySettingsSub")}
      />

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "hospitalitySettingsKitchenTitle")}</p>
        {preferences.businessType === "bar" ? (
          <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "hospitalitySettingsKitchenDefaultBar")}</p>
        ) : null}
        <div className="mt-4 space-y-3">
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-stone-100 px-3 py-2 text-base font-bold text-stone-900">
            <input
              type="radio"
              name="hospitalityKitchen"
              checked={kitchenOn}
              onChange={() => setPreferences({ hospitalityKitchenEnabled: true })}
              className="h-5 w-5 accent-waka-600"
            />
            {t(lang, "hospitalitySettingsKitchenOn")}
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-stone-100 px-3 py-2 text-base font-bold text-stone-900">
            <input
              type="radio"
              name="hospitalityKitchen"
              checked={!kitchenOn}
              onChange={() => setPreferences({ hospitalityKitchenEnabled: false })}
              className="h-5 w-5 accent-waka-600"
            />
            {t(lang, "hospitalitySettingsKitchenOff")}
          </label>
        </div>
      </article>
    </div>
  );
}
