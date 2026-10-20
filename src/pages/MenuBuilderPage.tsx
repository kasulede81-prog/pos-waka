import { useMemo, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Navigate, useSearchParams } from "react-router-dom";
import type { Language, MenuSectionDef } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { usePosStore } from "../store/usePosStore";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { isHospitalityMode } from "../lib/hospitality";
import {
  hospitalityMenuCostState,
  isHospitalityMenuItem,
  isHospitalityRecipeDish,
} from "../lib/hospitalityMenuCosting";
import { aggregateDishSales, aggregateModifierPopularity, lowMarginMenuItems } from "../lib/menuReports";
import { computeMenuItemMargin } from "../lib/recipeEngine";
import { ProductMenuConfigFields } from "../components/hospitality/ProductMenuConfigFields";
import { MenuSectionsManager } from "../components/hospitality/MenuSectionsManager";
import {
  filterProductsForPrintedMenu,
  legacyMenuSectionIds,
  menuSectionLabel,
  resolveMenuSections,
  sortMenuSections,
} from "../lib/menuSections";
import { formatUgx } from "../lib/formatUgx";
import { printTextListDocument } from "../lib/nativePrintFallback";
import { buildListDocumentHtml } from "../lib/listDocumentPdf";
import { buildMenuDocument } from "../lib/menuDocument";
import { sanitizePdfStem } from "../lib/pdfLayout";
import { dateKeyKampala } from "../lib/datesUg";
import { useToast } from "../context/ToastProvider";

