import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useState } from "react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { isHospitalityMode, isKitchenEnabledForHospitality } from "../lib/hospitality";
import { inferProductHospitalityRouting } from "../lib/productHospitalityRouting";
import { resolveIngredientPolicyConfig } from "../lib/hospitalityHardware";
import { computeRestaurantBillTotals } from "../lib/restaurantBilling";

export function SettingsHospitalityPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const updateProduct = usePosStore((s) => s.updateProduct);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  const kitchenOn = isKitchenEnabledForHospitality(
    preferences.businessType,
    preferences.hospitalityKitchenEnabled,
  );
  const ingPolicy = resolveIngredientPolicyConfig(preferences);
  const taxPreview = computeRestaurantBillTotals({
    lines: [
      {
        productId: "x",
        name: "Sample",
        quantity: 1,
        lineTotalUgx: 100_000,
        unitPriceUgx: 100_000,
        inputMode: "quantity",
        unitCostUgx: 0,
        estimatedProfitUgx: 0,
      },
    ],
    cartDiscountUgx: 0,
    prefs: preferences,
  });

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "hospitalitySettingsTitle")}
        subtitle={t(lang, "hospitalitySettingsSub")}
      />

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "menuBuilderTitle")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "menuBuilderSub")}</p>
        <a
          href="/settings/menu"
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
        >
          {t(lang, "menuBuilderOpen")}
        </a>
      </article>

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

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "productHospitalityRoutingTitle")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "productHospitalityRoutingSub")}</p>
        <button
          type="button"
          className="mt-4 min-h-11 rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
          onClick={() => {
            let count = 0;
            for (const p of products) {
              if (p.hospitality?.productionStation && !p.hospitality.routingAutoInferred) continue;
              updateProduct(p.id, { hospitality: inferProductHospitalityRouting(p) });
              count += 1;
            }
            setApplyMsg(tTemplate(lang, "productHospitalityApplyAllDone", { count: String(count) }));
          }}
        >
          {t(lang, "productHospitalityApplyAll")}
        </button>
        {applyMsg ? <p className="mt-3 text-sm font-semibold text-emerald-800">{applyMsg}</p> : null}
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "hospitalityServiceChargeTitle")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "hospitalityServiceChargeHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, 5, 10, 12.5].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => setPreferences({ hospitalityServiceChargePercent: pct })}
              className={`min-h-11 rounded-xl px-4 text-sm font-black ${
                (preferences.hospitalityServiceChargePercent ?? 0) === pct
                  ? "bg-waka-600 text-white"
                  : "bg-stone-100 text-stone-800"
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "hospitalityTaxTitle")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "hospitalityTaxHint")}</p>
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={preferences.hospitalityTaxEnabled !== false}
            onChange={(e) => setPreferences({ hospitalityTaxEnabled: e.target.checked })}
          />
          {t(lang, "hospitalityTaxEnabled")}
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, 5, 10, 18].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => setPreferences({ hospitalityTaxPercent: pct })}
              className={`min-h-11 rounded-xl px-4 text-sm font-black ${
                (preferences.hospitalityTaxPercent ?? 0) === pct ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-800"
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {(["exclusive", "inclusive"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPreferences({ hospitalityTaxMode: mode })}
              className={`min-h-11 flex-1 rounded-xl text-sm font-black ${
                (preferences.hospitalityTaxMode ?? "exclusive") === mode
                  ? "bg-stone-900 text-white"
                  : "bg-stone-100 text-stone-800"
              }`}
            >
              {t(lang, mode === "exclusive" ? "hospitalityTaxExclusive" : "hospitalityTaxInclusive")}
            </button>
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600">
          {t(lang, "hospitalityTaxPreview")}: UGX 100,000 → tax {taxPreview.taxUgx.toLocaleString()} → total{" "}
          {taxPreview.grandTotalUgx.toLocaleString()}
        </p>
      </article>

      <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-stone-950">{t(lang, "hospitalityIngredientPolicyTitle")}</p>
        <p className="mt-2 text-sm font-medium text-stone-600">{t(lang, "hospitalityIngredientPolicySub")}</p>
        <div className="mt-3 space-y-2">
          {(["warn", "block", "manager_override"] as const).map((policy) => (
            <label
              key={policy}
              className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-stone-100 px-3 text-sm font-bold"
            >
              <input
                type="radio"
                name="ingPolicy"
                checked={ingPolicy.policy === policy}
                onChange={() =>
                  setPreferences({
                    hospitalityIngredientStockPolicy: policy,
                    hospitalityIngredientPolicy: { ...ingPolicy, policy },
                  })
                }
              />
              {t(lang, `hospitalityIngredientPolicy_${policy}`)}
            </label>
          ))}
        </div>
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={ingPolicy.allowNegativeInventory ?? false}
            onChange={(e) =>
              setPreferences({
                hospitalityIngredientPolicy: { ...ingPolicy, allowNegativeInventory: e.target.checked },
              })
            }
          />
          {t(lang, "hospitalityIngredientAllowNegative")}
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={ingPolicy.autoReserveIngredients ?? false}
            onChange={(e) =>
              setPreferences({
                hospitalityIngredientPolicy: { ...ingPolicy, autoReserveIngredients: e.target.checked },
              })
            }
          />
          {t(lang, "hospitalityIngredientAutoReserve")}
        </label>
        <label className="mt-2 block text-sm font-bold">
          {t(lang, "hospitalityIngredientLowStock")}
          <input
            type="number"
            min={0}
            value={ingPolicy.lowStockThreshold ?? ""}
            onChange={(e) =>
              setPreferences({
                hospitalityIngredientPolicy: {
                  ...ingPolicy,
                  lowStockThreshold: e.target.value ? Number(e.target.value) : null,
                },
              })
            }
            className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 font-semibold"
          />
        </label>
      </article>
    </div>
  );
}
