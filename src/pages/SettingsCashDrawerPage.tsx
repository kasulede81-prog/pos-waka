import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { CashDrawerFormulaVersion, Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { authorizePreferencesPatch } from "../lib/settingsAuthorization";
import { getStoreSubscriptionContext } from "../lib/storeSubscriptionContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { resolveCashDrawerFormulaVersion } from "../lib/dayDrawerOpen";
import { actorHasPermission } from "../lib/actorAuthorization";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterpriseSaveIndicator } from "../components/enterprise/EnterpriseSaveIndicator";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { useUnsavedChangesGuard } from "../components/enterprise/useUnsavedChangesGuard";

type Props = { lang: Language };

export function SettingsCashDrawerPage({ lang }: Props) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPreferences = usePosStore((s) => s.setPreferences);

  const [pct, setPct] = useState(String(preferences.cashVarianceThresholdPct ?? 5));
  const [fixed, setFixed] = useState(String(preferences.cashVarianceThresholdUgxFixed ?? 10_000));
  const [formula, setFormula] = useState<CashDrawerFormulaVersion>(
    resolveCashDrawerFormulaVersion(preferences),
  );
  const [ownerCorrection, setOwnerCorrection] = useState(
    preferences.ownerDayOpenCorrectionAfterSales === true,
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const dirty = useMemo(() => {
    const pctN = Math.max(0, Math.min(100, Number(pct) || 0));
    const fixedN = Math.max(0, Math.floor(Number(fixed.replace(/\D/g, "")) || 0));
    return (
      pctN !== (preferences.cashVarianceThresholdPct ?? 5) ||
      fixedN !== (preferences.cashVarianceThresholdUgxFixed ?? 10_000) ||
      formula !== resolveCashDrawerFormulaVersion(preferences) ||
      ownerCorrection !== (preferences.ownerDayOpenCorrectionAfterSales === true)
    );
  }, [pct, fixed, formula, ownerCorrection, preferences]);

  useUnsavedChangesGuard(lang, dirty);

  if (!actorHasPermission(actor, "day.open_drawer")) {
    return <Navigate to="/settings" replace />;
  }

  const save = () => {
    const pctN = Math.max(0, Math.min(100, Number(pct) || 0));
    const fixedN = Math.max(0, Math.floor(Number(fixed.replace(/\D/g, "")) || 0));
    const patch = {
      cashVarianceThresholdPct: pctN,
      cashVarianceThresholdUgxFixed: fixedN,
      cashDrawerFormulaVersion: formula,
      ownerDayOpenCorrectionAfterSales: ownerCorrection,
    };
    const { snapshot, authMode } = getStoreSubscriptionContext();
    const denied = authorizePreferencesPatch(actor, patch, {
      snapshot,
      authMode,
      currentStaffAccounts: preferences.staffAccounts ?? [],
    });
    if (!denied.ok) {
      setErrorKey(denied.errorKey ?? "forbidden");
      setSaved(false);
      return;
    }
    setSaving(true);
    setPreferences(patch);
    setErrorKey(null);
    setSaved(true);
    setSaving(false);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const saveStatus = saving ? "saving" : saved ? "saved" : dirty ? "dirty" : "idle";

  return (
    <EnterprisePageContainer className="space-y-5">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "cashManageDrawerSettings")}
        subtitle={t(lang, "cashManageDrawerSettingsSub")}
      />
      <div className="flex justify-end">
        <EnterpriseSaveIndicator lang={lang} mode="explicit" status={saveStatus} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label className="block text-sm font-bold text-foreground">
          {t(lang, "cashSettingsVariancePct")}
          <input
            value={pct}
            onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
            inputMode="decimal"
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-border px-4 text-lg font-black"
          />
        </label>
        <label className="mt-4 block text-sm font-bold text-foreground">
          {t(lang, "cashSettingsVarianceFixed")}
          <input
            value={fixed}
            onChange={(e) => setFixed(e.target.value.replace(/\D/g, "").slice(0, 12))}
            inputMode="numeric"
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-border px-4 text-lg font-black"
          />
        </label>
        <fieldset className="mt-4">
          <legend className="text-sm font-bold text-foreground">{t(lang, "cashSettingsFormula")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["v1", "v2"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFormula(v)}
                className={`rounded-xl px-4 py-2 text-sm font-black ${
                  formula === v ? "bg-foreground text-background" : "border border-border bg-card text-foreground"
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 rounded-2xl border border-border bg-muted px-4 py-3">
          <WakaSwitch
            checked={ownerCorrection}
            onCheckedChange={setOwnerCorrection}
            label={t(lang, "cashSettingsOwnerDayOpenCorrection")}
            description={t(lang, "cashSettingsOwnerDayOpenCorrectionHint")}
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t(lang, "cashDrawerSettingsSaveBtn")}
        </button>
        {errorKey ? (
          <p className="mt-2 text-center text-sm font-bold text-rose-700">
            {(t as (l: Language, k: string) => string)(lang, errorKey)}
          </p>
        ) : null}
      </section>
    </EnterprisePageContainer>
  );
}
