import { useState } from "react";
import type {
  Language,
  ModifierGroup,
  ModifierOption,
  PrepBatch,
  PrepBatchAdditionalCost,
  Product,
  ProductMenuConfig,
  ProductVariant,
  RecipeLine,
  ComboSlot,
} from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  hospitalityMenuCostState,
  isHospitalityMenuItem,
  isHospitalityRecipeDish,
} from "../../lib/hospitalityMenuCosting";
import { DEFAULT_MENU_SECTIONS } from "../../lib/menuModifiers";
import {
  computeMenuItemFoodCostUgx,
  computePrepBatchProjection,
  missingRecipeIngredientIds,
  prepRequirementsForPortions,
  preparedPortionsAvailable,
  requirementsFoodCostUgx,
} from "../../lib/recipeEngine";
import { formatUgx } from "../../lib/formatUgx";
import { usePosStore } from "../../store/usePosStore";
import { WakaSwitch } from "../enterprise/WakaSwitch";

type Props = {
  lang: Language;
  product: Product;
  ingredientProducts: Product[];
  onSave: (menu: ProductMenuConfig) => void;
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

const WASTE_REASONS = ["spoiled", "burnt", "damaged", "unsold", "other"] as const;

type PrepCostDraft = {
  id: string;
  label: string;
  amount: string;
};

const prepCostAmount = (value: string): number =>
  Math.max(0, Math.floor(Number(value.replace(/[^\d]/g, "")) || 0));

const positiveIntOrNull = (value: string): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export function ProductMenuConfigFields({ lang, product, ingredientProducts, onSave }: Props) {
  const [menu, setMenu] = useState<ProductMenuConfig>(
    product.menu ?? { productKind: "finished_menu", modifierGroups: [], variants: [], recipe: { lines: [] } },
  );
  // Phase 5 — preparation workflow state (batch truth always read from the store product).
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepExpectedQty, setPrepExpectedQty] = useState("");
  const [prepActualQty, setPrepActualQty] = useState("");
  const [prepActualIngredientCost, setPrepActualIngredientCost] = useState("");
  const [prepExtraCosts, setPrepExtraCosts] = useState<PrepCostDraft[]>([]);
  const [wasteFor, setWasteFor] = useState<string | null>(null);
  const [wasteQty, setWasteQty] = useState("");
  const [wasteReason, setWasteReason] = useState<(typeof WASTE_REASONS)[number]>("spoiled");
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const allProducts = usePosStore((s) => s.products);
  const storeProduct = usePosStore((s) => s.products.find((p) => p.id === product.id)) ?? product;
  const storePrepMode = storeProduct.menu?.prepMode ?? "made_to_order";
  const storeBatches = storeProduct.menu?.prepBatches ?? [];
  const availablePrepared = preparedPortionsAvailable(storeProduct);
  const prepareMenuBatch = usePosStore((s) => s.prepareMenuBatch);
  const wastePreparedPortions = usePosStore((s) => s.wastePreparedPortions);
  const cancelPrepBatch = usePosStore((s) => s.cancelPrepBatch);

  const runAction = (fn: () => { ok: boolean; errorKey?: string }) => {
    const result = fn();
    setActionError(result.ok ? null : t(lang, result.errorKey ?? "invalid"));
    return result.ok;
  };

  const defaultExtraCosts = (): PrepCostDraft[] => [
    { id: "charcoal", label: t(lang, "menuPrepCostCharcoal"), amount: "" },
    { id: "labour", label: t(lang, "menuPrepCostLabour"), amount: "" },
    { id: "packaging", label: t(lang, "menuPrepCostPackaging"), amount: "" },
  ];

  const resetPrepDraft = () => {
    setPrepExpectedQty("");
    setPrepActualQty("");
    setPrepActualIngredientCost("");
    setPrepExtraCosts([]);
  };

  const openPrep = () => {
    setActionError(null);
    setPrepExpectedQty(String(storeProduct.menu?.recipe?.yieldQty ?? 1));
    setPrepActualQty("");
    setPrepActualIngredientCost("");
    setPrepExtraCosts(defaultExtraCosts());
    setPrepOpen(true);
  };

  const updatePrepExtraCost = (id: string, patch: Partial<PrepCostDraft>) => {
    setPrepExtraCosts((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const confirmWaste = (batchId: string) => {
    const portions = Math.floor(Number(wasteQty) || 0);
    if (runAction(() => wastePreparedPortions({ batchId, portions, reason: wasteReason }))) {
      setWasteFor(null);
      setWasteQty("");
    }
  };

  const confirmCancel = (batchId: string) => {
    if (runAction(() => cancelPrepBatch({ batchId }))) {
      setCancelFor(null);
    }
  };

  // The expected yield is the ingredient basis. Actual plates, when known, only
  // change the stock count and the denominator for cost per plate.
  const prepExpectedQtyValue =
    positiveIntOrNull(prepExpectedQty) ??
    Math.max(1, Math.floor(storeProduct.menu?.recipe?.yieldQty ?? 1));
  const prepActualQtyValue = positiveIntOrNull(prepActualQty);
  const prepPreparedQty = prepActualQtyValue ?? prepExpectedQtyValue;
  const prepPreview = prepRequirementsForPortions({ ...product, menu }, prepExpectedQtyValue);
  const prepPreviewRows = [...prepPreview.entries()].map(([ingredientId, required]) => {
    const ing = allProducts.find((p) => p.id === ingredientId);
    const available = ing?.stockOnHand ?? 0;
    return { ingredientId, name: ing?.name ?? ingredientId, unit: ing?.baseUnit ?? "ea", required, available };
  });
  const missingPrepIngredientIds = missingRecipeIngredientIds({ ...product, menu }, allProducts);
  const prepHasShortage = prepPreviewRows.some((r) => r.required > r.available + 0.0001);
  const prepIngredientEstimateUgx = requirementsFoodCostUgx(prepPreview, allProducts);
  const prepActualIngredientCostValue = prepActualIngredientCost.trim()
    ? prepCostAmount(prepActualIngredientCost)
    : null;
  const prepIngredientCostUgx = prepActualIngredientCostValue ?? prepIngredientEstimateUgx;
  const prepAdditionalCostValues: PrepBatchAdditionalCost[] = prepExtraCosts
    .map((cost) => ({
      id: cost.id,
      label: cost.label.trim() || t(lang, "menuPrepAdditionalCosts"),
      amountUgx: prepCostAmount(cost.amount),
    }))
    .filter((cost) => cost.amountUgx > 0);
  const prepAdditionalCostUgx = prepAdditionalCostValues.reduce((sum, cost) => sum + cost.amountUgx, 0);
  const prepTotalCostUgx = prepIngredientCostUgx + prepAdditionalCostUgx;
  const prepSaleCogsPerPlateUgx = Math.max(
    0,
    Math.round(computeMenuItemFoodCostUgx({ ...product, menu }, allProducts)),
  );
  const prepBatchCostPerPlateUgx = Math.max(0, Math.round(prepTotalCostUgx / prepPreparedQty));
  const prepSellingPriceUgx = Math.max(0, Math.floor(product.sellingPricePerUnitUgx));
  const prepProjectedRevenueUgx = prepSellingPriceUgx * prepPreparedQty;
  const prepProjectedProfitUgx = prepProjectedRevenueUgx - prepTotalCostUgx;
  const prepProjectionTitle = tTemplate(lang, "menuPrepProjectionTitle", { count: prepPreparedQty });

  const confirmPrepare = () => {
    if (missingPrepIngredientIds.length > 0) {
      setActionError(t(lang, "menuPrepMissingIngredient"));
      return;
    }
    if (prepPreviewRows.length === 0) {
      setActionError(t(lang, "prepRequiresRecipe"));
      return;
    }
    // The action validates against the SAVED product — persist prepMode first if needed.
    if (storePrepMode !== "batch_prepared") {
      onSave({ ...menu, prepMode: "batch_prepared", prepBatches: storeBatches });
    }
    if (
      runAction(() =>
        prepareMenuBatch({
          productId: product.id,
          portions: prepPreparedQty,
          expectedPortions: prepExpectedQtyValue,
          actualPortions: prepActualQtyValue ?? undefined,
          actualIngredientCostUgx: prepActualIngredientCostValue,
          additionalCosts: prepAdditionalCostValues,
        }),
      )
    ) {
      setPrepOpen(false);
      resetPrepDraft();
    }
  };

  const addModifierGroup = () => {
    const g: ModifierGroup = {
      id: newId("mg"),
      label: "Options",
      required: false,
      selectionMode: "single",
      options: [{ id: newId("mo"), label: "Option", priceDeltaUgx: 0 }],
    };
    setMenu({ ...menu, modifierGroups: [...(menu.modifierGroups ?? []), g] });
  };

  const addRecipeLine = (ingredientProductId = ingredientProducts[0]?.id ?? "") => {
    const ingredient = ingredientProducts.find((p) => p.id === ingredientProductId);
    const line: RecipeLine = {
      ingredientProductId,
      quantityBase: 1,
      unitLabel: ingredient?.baseUnit ?? "ea",
    };
    setMenu({
      ...menu,
      recipe: { ...menu.recipe, yieldQty: menu.recipe?.yieldQty, prepNotes: menu.recipe?.prepNotes, lines: [...(menu.recipe?.lines ?? []), line] },
    });
  };

  const updateRecipeLine = (li: number, next: RecipeLine) => {
    const lines = [...(menu.recipe?.lines ?? [])];
    lines[li] = next;
    setMenu({ ...menu, recipe: { ...menu.recipe, lines } });
  };

  const removeRecipeLine = (li: number) => {
    const lines = (menu.recipe?.lines ?? []).filter((_, index) => index !== li);
    setMenu({ ...menu, recipe: { ...menu.recipe, lines } });
  };

  // Live food-cost panel: run the exact same engine the sale finalize path uses,
  // against the in-progress (not yet saved) menu config. A no-recipe product is
  // "not set", never the quick-add 72% cost presented as a margin.
  const syntheticProduct: Product = { ...product, menu };
  const liveCostState = hospitalityMenuCostState(syntheticProduct, allProducts);
  const liveMenuItem = isHospitalityMenuItem(syntheticProduct);
  const liveRecipeDish = isHospitalityRecipeDish(syntheticProduct);
  const liveMissingNames =
    liveCostState.status === "estimated"
      ? liveCostState.missingIngredientIds.map((id) =>
          id
            ? (allProducts.find((p) => p.id === id)?.name ?? id)
            : t(lang, "menuCostSelectIngredient"),
        )
      : [];
  const liveZeroCostNames =
    liveCostState.status === "estimated"
      ? liveCostState.zeroCostIngredientIds.map(
          (id) => allProducts.find((p) => p.id === id)?.name ?? id,
        )
      : [];

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-sm font-bold text-muted-foreground">{t(lang, "menuProductKind")}</span>
        <select
          value={menu.productKind ?? "finished_menu"}
          onChange={(e) => setMenu({ ...menu, productKind: e.target.value as ProductMenuConfig["productKind"] })}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-border px-3 text-sm font-bold"
        >
          <option value="finished_menu">{t(lang, "menuKindFinished")}</option>
          <option value="ingredient">{t(lang, "menuKindIngredient")}</option>
          <option value="semi_finished">{t(lang, "menuKindSemiFinished")}</option>
          <option value="retail">{t(lang, "menuKindRetail")}</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-bold text-muted-foreground">{t(lang, "menuSection")}</span>
        <select
          value={menu.menuSection ?? ""}
          onChange={(e) => setMenu({ ...menu, menuSection: e.target.value || null })}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-border px-3 text-sm font-bold"
        >
          <option value="">{product.category}</option>
          {DEFAULT_MENU_SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {liveRecipeDish && (menu.recipe?.lines ?? []).length === 0 ? (
        <section className="rounded-2xl border border-waka-200 bg-waka-50 p-3">
          <p className="text-sm font-black text-foreground">{t(lang, "menuCostGuidedTitle")}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {t(lang, "menuCostGuidedBody")}
          </p>
          <details className="mt-2 rounded-xl bg-card p-2">
            <summary className="cursor-pointer text-xs font-black text-waka-700">
              {t(lang, "menuCostGuidedExamplesTitle")}
            </summary>
            <ul className="mt-1 space-y-1 text-xs font-medium text-muted-foreground">
              <li>{t(lang, "menuCostExampleRice")}</li>
              <li>{t(lang, "menuCostExampleChicken")}</li>
              <li>{t(lang, "menuCostExampleChips")}</li>
            </ul>
          </details>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">
            {t(lang, "menuCostGuidedNoIngredients")}
          </p>
          <button
            type="button"
            onClick={() => addRecipeLine("")}
            className="mt-2 min-h-[44px] w-full rounded-xl bg-waka-600 text-sm font-black text-white"
          >
            {t(lang, "menuCostGuidedAddIngredient")}
          </button>
        </section>
      ) : null}

      {liveMenuItem && !liveRecipeDish ? (
        <section className="rounded-2xl border border-border bg-card p-3">
          {liveCostState.status === "verified_product_cost" ? (
            <>
              <p className="text-sm font-black text-foreground">{t(lang, "menuCostProductCostTitle")}</p>
              <p className="mt-1 text-xs font-bold text-emerald-800">
                {liveCostState.costSource === "purchase"
                  ? t(lang, "menuCostVerifiedPurchase")
                  : t(lang, "menuCostVerifiedManual")}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t(lang, "menuCostProductCostLabel")}</dt>
                <dd className="text-right font-black">{formatUgx(liveCostState.foodCostUgx)}</dd>
                <dt className="text-muted-foreground">{t(lang, "menuCostSellPrice")}</dt>
                <dd className="text-right font-black">{formatUgx(liveCostState.sellPriceUgx)}</dd>
                <dt className="text-muted-foreground">{t(lang, "menuCostProductProfitLabel")}</dt>
                <dd className="text-right font-black">{formatUgx(liveCostState.profitUgx)}</dd>
                <dt className="text-muted-foreground">{t(lang, "menuCostMargin")}</dt>
                <dd className="text-right font-black">{liveCostState.marginPct.toFixed(1)}%</dd>
              </dl>
              <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                {t(lang, "menuCostProductCostNote")}
              </p>
            </>
          ) : liveCostState.status === "unverified_product_cost" ? (
            <>
              <p className="text-sm font-black text-foreground">
                {t(lang, "menuCostProductCostNotConfirmedTitle")}
              </p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                {liveCostState.reason === "quick_add_default"
                  ? t(lang, "menuCostProductCostGeneratedBody")
                  : liveCostState.reason === "not_set"
                    ? t(lang, "menuCostProductCostNotSetBody")
                    : t(lang, "menuCostProductCostUnknownBody")}
              </p>
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                {t(lang, "menuCostProductCostNote")}
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-foreground">{t(lang, "menuModifiersTitle")}</p>
          <button type="button" onClick={addModifierGroup} className="text-xs font-black text-waka-700">
            + {t(lang, "menuAddGroup")}
          </button>
        </div>
        {(menu.modifierGroups ?? []).map((group, gi) => (
          <div key={group.id} className="mb-3 rounded-xl bg-muted p-3">
            <input
              value={group.label}
              onChange={(e) => {
                const groups = [...(menu.modifierGroups ?? [])];
                groups[gi] = { ...group, label: e.target.value };
                setMenu({ ...menu, modifierGroups: groups });
              }}
              className="mb-2 min-h-[40px] w-full rounded-lg border border-border px-2 text-sm font-bold"
            />
            <WakaSwitch
              checked={group.required}
              onCheckedChange={(checked) => {
                const groups = [...(menu.modifierGroups ?? [])];
                groups[gi] = { ...group, required: checked };
                setMenu({ ...menu, modifierGroups: groups });
              }}
              label={t(lang, "menuRequired")}
              className="mr-3 text-xs font-bold"
            />
            {group.options.map((opt, oi) => (
              <div key={opt.id} className="mt-2 grid grid-cols-[1fr_100px] gap-2">
                <input
                  value={opt.label}
                  onChange={(e) => {
                    const groups = [...(menu.modifierGroups ?? [])];
                    const options = [...group.options];
                    options[oi] = { ...opt, label: e.target.value };
                    groups[gi] = { ...group, options };
                    setMenu({ ...menu, modifierGroups: groups });
                  }}
                  className="min-h-[40px] rounded-lg border border-border px-2 text-sm"
                />
                <input
                  value={opt.priceDeltaUgx ? String(opt.priceDeltaUgx) : ""}
                  onChange={(e) => {
                    const groups = [...(menu.modifierGroups ?? [])];
                    const options = [...group.options];
                    options[oi] = {
                      ...opt,
                      priceDeltaUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)),
                    };
                    groups[gi] = { ...group, options };
                    setMenu({ ...menu, modifierGroups: groups });
                  }}
                  placeholder="UGX"
                  className="min-h-[40px] rounded-lg border border-border px-2 text-sm font-black"
                />
              </div>
            ))}
            <button
              type="button"
              className="mt-2 text-xs font-bold text-waka-700"
              onClick={() => {
                const groups = [...(menu.modifierGroups ?? [])];
                const opt: ModifierOption = { id: newId("mo"), label: "Option", priceDeltaUgx: 0 };
                groups[gi] = { ...group, options: [...group.options, opt] };
                setMenu({ ...menu, modifierGroups: groups });
              }}
            >
              + {t(lang, "menuAddOption")}
            </button>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-foreground">{t(lang, "menuRecipeTitle")}</p>
          <button type="button" onClick={() => addRecipeLine()} className="text-xs font-black text-waka-700">
            + {t(lang, "menuAddIngredient")}
          </button>
        </div>

        {(menu.recipe?.lines ?? []).length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground">{t(lang, "menuRecipeYield")}</span>
              <input
                value={menu.recipe?.yieldQty ? String(menu.recipe.yieldQty) : ""}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/[^\d.]/g, "")) || 0;
                  setMenu({ ...menu, recipe: { ...menu.recipe, lines: menu.recipe?.lines ?? [], yieldQty: v > 0 ? v : undefined } });
                }}
                placeholder="1"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-border px-2 text-sm font-black"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground">{t(lang, "menuRecipePrepNotes")}</span>
              <input
                value={menu.recipe?.prepNotes ?? ""}
                onChange={(e) => setMenu({ ...menu, recipe: { ...menu.recipe, lines: menu.recipe?.lines ?? [], prepNotes: e.target.value || null } })}
                className="mt-1 min-h-[40px] w-full rounded-lg border border-border px-2 text-sm"
              />
            </label>
          </div>
        )}

        {(menu.recipe?.lines ?? []).map((line, li) => (
          <div key={li} className="mb-2 rounded-xl bg-muted p-2">
            <div className="grid grid-cols-[1fr_80px_44px] gap-2">
              <select
                value={line.ingredientProductId}
                onChange={(e) => {
                  const ing = ingredientProducts.find((p) => p.id === e.target.value);
                  updateRecipeLine(li, {
                    ...line,
                    ingredientProductId: e.target.value,
                    unitLabel: ing?.baseUnit ?? line.unitLabel,
                  });
                }}
                className="min-h-[40px] rounded-lg border border-border px-2 text-sm"
              >
                <option value="">{t(lang, "menuCostSelectIngredient")}</option>
                {ingredientProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                value={String(line.quantityBase)}
                onChange={(e) =>
                  updateRecipeLine(li, { ...line, quantityBase: Math.max(0, Number(e.target.value) || 0) })
                }
                aria-label={t(lang, "menuCostQuantity")}
                placeholder={t(lang, "menuCostQuantity")}
                className="min-h-[40px] rounded-lg border border-border px-2 text-sm font-black"
              />
              <span className="flex items-center text-xs font-bold text-muted-foreground">{line.unitLabel ?? "ea"}</span>
            </div>
            <div className="mt-2 grid grid-cols-[90px_1fr] gap-2">
              <label className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-muted-foreground">{t(lang, "menuWastePercent")}</span>
                <input
                  value={line.wastePercent ? String(line.wastePercent) : ""}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0));
                    updateRecipeLine(li, { ...line, wastePercent: v > 0 ? v : null });
                  }}
                  placeholder="0"
                  className="min-h-[36px] w-full rounded-lg border border-border px-2 text-sm font-black"
                />
              </label>
              <input
                value={line.prepNotes ?? ""}
                onChange={(e) => updateRecipeLine(li, { ...line, prepNotes: e.target.value || null })}
                placeholder={t(lang, "menuLineNotes")}
                className="min-h-[36px] rounded-lg border border-border px-2 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRecipeLine(li)}
              className="mt-1 text-[11px] font-black text-red-700"
            >
              {t(lang, "menuCostRemoveIngredient")}
            </button>
          </div>
        ))}

        {(menu.recipe?.lines ?? []).length > 0 && (
          <div className="mt-3 rounded-xl border border-waka-200 bg-waka-50 p-3">
            <p className="mb-2 text-xs font-black uppercase text-waka-700">{t(lang, "menuCostPanelTitle")}</p>
            <p className="mb-2 text-xs font-bold text-waka-800">{t(lang, "menuCostEstimated")}</p>
            {liveCostState.status === "estimated" && !liveCostState.incomplete ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t(lang, "menuCostFoodCost")}</dt>
                <dd className="text-right font-black">{formatUgx(liveCostState.foodCostUgx)}</dd>
                <dt className="text-muted-foreground">{t(lang, "menuCostSellPrice")}</dt>
                <dd className="text-right font-black">{formatUgx(liveCostState.sellPriceUgx)}</dd>
                <dt className="text-muted-foreground">{t(lang, "menuCostProfit")}</dt>
                <dd className="text-right font-black">{formatUgx(liveCostState.profitUgx)}</dd>
                <dt className="text-muted-foreground">{t(lang, "menuCostMargin")}</dt>
                <dd className="text-right font-black">{liveCostState.marginPct.toFixed(1)}%</dd>
              </dl>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <p className="font-black">{t(lang, "menuCostIncomplete")}</p>
                <p className="mt-0.5 font-medium">{t(lang, "menuCostIncompleteBody")}</p>
                {liveMissingNames.length > 0 ? (
                  <p className="mt-1 font-bold">
                    {tTemplate(lang, "menuCostMissingIngredient", {
                      items: liveMissingNames.join(", "),
                    })}
                  </p>
                ) : null}
                {liveZeroCostNames.length > 0 ? (
                  <p className="mt-1 font-bold">
                    {tTemplate(lang, "menuCostZeroCostIngredient", {
                      items: liveZeroCostNames.join(", "),
                    })}
                  </p>
                ) : null}
              </div>
            )}
            <p className="mt-2 text-[11px] font-medium text-muted-foreground">
              {t(lang, "menuCostEstimatedNote")}
            </p>
          </div>
        )}
      </section>

      {(menu.productKind ?? "finished_menu") === "finished_menu" && (
        <section className="rounded-2xl border border-border p-3">
          <p className="mb-2 text-sm font-black text-foreground">{t(lang, "menuPrepMode")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["made_to_order", "batch_prepared"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMenu({ ...menu, prepMode: mode })}
                className={`min-h-[44px] rounded-xl border px-2 text-xs font-black ${
                  (menu.prepMode ?? "made_to_order") === mode
                    ? "border-waka-500 bg-waka-50 text-waka-700"
                    : "border-border text-muted-foreground"
                }`}
              >
                {t(lang, mode === "made_to_order" ? "menuPrepMadeToOrder" : "menuPrepBatchPrepared")}
              </button>
            ))}
          </div>

          {(menu.prepMode ?? "made_to_order") === "batch_prepared" && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
                <span className="text-xs font-bold text-muted-foreground">{t(lang, "menuPrepAvailable")}</span>
                <span className="text-base font-black text-foreground">{availablePrepared}</span>
              </div>

              {!prepOpen ? (
                <button
                  type="button"
                  onClick={openPrep}
                  className="min-h-[44px] w-full rounded-xl bg-waka-600 text-sm font-black text-white"
                >
                  {t(lang, "menuPrepPrepare")}
                </button>
              ) : (
                <div className="rounded-xl border border-waka-200 bg-waka-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-bold text-muted-foreground">{t(lang, "menuPrepExpectedPortions")}</span>
                      <input
                        value={prepExpectedQty}
                        onChange={(e) => setPrepExpectedQty(e.target.value.replace(/\D/g, ""))}
                        placeholder={String(storeProduct.menu?.recipe?.yieldQty ?? 1)}
                        inputMode="numeric"
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-border px-3 text-lg font-black"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-muted-foreground">{t(lang, "menuPrepActualPortions")}</span>
                      <input
                        value={prepActualQty}
                        onChange={(e) => setPrepActualQty(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-border px-3 text-lg font-black"
                      />
                    </label>
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-muted-foreground">{t(lang, "menuPrepActualYieldHint")}</p>

                  {missingPrepIngredientIds.length > 0 ? (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
                      {t(lang, "menuPrepMissingIngredient")}: {missingPrepIngredientIds.join(", ")}
                    </p>
                  ) : null}

                  {prepPreviewRows.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {prepPreviewRows.map((row) => (
                        <li key={row.ingredientId} className="flex items-center justify-between text-xs">
                          <span className="font-bold">{row.name}</span>
                          <span className={row.required > row.available + 0.0001 ? "font-black text-red-600" : "text-muted-foreground"}>
                            {row.required} {row.unit} {t(lang, "menuPrepRequired").toLowerCase()} · {row.available} {t(lang, "prepAvailableShort")}
                            {row.required > row.available + 0.0001 ? ` · ${t(lang, "menuPrepShortage")}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-2 rounded-lg border border-border bg-card p-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepIngredientCostEstimate")}</span>
                      <span className="font-black">{formatUgx(prepIngredientEstimateUgx)}</span>
                    </div>
                    <label className="mt-2 block">
                      <span className="text-[11px] font-bold text-muted-foreground">{t(lang, "menuPrepActualIngredientCost")}</span>
                      <input
                        value={prepActualIngredientCost}
                        onChange={(e) => setPrepActualIngredientCost(e.target.value.replace(/\D/g, ""))}
                        placeholder={formatUgx(prepIngredientEstimateUgx)}
                        inputMode="numeric"
                        className="mt-1 min-h-[40px] w-full rounded-lg border border-border px-2 text-sm font-black"
                      />
                    </label>

                    <p className="mt-2 text-[11px] font-black uppercase text-muted-foreground">{t(lang, "menuPrepAdditionalCosts")}</p>
                    <p className="text-[11px] font-medium text-muted-foreground">{t(lang, "menuPrepAdditionalCostHint")}</p>
                    <div className="mt-1 space-y-1">
                      {prepExtraCosts.map((cost) => (
                        <div key={cost.id} className="grid grid-cols-[1fr_92px_30px] gap-1">
                          <input
                            value={cost.label}
                            onChange={(e) => updatePrepExtraCost(cost.id, { label: e.target.value })}
                            className="min-h-[36px] rounded-lg border border-border px-2 text-xs font-bold"
                          />
                          <input
                            value={cost.amount}
                            onChange={(e) => updatePrepExtraCost(cost.id, { amount: e.target.value.replace(/\D/g, "") })}
                            placeholder="UGX"
                            inputMode="numeric"
                            className="min-h-[36px] rounded-lg border border-border px-2 text-xs font-black"
                          />
                          <button
                            type="button"
                            onClick={() => setPrepExtraCosts((rows) => rows.filter((row) => row.id !== cost.id))}
                            aria-label={t(lang, "menuPrepRemoveCost")}
                            className="min-h-[36px] rounded-lg border border-border text-sm font-black text-muted-foreground"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPrepExtraCosts((rows) => [...rows, { id: newId("pc"), label: "", amount: "" }])
                      }
                      className="mt-1 text-xs font-black text-waka-700"
                    >
                      + {t(lang, "menuPrepAddCost")}
                    </button>
                  </div>

                  <div className="mt-2 rounded-lg border border-waka-200 bg-card p-2 text-xs">
                    <p className="flex items-center justify-between">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepBatchCost")}</span>
                      <span className="font-black">{formatUgx(prepTotalCostUgx)}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepSaleCogsPerPlate")}</span>
                      <span className="font-black">{formatUgx(prepSaleCogsPerPlateUgx)}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepCostPerPlate")}</span>
                      <span className="font-black">{formatUgx(prepBatchCostPerPlateUgx)}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepSellingPrice")}</span>
                      <span className="font-black">{formatUgx(prepSellingPriceUgx)}</span>
                    </p>
                    <p className="mt-1 font-black text-waka-800">{prepProjectionTitle}</p>
                    <p className="flex items-center justify-between">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepProjectedRevenue")}</span>
                      <span className="font-black">{formatUgx(prepProjectedRevenueUgx)}</span>
                    </p>
                    <p className="flex items-center justify-between">
                      <span className="font-bold text-muted-foreground">{t(lang, "menuPrepProjectedProfit")}</span>
                      <span className="font-black">{formatUgx(prepProjectedProfitUgx)}</span>
                    </p>
                    <p className="text-[11px] font-medium text-muted-foreground">{t(lang, "menuPrepProjectionNote")}</p>
                    <p className="mt-1 text-[11px] font-bold text-muted-foreground">
                      {t(lang, prepActualQtyValue ? "menuPrepYieldActual" : "menuPrepYieldEstimated")} ·{" "}
                      {t(lang, prepActualIngredientCostValue != null ? "menuPrepIngredientCostActual" : "menuPrepIngredientCostEstimate")}
                    </p>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPrepOpen(false)}
                      className="min-h-[44px] rounded-xl border border-border text-sm font-bold text-muted-foreground"
                    >
                      {t(lang, "cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={confirmPrepare}
                      disabled={
                        prepHasShortage ||
                        prepPreviewRows.length === 0 ||
                        missingPrepIngredientIds.length > 0
                      }
                      className="min-h-[44px] rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-40"
                    >
                      {t(lang, "menuPrepConfirm")}
                    </button>
                  </div>
                </div>
              )}

              {storeBatches.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-black uppercase text-muted-foreground">{t(lang, "menuPrepBatchesTitle")}</p>
                  <ul className="space-y-2">
                    {[...storeBatches].reverse().map((batch: PrepBatch) => {
                      const projection = computePrepBatchProjection(batch, storeProduct);
                      return (
                      <li key={batch.id} className="rounded-xl border border-border p-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold">
                            {t(lang, "menuPrepDate")}: {batch.preparedAt.slice(0, 10)}
                          </span>
                          <span
                            className={`font-black ${
                              batch.status === "active" ? "text-waka-700" : "text-muted-foreground"
                            }`}
                          >
                            {batch.status}
                          </span>
                        </div>
                        {batch.totalCostUgx != null ? (
                          <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                            <p>
                              {t(lang, "menuPrepExpectedPortions")}: {batch.expectedPortions ?? batch.portionsPrepared}
                              {" · "}
                              {t(lang, "menuPrepActualPortions")}: {batch.actualPortions ?? "—"}
                            </p>
                            <p className="font-bold text-foreground">
                              {t(lang, batch.yieldBasis === "actual" ? "menuPrepYieldActual" : "menuPrepYieldEstimated")}
                              {" · "}
                              {t(lang, batch.costBasis === "actual" ? "menuPrepIngredientCostActual" : "menuPrepIngredientCostEstimate")}
                            </p>
                            <p>
                              {t(lang, "menuPrepIngredientCostTotal")}: {formatUgx(batch.ingredientCostUgx ?? 0)}
                              {" · "}
                              {t(lang, "menuPrepAdditionalCostTotal")}: {formatUgx(batch.additionalCostUgx ?? 0)}
                            </p>
                            <p>
                              {t(lang, "menuPrepBatchCost")}: {formatUgx(batch.totalCostUgx)}
                            </p>
                            <p>
                              {t(lang, "menuPrepSaleCogsPerPlate")}: {formatUgx(batch.unitCostUgx)}
                              {" · "}
                              {t(lang, "menuPrepCostPerPlate")}:{" "}
                              {formatUgx(batch.batchCostPerPlateUgx ?? batch.unitCostUgx)}
                            </p>
                            <p>
                              {t(lang, "menuPrepRemaining")}: {batch.remainingPortions}
                              {" · "}
                              {t(lang, "menuPrepRemainingValue")}:{" "}
                              {formatUgx(
                                batch.remainingPortions *
                                  (batch.batchCostPerPlateUgx ?? batch.unitCostUgx),
                              )}
                            </p>
                            {batch.wastedPortions ? (
                              <p className="font-bold text-red-700">
                                {t(lang, "menuPrepWasteValue")}: {formatUgx(batch.wasteCostUgx ?? 0)}
                                {" · "}
                                {batch.wastedPortions}
                              </p>
                            ) : null}
                            {projection ? (
                              <div className="rounded-lg bg-muted px-2 py-1">
                                <p className="font-black text-waka-800">
                                  {tTemplate(lang, "menuPrepProjectionTitle", { count: projection.portions })}
                                </p>
                                <p>
                                  {t(lang, "menuPrepSellingPrice")}: {formatUgx(projection.sellingPriceUgx)}
                                </p>
                                <p>
                                  {t(lang, "menuPrepProjectedRevenue")}: {formatUgx(projection.projectedRevenueUgx)}
                                  {" · "}
                                  {t(lang, "menuPrepProjectedProfit")}: {formatUgx(projection.projectedProfitUgx)}
                                </p>
                                <p className="text-[10px] font-medium">{t(lang, "menuPrepProjectionNote")}</p>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {batch.portionsPrepared} · {t(lang, "menuPrepRemaining")} {batch.remainingPortions}
                            </span>
                            <span>
                              {formatUgx(batch.unitCostUgx)} / {formatUgx(batch.unitCostUgx * batch.portionsPrepared)}
                            </span>
                          </div>
                        )}
                        {batch.status === "active" && batch.remainingPortions > 0 && (
                          <div className="mt-2 space-y-2">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setWasteFor(wasteFor === batch.id ? null : batch.id);
                                  setCancelFor(null);
                                  setWasteQty(String(batch.remainingPortions));
                                }}
                                className="min-h-[36px] flex-1 rounded-lg border border-border text-xs font-black text-red-700"
                              >
                                {t(lang, "menuPrepWaste")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActionError(null);
                                  setCancelFor(cancelFor === batch.id ? null : batch.id);
                                  setWasteFor(null);
                                }}
                                className="min-h-[36px] flex-1 rounded-lg border border-border text-xs font-black text-muted-foreground"
                              >
                                {t(lang, "menuPrepCancel")}
                              </button>
                            </div>
                            {wasteFor === batch.id && (
                              <div className="rounded-lg bg-muted p-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    value={wasteQty}
                                    onChange={(e) => setWasteQty(e.target.value.replace(/\D/g, ""))}
                                    className="min-h-[36px] rounded-lg border border-border px-2 text-sm font-black"
                                  />
                                  <select
                                    value={wasteReason}
                                    onChange={(e) => setWasteReason(e.target.value as (typeof WASTE_REASONS)[number])}
                                    className="min-h-[36px] rounded-lg border border-border px-2 text-xs font-bold"
                                  >
                                    {WASTE_REASONS.map((r) => (
                                      <option key={r} value={r}>
                                        {r}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => confirmWaste(batch.id)}
                                  className="mt-2 min-h-[36px] w-full rounded-lg bg-red-600 text-xs font-black text-white"
                                >
                                  {t(lang, "menuPrepConfirmWaste")}
                                </button>
                              </div>
                            )}
                            {cancelFor === batch.id && (
                              <button
                                type="button"
                                onClick={() => confirmCancel(batch.id)}
                                className="min-h-[36px] w-full rounded-lg bg-red-600 text-xs font-black text-white"
                              >
                                {t(lang, "menuPrepCancel")} — {batch.remainingPortions}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {actionError && <p className="text-xs font-bold text-red-600">{actionError}</p>}

      <section className="rounded-2xl border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-foreground">{t(lang, "menuVariantsTitle")}</p>
          <button
            type="button"
            onClick={() => {
              const v: ProductVariant = {
                id: newId("var"),
                label: "Regular",
                priceUgx: product.sellingPricePerUnitUgx,
                isDefault: !(menu.variants?.length),
                isActive: true,
              };
              setMenu({ ...menu, variants: [...(menu.variants ?? []), v] });
            }}
            className="text-xs font-black text-waka-700"
          >
            + {t(lang, "menuAddVariant")}
          </button>
        </div>
        {(menu.variants ?? []).map((variant, vi) => (
          <div key={variant.id} className="mb-2 grid grid-cols-[1fr_100px] gap-2 rounded-xl bg-muted p-2">
            <input
              value={variant.label}
              onChange={(e) => {
                const variants = [...(menu.variants ?? [])];
                variants[vi] = { ...variant, label: e.target.value };
                setMenu({ ...menu, variants });
              }}
              className="min-h-[40px] rounded-lg border border-border px-2 text-sm font-bold"
            />
            <input
              value={variant.priceUgx != null ? String(variant.priceUgx) : ""}
              onChange={(e) => {
                const variants = [...(menu.variants ?? [])];
                variants[vi] = {
                  ...variant,
                  priceUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)),
                };
                setMenu({ ...menu, variants });
              }}
              placeholder="UGX"
              className="min-h-[40px] rounded-lg border border-border px-2 text-sm font-black"
            />
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black text-foreground">{t(lang, "menuComboTitle")}</p>
          <button
            type="button"
            onClick={() => {
              const slot: ComboSlot = {
                id: newId("slot"),
                label: "Choose item",
                required: true,
                choices: [],
              };
              setMenu({
                ...menu,
                combo: { slots: [...(menu.combo?.slots ?? []), slot], comboPriceUgx: menu.combo?.comboPriceUgx ?? null },
              });
            }}
            className="text-xs font-black text-waka-700"
          >
            + {t(lang, "menuAddComboSlot")}
          </button>
        </div>
        <label className="mb-2 block text-xs font-bold">
          {t(lang, "menuComboPrice")}
          <input
            value={menu.combo?.comboPriceUgx != null ? String(menu.combo.comboPriceUgx) : ""}
            onChange={(e) =>
              setMenu({
                ...menu,
                combo: {
                  slots: menu.combo?.slots ?? [],
                  comboPriceUgx: Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0)) || null,
                },
              })
            }
            className="mt-1 min-h-[40px] w-full rounded-lg border border-border px-2 text-sm font-black"
          />
        </label>
        {(menu.combo?.slots ?? []).map((slot, si) => (
          <div key={slot.id} className="mb-3 rounded-xl bg-muted p-2">
            <input
              value={slot.label}
              onChange={(e) => {
                const slots = [...(menu.combo?.slots ?? [])];
                slots[si] = { ...slot, label: e.target.value };
                setMenu({ ...menu, combo: { ...menu.combo!, slots } });
              }}
              className="mb-2 min-h-[40px] w-full rounded-lg border border-border px-2 text-sm font-bold"
            />
            <select
              className="min-h-[40px] w-full rounded-lg border border-border px-2 text-sm"
              value={slot.choices[0]?.productId ?? ""}
              onChange={(e) => {
                const slots = [...(menu.combo?.slots ?? [])];
                const prod = ingredientProducts.find((p) => p.id === e.target.value);
                slots[si] = {
                  ...slot,
                  choices: e.target.value
                    ? [{ productId: e.target.value, isDefault: true, priceDeltaUgx: 0 }]
                    : [],
                };
                void prod;
                setMenu({ ...menu, combo: { ...menu.combo!, slots } });
              }}
            >
              <option value="">{t(lang, "menuComboPickProduct")}</option>
              {ingredientProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>

      <button
        type="button"
        onClick={() =>
          // Batch provenance lives in the store (mutated by prepare/waste/cancel
          // actions) — never clobber it with the editor's stale copy.
          onSave({ ...menu, prepBatches: storeBatches.length ? storeBatches : (menu.prepBatches ?? []) })
        }
        className="min-h-12 w-full rounded-2xl bg-waka-600 text-base font-black text-white"
      >
        {t(lang, "menuSaveConfig")}
      </button>
    </div>
  );
}
