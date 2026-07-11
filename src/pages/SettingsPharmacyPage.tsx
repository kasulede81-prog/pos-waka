import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsAutoSaveShell } from "../components/enterprise/SettingsAutoSaveShell";
import { usePreferencesPatch } from "../components/enterprise/preferencesAutoSaveContext";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { isPharmacyMode } from "../lib/pharmacy";
import type { PharmacyExpiredSaleBehavior } from "../lib/pharmacyExpiry";
import { defaultCompliancePrefs } from "../lib/pharmacyControlledMedicine";

function PharmacySettingsBody({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const savePreferences = usePreferencesPatch();

  const behavior = preferences.pharmacyExpiredSaleBehavior ?? "warn";
  const compliance = { ...defaultCompliancePrefs(), ...preferences.pharmacyCompliance };

  const patchCompliance = (patch: Partial<typeof compliance>) => {
    savePreferences({ pharmacyCompliance: { ...compliance, ...patch } });
  };

  return (
    <>
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "pharmacyExpiredSaleBehavior")}</p>
        <div className="mt-4 space-y-3">
          {(["warn", "block"] as PharmacyExpiredSaleBehavior[]).map((value) => (
            <label
              key={value}
              className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-base font-bold text-foreground"
            >
              <input
                type="radio"
                name="pharmacyExpiredSaleBehavior"
                checked={behavior === value}
                onChange={() => savePreferences({ pharmacyExpiredSaleBehavior: value })}
                className="h-5 w-5 accent-waka-600"
              />
              {t(lang, value === "warn" ? "pharmacyExpiredSaleWarn" : "pharmacyExpiredSaleBlock")}
            </label>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm">
        <p className="text-base font-black text-violet-950">{t(lang, "pharmacyComplianceSettingsTitle")}</p>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "pharmacyComplianceSettingsSub")}</p>

        <WakaSwitch
          checked={Boolean(compliance.witnessWorkflowEnabled)}
          onCheckedChange={(checked) => patchCompliance({ witnessWorkflowEnabled: checked })}
          label={t(lang, "pharmacyComplianceWitnessWorkflow")}
          className="mt-4 rounded-xl border border-violet-100 bg-card px-3 py-2"
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-foreground">
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
          <label className="block text-sm font-bold text-foreground">
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
          <label className="block text-sm font-bold text-foreground">
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
          <label className="block text-sm font-bold text-foreground">
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
    </>
  );
}

export function SettingsPharmacyPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  if (!isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <SettingsAutoSaveShell
      lang={lang}
      title={t(lang, "pharmacySettingsTitle")}
      subtitle={t(lang, "pharmacySettingsSub")}
    >
      <PharmacySettingsBody lang={lang} />
    </SettingsAutoSaveShell>
  );
}
