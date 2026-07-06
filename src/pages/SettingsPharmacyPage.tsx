import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { isPharmacyMode } from "../lib/pharmacy";
import type { PharmacyExpiredSaleBehavior } from "../lib/pharmacyExpiry";
import { defaultCompliancePrefs } from "../lib/pharmacyControlledMedicine";

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
  const compliance = { ...defaultCompliancePrefs(), ...preferences.pharmacyCompliance };

  const patchCompliance = (patch: Partial<typeof compliance>) => {
    setPreferences({ pharmacyCompliance: { ...compliance, ...patch } });
  };

  return (
    <div className="page-content-pad space-y-5">
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
              className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-stone-100 px-3 py-2 text-base font-bold text-stone-900"
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

      <article className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm">
        <p className="text-base font-black text-violet-950">{t(lang, "pharmacyComplianceSettingsTitle")}</p>
        <p className="mt-1 text-sm font-semibold text-stone-600">{t(lang, "pharmacyComplianceSettingsSub")}</p>

        <label className="mt-4 flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-violet-100 bg-white px-3 py-2 text-base font-bold text-stone-900">
          <input
            type="checkbox"
            checked={Boolean(compliance.witnessWorkflowEnabled)}
            onChange={(e) => patchCompliance({ witnessWorkflowEnabled: e.target.checked })}
            className="h-5 w-5 accent-violet-600"
          />
          {t(lang, "pharmacyComplianceWitnessWorkflow")}
        </label>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "pharmacyComplianceLargeQtyThreshold")}
            <input
              type="number"
              min={1}
              value={compliance.largeControlledQuantityThreshold ?? 30}
              onChange={(e) =>
                patchCompliance({ largeControlledQuantityThreshold: Math.max(1, Math.floor(Number(e.target.value) || 30)) })
              }
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base font-bold"
            />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "pharmacyComplianceOverrideThreshold")}
            <input
              type="number"
              min={1}
              value={compliance.frequentOverrideThreshold ?? 5}
              onChange={(e) =>
                patchCompliance({ frequentOverrideThreshold: Math.max(1, Math.floor(Number(e.target.value) || 5)) })
              }
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base font-bold"
            />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "pharmacyComplianceOverrideWindow")}
            <input
              type="number"
              min={1}
              value={compliance.frequentOverrideWindowHours ?? 24}
              onChange={(e) =>
                patchCompliance({ frequentOverrideWindowHours: Math.max(1, Math.floor(Number(e.target.value) || 24)) })
              }
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base font-bold"
            />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "pharmacyComplianceFailedApprovalThreshold")}
            <input
              type="number"
              min={1}
              value={compliance.failedApprovalAlertThreshold ?? 3}
              onChange={(e) =>
                patchCompliance({ failedApprovalAlertThreshold: Math.max(1, Math.floor(Number(e.target.value) || 3)) })
              }
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-violet-200 px-3 text-base font-bold"
            />
          </label>
        </div>
      </article>
    </div>
  );
}
