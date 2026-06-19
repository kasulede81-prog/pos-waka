import { useState } from "react";
import { Navigate } from "react-router-dom";
import type { CashDrawerFormulaVersion, Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { resolveCashDrawerFormulaVersion } from "../lib/dayDrawerOpen";

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
  const [saved, setSaved] = useState(false);

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  const save = () => {
    const pctN = Math.max(0, Math.min(100, Number(pct) || 0));
    const fixedN = Math.max(0, Math.floor(Number(fixed.replace(/\D/g, "")) || 0));
    setPreferences({
      cashVarianceThresholdPct: pctN,
      cashVarianceThresholdUgxFixed: fixedN,
      cashDrawerFormulaVersion: formula,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "cashManageDrawerSettings")}
        subtitle={t(lang, "cashManageDrawerSettingsSub")}
      />

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-bold text-stone-800">
          {t(lang, "cashSettingsVariancePct")}
          <input
            value={pct}
            onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
            inputMode="decimal"
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-lg font-black"
          />
        </label>
        <label className="mt-4 block text-sm font-bold text-stone-800">
          {t(lang, "cashSettingsVarianceFixed")}
          <input
            value={fixed}
            onChange={(e) => setFixed(e.target.value.replace(/\D/g, "").slice(0, 12))}
            inputMode="numeric"
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-lg font-black"
          />
        </label>
        <fieldset className="mt-4">
          <legend className="text-sm font-bold text-stone-800">{t(lang, "cashSettingsFormula")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["v1", "v2"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setFormula(v)}
                className={`rounded-xl px-4 py-2 text-sm font-black ${
                  formula === v ? "bg-stone-950 text-white" : "border border-stone-200 bg-white text-stone-800"
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={save}
          className="mt-5 min-h-[48px] w-full rounded-2xl bg-waka-600 text-sm font-black text-white"
        >
          {t(lang, "cashDrawerSettingsSaveBtn")}
        </button>
        {saved ? (
          <p className="mt-2 text-center text-sm font-bold text-emerald-700">{t(lang, "cashDrawerSettingsSaved")}</p>
        ) : null}
      </section>
    </div>
  );
}
