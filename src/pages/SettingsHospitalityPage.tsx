import { Navigate } from "react-router-dom";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useState } from "react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsAutoSaveShell } from "../components/enterprise/SettingsAutoSaveShell";
import { usePreferencesPatch } from "../components/enterprise/preferencesAutoSaveContext";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { isHospitalityMode, isKitchenEnabledForHospitality } from "../lib/hospitality";
import { inferProductHospitalityRouting } from "../lib/productHospitalityRouting";
import { resolveIngredientPolicyConfig } from "../lib/hospitalityHardware";
import { computeRestaurantBillTotals } from "../lib/restaurantBilling";

function HospitalitySettingsBody({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const savePreferences = usePreferencesPatch();
  const updateProduct = usePosStore((s) => s.updateProduct);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

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
    <>
      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "menuBuilderTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "menuBuilderSub")}</p>
        <a
          href="/settings/menu"
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-waka-600 px-4 text-sm font-black text-white"
        >
          {t(lang, "menuBuilderOpen")}
        </a>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "hospitalitySettingsKitchenTitle")}</p>
        {preferences.businessType === "bar" ? (
          <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "hospitalitySettingsKitchenDefaultBar")}</p>
        ) : null}
        <div className="mt-4 space-y-3">
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-base font-bold text-foreground">
            <input
              type="radio"
              name="hospitalityKitchen"
              checked={kitchenOn}
              onChange={() => savePreferences({ hospitalityKitchenEnabled: true })}
              className="h-5 w-5 accent-waka-600"
            />
            {t(lang, "hospitalitySettingsKitchenOn")}
          </label>
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-base font-bold text-foreground">
            <input
              type="radio"
              name="hospitalityKitchen"
              checked={!kitchenOn}
              onChange={() => savePreferences({ hospitalityKitchenEnabled: false })}
              className="h-5 w-5 accent-waka-600"
            />
            {t(lang, "hospitalitySettingsKitchenOff")}
          </label>
        </div>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "productHospitalityRoutingTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "productHospitalityRoutingSub")}</p>
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

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "hospitalityServiceChargeTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "hospitalityServiceChargeHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, 5, 10, 12.5].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => savePreferences({ hospitalityServiceChargePercent: pct })}
              className={`min-h-11 rounded-xl px-4 text-sm font-black ${
                (preferences.hospitalityServiceChargePercent ?? 0) === pct
                  ? "bg-waka-600 text-white"
                  : "bg-muted text-foreground"
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "hospitalityTaxTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "hospitalityTaxHint")}</p>
        <WakaSwitch
          checked={preferences.hospitalityTaxEnabled !== false}
          onCheckedChange={(checked) => savePreferences({ hospitalityTaxEnabled: checked })}
          label={t(lang, "hospitalityTaxEnabled")}
          className="mt-3"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, 5, 10, 18].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => savePreferences({ hospitalityTaxPercent: pct })}
              className={`min-h-11 rounded-xl px-4 text-sm font-black ${
                (preferences.hospitalityTaxPercent ?? 0) === pct ? "bg-waka-600 text-white" : "bg-muted text-foreground"
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
              onClick={() => savePreferences({ hospitalityTaxMode: mode })}
              className={`min-h-11 flex-1 rounded-xl text-sm font-black ${
                (preferences.hospitalityTaxMode ?? "exclusive") === mode
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground"
              }`}
            >
              {t(lang, mode === "exclusive" ? "hospitalityTaxExclusive" : "hospitalityTaxInclusive")}
            </button>
          ))}
        </div>
        <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
          {t(lang, "hospitalityTaxPreview")}: UGX 100,000 → tax {taxPreview.taxUgx.toLocaleString()} → total{" "}
          {taxPreview.grandTotalUgx.toLocaleString()}
        </p>
      </article>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-base font-black text-foreground">{t(lang, "hospitalityIngredientPolicyTitle")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "hospitalityIngredientPolicySub")}</p>
        <div className="mt-3 space-y-2">
          {(["warn", "block", "manager_override"] as const).map((policy) => (
            <label
              key={policy}
              className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-border px-3 text-sm font-bold"
            >
              <input
                type="radio"
                name="ingPolicy"
                checked={ingPolicy.policy === policy}
                onChange={() =>
                  savePreferences({
                    hospitalityIngredientStockPolicy: policy,
                    hospitalityIngredientPolicy: { ...ingPolicy, policy },
                  })
                }
              />
              {t(lang, `hospitalityIngredientPolicy_${policy}`)}
            </label>
          ))}
        </div>
        <WakaSwitch
          checked={ingPolicy.allowNegativeInventory ?? false}
          onCheckedChange={(checked) =>
            savePreferences({
              hospitalityIngredientPolicy: { ...ingPolicy, allowNegativeInventory: checked },
            })
          }
          label={t(lang, "hospitalityIngredientAllowNegative")}
          className="mt-3"
        />
        <WakaSwitch
          checked={ingPolicy.autoReserveIngredients ?? false}
          onCheckedChange={(checked) =>
            savePreferences({
              hospitalityIngredientPolicy: { ...ingPolicy, autoReserveIngredients: checked },
            })
          }
          label={t(lang, "hospitalityIngredientAutoReserve")}
        />
        <label className="mt-2 block text-sm font-bold">
          {t(lang, "hospitalityIngredientLowStock")}
          <input
            type="number"
            min={0}
            value={ingPolicy.lowStockThreshold ?? ""}
            onChange={(e) =>
              savePreferences({
                hospitalityIngredientPolicy: {
                  ...ingPolicy,
                  lowStockThreshold: e.target.value ? Number(e.target.value) : null,
                },
              })
            }
            className="mt-1 min-h-[44px] w-full rounded-xl border border-border px-3 font-semibold"
          />
        </label>
      </article>
    </>
  );
}

export function SettingsHospitalityPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <SettingsAutoSaveShell
      lang={lang}
      title={t(lang, "hospitalitySettingsTitle")}
      subtitle={t(lang, "hospitalitySettingsSub")}
    >
      <HospitalitySettingsBody lang={lang} />
    </SettingsAutoSaveShell>
  );
}