export function MenuBuilderPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const sales = usePosStore((s) => s.sales);
  const preferences = usePosStore((s) => s.preferences);
  const updateProduct = usePosStore((s) => s.updateProduct);
  const setPreferences = usePosStore((s) => s.setPreferences);
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);
  const toast = useToast();

  const sections = useMemo(
    () => sortMenuSections(resolveMenuSections(preferences)),
    [preferences],
  );
  const legacySectionIds = useMemo(
    () => legacyMenuSectionIds(products, sections),
    [products, sections],
  );

  // All hooks run before the guard returns below (Rules of Hooks): the permission /
  // business-type guards can flip between renders when an admin switches the shop mode.
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

  const noRecipeMenuProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          !p.menu?.hideFromMenu &&
          isHospitalityRecipeDish(p) &&
          hospitalityMenuCostState(p, products).status === "not_set",
      ),
    [products],
  );
  const needsCostMenuProducts = useMemo(
    () =>
      products.filter((p) => {
        if (p.menu?.hideFromMenu || !isHospitalityRecipeDish(p)) return false;
        const state = hospitalityMenuCostState(p, products);
        return state.status === "not_set" || (state.status === "estimated" && state.incomplete);
      }),
    [products],
  );
  // The dashboard setup card links here with ?cost=1. Derive the first dish that
  // needs costing without a setState-in-effect; a row click still takes over.
  const requestedCostId =
    searchParams.get("cost") === "1" ? (needsCostMenuProducts[0]?.id ?? null) : null;
  const effectiveSelectedId = selectedId ?? requestedCostId;
  const selected = effectiveSelectedId ? products.find((p) => p.id === effectiveSelectedId) : null;
  const topDishes = useMemo(() => aggregateDishSales(sales).slice(0, 5), [sales]);
  const topModifiers = useMemo(() => aggregateModifierPopularity(sales).slice(0, 5), [sales]);
  const lowMargin = useMemo(() => lowMarginMenuItems(products, 35).slice(0, 5), [products]);

  if (!actorHasPermission(actor, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }
  if (!isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)) {
    return <Navigate to="/settings" replace />;
  }

  const saveSections = (next: MenuSectionDef[]) => {
    setPreferences({ hospitalityMenuSections: next });
    toast.success(t(lang, "menuSectionsSaved"));
  };

  /**
   * Printable menu of the merchants' dishes as currently displayed. Read-only
   * presentation: it creates no menu or inventory transaction. Deactivated
   * sections are omitted when printing all; an explicit filter still prints
   * that section so the owner can review it before reactivating.
   */
  const printMenu = () => {
    const printableProducts = filterProductsForPrintedMenu(menuProducts, sections, sectionFilter);
    const doc = buildMenuDocument({
      lang,
      preferences,
      sections,
      menuProducts: printableProducts,
      activeSectionLabel: sectionFilter
        ? menuSectionLabel(sections, sectionFilter, sectionFilter)
        : t(lang, "menuAllSections"),
      topDishes,
      topModifiers,
      lowMargin,
    });
    void printTextListDocument({
      pdfFilename: `${sanitizePdfStem(`waka-menu-${dateKeyKampala(new Date())}`)}.pdf`,
      title: doc.title,
      subtitle: doc.subtitle,
      lines: doc.lines,
      htmlBody: buildListDocumentHtml(doc),
      paper: "a4",
    }).then((ok) => {
      if (!ok) toast.error(t(lang, "receiptPrintBlocked"));
    });
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader lang={lang} title={t(lang, "menuBuilderTitle")} subtitle={t(lang, "menuBuilderSub")} />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={printMenu}
          className="min-h-[44px] rounded-2xl border-2 px-4 text-sm font-black touch-manipulation"
        >
          {t(lang, "receiptPrint")}
        </button>
      </div>

      {noRecipeMenuProducts.length > 0 ? (
        <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-800/40 dark:bg-amber-950/20">
          <p className="text-sm font-black text-amber-950 dark:text-amber-100">
            {t(lang, "menuCostBannerTitle")}
          </p>
          <p className="mt-1 text-xs font-semibold text-amber-900 dark:text-amber-200">
            {tTemplate(lang, "menuCostBannerBody", {
              count: String(noRecipeMenuProducts.length),
            })}
          </p>
          <button
            type="button"
            onClick={() => setSelectedId(noRecipeMenuProducts[0]!.id)}
            className="mt-3 min-h-10 rounded-xl bg-amber-700 px-3 text-xs font-black text-white"
          >
            {t(lang, "menuCostBannerAction")}
          </button>
        </article>
      ) : null}

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
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSectionFilter(s.id)}
              className={`min-h-10 rounded-xl px-3 text-xs font-black ${
                sectionFilter === s.id ? "bg-waka-600 text-white" : "bg-muted"
              } ${s.isActive === false ? "opacity-70" : ""}`}
            >
              {s.label}
              {s.isActive === false ? ` · ${t(lang, "menuSectionInactive")}` : ""}
            </button>
          ))}
          {legacySectionIds.map((id) => (
            <button
              key={`legacy-${id}`}
              type="button"
              onClick={() => setSectionFilter(id)}
              className={`min-h-10 rounded-xl px-3 text-xs font-black ${
                sectionFilter === id ? "bg-waka-600 text-white" : "bg-muted"
              } opacity-70`}
            >
              {id} · {t(lang, "menuSectionLegacy")}
            </button>
          ))}
        </div>
      </article>

      <MenuSectionsManager lang={lang} sections={sections} onSave={saveSections} />

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-sm font-black text-foreground">{t(lang, "menuProductsTitle")}</p>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {menuProducts.map((p) => {
              const costState = isHospitalityMenuItem(p)
                ? hospitalityMenuCostState(p, products)
                : null;
              const fallbackMarginPct = costState
                ? null
                : computeMenuItemMargin(p, products).marginPct;
              const costLabel =
                costState?.status === "not_set"
                  ? t(lang, "menuCostRecipeNotSet")
                  : costState?.status === "estimated" && costState.incomplete
                    ? t(lang, "menuCostIncomplete")
                    : costState?.status === "estimated"
                      ? `${t(lang, "menuCostEstimatedShort")} ${costState.marginPct.toFixed(0)}%`
                      : costState?.status === "verified_product_cost"
                        ? `${t(lang, "menuCostVerifiedCostShort")} ${costState.marginPct.toFixed(0)}%`
                        : costState?.status === "unverified_product_cost"
                          ? t(lang, "menuCostCostNotConfirmed")
                          : `${fallbackMarginPct!.toFixed(0)}%`;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-bold ${
                      effectiveSelectedId === p.id ? "border-waka-500 bg-waka-50" : "border-border"
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatUgx(p.sellingPricePerUnitUgx)} · {costLabel}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </article>

        <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {selected ? (
            <>
              {ingredientProducts.length === 0 ? (
                <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
                  {t(lang, "menuBuilderNoIngredients")}
                </p>
              ) : null}
              <ProductMenuConfigFields
                key={selected.id}
                lang={lang}
                product={selected}
                ingredientProducts={ingredientProducts}
                comboProducts={products.filter((p) => !p.menu?.hideFromMenu)}
                sections={sections}
                onSave={(menu) => {
                  const result = updateProduct(selected.id, { menu });
                  if (!result.ok) {
                    toast.error(t(lang, result.errorKey ?? "invalid"));
                    return;
                  }
                  setSelectedId(selected.id);
                }}
              />
            </>
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
