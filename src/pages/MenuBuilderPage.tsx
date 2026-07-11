import { useMemo, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { isHospitalityMode } from "../lib/hospitality";
import { DEFAULT_MENU_SECTIONS } from "../lib/menuModifiers";
import { aggregateDishSales, aggregateModifierPopularity, lowMarginMenuItems } from "../lib/menuReports";
import { computeMenuItemMargin } from "../lib/recipeEngine";
import { ProductMenuConfigFields } from "../components/hospitality/ProductMenuConfigFields";
import { formatUgx } from "../lib/formatUgx";

export function MenuBuilderPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const sales = usePosStore((s) => s.sales);
  const preferences = usePosStore((s) => s.preferences);
  const updateProduct = usePosStore((s) => s.updateProduct);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }
  if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  const menuProducts = useMemo(
    () =>
      products.filter((p) => {
        if (p.menu?.hideFromMenu) return false;
        if (sectionFilter && (p.menu?.menuSection ?? p.category.toLowerCase()) !== sectionFilter) return false;
        return true;
      }),
    [products, sectionFilter],
  );

  const ingredientProducts = useMemo(
    () => products.filter((p) => (p.menu?.productKind ?? "retail") === "ingredient" || p.menu?.productKind === "semi_finished"),
    [products],
  );

  const selected = selectedId ? products.find((p) => p.id === selectedId) : null;
  const topDishes = useMemo(() => aggregateDishSales(sales).slice(0, 5), [sales]);
  const topModifiers = useMemo(() => aggregateModifierPopularity(sales).slice(0, 5), [sales]);
  const lowMargin = useMemo(() => lowMarginMenuItems(products, 35).slice(0, 5), [products]);

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader lang={lang} title={t(lang, "menuBuilderTitle")} subtitle={t(lang, "menuBuilderSub")} />

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-black text-foreground">{t(lang, "menuSectionsTitle")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSectionFilter(null)}
            className={`min-h-10 rounded-xl px-3 text-xs font-black ${sectionFilter === null ? "bg-waka-600 text-white" : "bg-muted"}`}
          >
            {t(lang, "menuAllSections")}
          </button>
          {(preferences.hospitalityMenuSections ?? DEFAULT_MENU_SECTIONS).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSectionFilter(s.id)}
              className={`min-h-10 rounded-xl px-3 text-xs font-black ${sectionFilter === s.id ? "bg-waka-600 text-white" : "bg-muted"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 text-xs font-bold text-waka-700"
          onClick={() =>
            setPreferences({
              hospitalityMenuSections: DEFAULT_MENU_SECTIONS.map((s) => ({ ...s, isActive: true })),
            })
          }
        >
          {t(lang, "menuResetSections")}
        </button>
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-sm font-black text-foreground">{t(lang, "menuProductsTitle")}</p>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {menuProducts.map((p) => {
              const margin = computeMenuItemMargin(p, products);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-bold ${
                      selectedId === p.id ? "border-waka-500 bg-waka-50" : "border-border"
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatUgx(p.sellingPricePerUnitUgx)} · {margin.marginPct.toFixed(0)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </article>

        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {selected ? (
            <ProductMenuConfigFields
              lang={lang}
              product={selected}
              ingredientProducts={ingredientProducts.length ? ingredientProducts : products}
              onSave={(menu) => {
                updateProduct(selected.id, { menu });
                setSelectedId(selected.id);
              }}
            />
          ) : (
            <p className="text-sm font-medium text-muted-foreground">{t(lang, "menuSelectProduct")}</p>
          )}
        </article>
      </div>

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm font-black text-foreground">{t(lang, "menuReportsTitle")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "menuTopDishes")}</p>
            <ul className="mt-2 space-y-1 text-sm font-bold">
              {topDishes.map((d) => (
                <li key={d.productId}>
                  {d.productName}: {d.quantitySold}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "menuTopModifiers")}</p>
            <ul className="mt-2 space-y-1 text-sm font-bold">
              {topModifiers.map((m, i) => (
                <li key={i}>
                  {m.optionLabel}: {m.count}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "menuLowMargin")}</p>
            <ul className="mt-2 space-y-1 text-sm font-bold text-rose-800">
              {lowMargin.map((m) => (
                <li key={m.product.id}>
                  {m.product.name}: {m.marginPct.toFixed(0)}%
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>
    </div>
  );
}
