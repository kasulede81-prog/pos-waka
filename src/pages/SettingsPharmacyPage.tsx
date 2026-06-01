import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { isPharmacyMode } from "../lib/pharmacy";
import type { PharmacyExpiredSaleBehavior } from "../lib/pharmacyExpiry";

export function SettingsPharmacyPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  if (!isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  const behavior = preferences.pharmacyExpiredSaleBehavior ?? "warn";

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "pharmacySettingsTitle")}
        subtitle={t(lang, "pharmacySettingsSub")}
      />

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "pharmacyExpiredSaleBehavior")}</p>
        <div className="mt-4 space-y-3">
          {(["warn", "block"] as PharmacyExpiredSaleBehavior[]).map((value) => (
            <label
              key={value}
              className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-stone-100 px-3 py-2 text-base font-bold text-slate-900"
            >
              <input
                type="radio"
                name="pharmacyExpiredSaleBehavior"
                checked={behavior === value}
                onChange={() => setPreferences({ pharmacyExpiredSaleBehavior: value })}
                className="h-5 w-5 accent-waka-600"
              />
              {t(lang, value === "warn" ? "pharmacyExpiredSaleWarn" : "pharmacyExpiredSaleBlock")}
            </label>
          ))}
        </div>
      </article>
    </div>
  );
}
