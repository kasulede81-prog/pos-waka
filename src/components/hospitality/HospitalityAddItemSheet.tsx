import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import type { Language, ProductMenuConfig, RecipeLine } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import {
  activeMenuSections,
  menuSectionLabel,
  resolveMenuSections,
} from "../../lib/menuSections";
import { unitCostFromPackTotal } from "../../lib/costPrecision";
import {
  buildRecipeLineFromEntry,
  formatRecipeQuantityInput,
  parseRecipeQuantityInput,
  recipePackUnitForIngredient,
  recipeQuantityForEntry,
  recipeQuantityToBase,
  type RecipeEntryUnit,
} from "../../lib/recipeQuantityUnits";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";
import { WakaButton } from "../ui/wakaPrimitives";

type ItemKind = "ingredient" | "retail" | "dish";

type RecipeDraft = {
  ingredientProductId: string;
  /** Typed quantity in `entryUnit` (never persisted until converted to base). */
  quantity: string;
  entryUnit: RecipeEntryUnit;
};

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  initialCategory?: string;
  canOpenMenuBuilder?: boolean;
  onSaved?: () => void;
};

const UNIT_SUGGESTIONS = ["kg", "g", "L", "ml", "piece", "pack", "portion"];

/** Kitchen weight/volume units are sold by measure; everything else by unit. */
function sellingModeForUnit(unit: string): "weighted" | "unit" {
  return /^(kg|g|l|ml|litre|liter)$/i.test(unit.trim()) ? "weighted" : "unit";
}

const fieldClass =
  "mt-1 min-h-11 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground";

/**
 * Hospitality item setup on the shared Kiosk Duka product/stock model.
 * Ingredients are stock inputs; drinks/retail are sold from stock; prepared
 * dishes carry a recipe and prep mode, and their stock comes from prep batches.
 * Nothing here creates a second inventory ledger or rewrites retail behavior.
 */
export function HospitalityAddItemSheet({
  lang,
  open,
  onClose,
  initialCategory,
  canOpenMenuBuilder = false,
  onSaved,
}: Props) {
  const products = usePosStore((s) => s.products);
  const preferences = usePosStore((s) => s.preferences);
  const quickAddProduct = usePosStore((s) => s.quickAddProduct);

  const [kind, setKind] = useState<ItemKind>("ingredient");
  const [name, setName] = useState("");
  const [category, setCategory] = useState(initialCategory?.trim() || "Ingredients");
  const [baseUnit, setBaseUnit] = useState("kg");
  const [buyingUnit, setBuyingUnit] = useState("");
  const [conversionRate, setConversionRate] = useState("");
  const [packPrice, setPackPrice] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [lowStock, setLowStock] = useState("5");
  const [prepMode, setPrepMode] = useState<"made_to_order" | "batch_prepared">("made_to_order");
  const [menuSection, setMenuSection] = useState("");
  const [yieldQty, setYieldQty] = useState("4");
  const [recipeRows, setRecipeRows] = useState<RecipeDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const ingredientProducts = useMemo(
    () =>
      products.filter((p) => {
        const productKind = p.menu?.productKind;
        return productKind === "ingredient" || productKind === "semi_finished";
      }),
    [products],
  );

  const ingredientById = useMemo(
    () => new Map(ingredientProducts.map((p) => [p.id, p])),
    [ingredientProducts],
  );

  const sections = useMemo(
    () => resolveMenuSections(preferences),
    [preferences],
  );
  const activeSections = useMemo(() => activeMenuSections(sections), [sections]);
  // New dishes may only use active sections. If every section is inactive the
  // dish is saved without a section and keeps selling normally.
  const effectiveMenuSection = activeSections.some((section) => section.id === menuSection)
    ? menuSection
    : activeSections[0]?.id ?? "";

  const conversionN = Math.max(0, Number(conversionRate.replace(/[^\d.]/g, "")) || 0);
  const packPriceN = Math.floor(Number(packPrice.replace(/\D/g, "")) || 0);
  const computedCost = packPriceN > 0 && conversionN > 0 ? unitCostFromPackTotal(packPriceN, conversionN) : null;
  const costN =
    computedCost ?? Math.max(0, Number(costPerUnit.replace(/[^\d.]/g, "")) || 0);
  const sellPriceN = Math.floor(Number(sellingPrice.replace(/\D/g, "")) || 0);
  const openingStockN = Math.max(0, Number(openingStock.replace(/[^\d.]/g, "")) || 0);
  const lowStockN = Math.max(0, Math.floor(Number(lowStock.replace(/\D/g, "")) || 0));
  const yieldN = Math.max(0, Number(yieldQty.replace(/[^\d.]/g, "")) || 0);

  const pickKind = (next: ItemKind) => {
    setKind(next);
    setError(null);
    setSaved(false);
    if (next === "ingredient") {
      setCategory(initialCategory?.trim() || "Ingredients");
      setBaseUnit("kg");
      setSellingPrice("");
      setLowStock("5");
      return;
    }
    if (next === "retail") {
      setCategory(initialCategory?.trim() || "Drinks");
      setBaseUnit("piece");
      setSellingPrice("");
      setLowStock("5");
      return;
    }
    setCategory("Food");
    setBaseUnit("plate");
    setSellingPrice("");
    setLowStock("0");
  };

  const addRecipeRow = () => {
    const first = ingredientProducts[0];
    setRecipeRows((rows) => [
      ...rows,
      { ingredientProductId: first?.id ?? "", quantity: "1", entryUnit: "base" },
    ]);
  };

  const updateRecipeRow = (index: number, patch: Partial<RecipeDraft>) => {
    setRecipeRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRecipeRow = (index: number) => {
    setRecipeRows((rows) => rows.filter((_, i) => i !== index));
  };

  const save = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t(lang, "hospitalityAddInvalid"));
      return;
    }

    let menu: ProductMenuConfig;
    let price = 0;
    let stockQty: number;
    let minAlert: number;
    let unit = baseUnit.trim() || "piece";
    let costPrice = costN;

    if (kind === "ingredient") {
      menu = { productKind: "ingredient" };
      stockQty = openingStockN;
      minAlert = lowStockN;
    } else if (kind === "retail") {
      if (sellPriceN <= 0) {
        setError(t(lang, "hospitalityAddInvalid"));
        return;
      }
      menu = { productKind: "retail" };
      price = sellPriceN;
      stockQty = openingStockN;
      minAlert = lowStockN;
    } else {
      if (sellPriceN <= 0) {
        setError(t(lang, "hospitalityAddInvalid"));
        return;
      }
      const lines: RecipeLine[] = recipeRows
        .map((row) =>
          buildRecipeLineFromEntry({
            ingredient: ingredientById.get(row.ingredientProductId),
            ingredientProductId: row.ingredientProductId,
            quantity: parseRecipeQuantityInput(row.quantity),
            entryUnit: row.entryUnit,
          }),
        )
        .filter((line): line is RecipeLine => line != null);
      if (lines.length === 0 || yieldN <= 0) {
        setError(t(lang, "hospitalityAddRecipeRequired"));
        return;
      }
      menu = {
        productKind: "finished_menu",
        prepMode,
        menuSection: effectiveMenuSection || null,
        recipe: { lines, yieldQty: yieldN },
        prepBatches: [],
        modifierGroups: [],
      };
      price = sellPriceN;
      stockQty = 0;
      minAlert = prepMode === "batch_prepared" ? lowStockN : 0;
      unit = "plate";
      costPrice = 0;
    }

    const sectionLabel = menuSectionLabel(
      sections,
      effectiveMenuSection,
      t(lang, "generalCategory"),
    );
    const result = quickAddProduct({
      name: trimmed,
      priceUgx: price,
      stockQty,
      category:
        kind === "dish"
          ? sectionLabel
          : category.trim() || (kind === "ingredient" ? "Ingredients" : "Drinks"),
      baseUnit: unit,
      sellingMode: kind === "dish" ? "unit" : sellingModeForUnit(unit),
      buyingUnit: kind === "dish" ? null : buyingUnit.trim() || null,
      conversionRate: kind === "dish" ? null : conversionN > 0 ? conversionN : null,
      costPricePerUnitUgx: costPrice,
      buyingPackCostUgx: kind === "dish" ? null : packPriceN > 0 ? packPriceN : null,
      minimumStockAlert: minAlert,
      menu,
      ...(kind === "ingredient" ? { allowZeroSellingPrice: true } : {}),
    });
    if (!result.ok) {
      setError(t(lang, result.errorKey ?? "invalid"));
      return;
    }
    setSaved(true);
    onSaved?.();
  };

  const kindButton = (value: ItemKind, labelKey: string, hintKey: string) => (
    <button
      type="button"
      onClick={() => pickKind(value)}
      className={`rounded-2xl border-2 px-3 py-3 text-left ${
        kind === value ? "border-waka-600 bg-waka-50 text-waka-950" : "border-border bg-card text-foreground"
      }`}
    >
      <span className="block text-sm font-black">{t(lang, labelKey)}</span>
      <span className="mt-0.5 block text-[11px] font-semibold text-muted-foreground">{t(lang, hintKey)}</span>
    </button>
  );

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      align="center"
      zIndexClass="z-[70]"
      title={t(lang, "hospitalityAddItemTitle")}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <WakaButton type="button" variant="secondary" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
          <WakaButton type="button" onClick={save} disabled={saved}>
            {t(lang, "hospitalityAddSave")}
          </WakaButton>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-medium text-muted-foreground">{t(lang, "hospitalityAddItemSub")}</p>

        <div className="grid gap-2 sm:grid-cols-3">
          {kindButton("ingredient", "hospitalityAddKindIngredient", "hospitalityAddKindIngredientHint")}
          {kindButton("retail", "hospitalityAddKindRetail", "hospitalityAddKindRetailHint")}
          {kindButton("dish", "hospitalityAddKindDish", "hospitalityAddKindDishHint")}
        </div>

        <label className="block">
          <span className="text-xs font-black text-muted-foreground">{t(lang, "hospitalityAddName")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, "hospitalityAddNamePh")}
            autoFocus
            className={fieldClass}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-black text-muted-foreground">
              {kind === "dish" ? t(lang, "hospitalityAddMenuSection") : t(lang, "stockDetailCategory")}
            </span>
            {kind === "dish" ? (
              <select
                value={effectiveMenuSection}
                onChange={(e) => setMenuSection(e.target.value)}
                className={fieldClass}
              >
                {activeSections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
                {activeSections.length === 0 ? (
                  <option value="">{t(lang, "menuSectionNone")}</option>
                ) : null}
              </select>
            ) : (
              <input value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass} />
            )}
          </label>

          {kind !== "dish" ? (
            <label className="block">
              <span className="text-xs font-black text-muted-foreground">{t(lang, "hospitalityAddUnit")}</span>
              <input
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value)}
                list="hospitality-add-units"
                className={fieldClass}
              />
              <datalist id="hospitality-add-units">
                {UNIT_SUGGESTIONS.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </label>
          ) : null}
        </div>

        {kind !== "dish" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-black text-muted-foreground">
                  {t(lang, "hospitalityAddBuyingUnit")}
                </span>
                <input
                  value={buyingUnit}
                  onChange={(e) => setBuyingUnit(e.target.value)}
                  placeholder="sack, crate, box"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="text-xs font-black text-muted-foreground">
                  {t(lang, "hospitalityAddConversion")}
                </span>
                <input
                  value={conversionRate}
                  onChange={(e) => setConversionRate(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className="text-xs font-black text-muted-foreground">
                  {t(lang, "hospitalityAddPackPrice")}
                </span>
                <input
                  value={packPrice}
                  onChange={(e) => setPackPrice(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="UGX"
                  className={fieldClass}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black text-muted-foreground">
                  {t(lang, "hospitalityAddCostPerUnit")}
                </span>
                <input
                  value={computedCost != null ? String(computedCost) : costPerUnit}
                  onChange={(e) => setCostPerUnit(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  readOnly={computedCost != null}
                  className={fieldClass}
                />
                {computedCost != null ? (
                  <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">
                    {t(lang, "hospitalityAddComputedCost")}: {formatUgx(computedCost)}
                  </span>
                ) : null}
              </label>
              <label className="block">
                <span className="text-xs font-black text-muted-foreground">
                  {t(lang, "hospitalityAddOpeningStock")}
                </span>
                <input
                  value={openingStock}
                  onChange={(e) => setOpeningStock(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  className={fieldClass}
                />
              </label>
            </div>
            <p className="text-[11px] font-semibold text-muted-foreground">
              {t(lang, "hospitalityAddStockHint")}
            </p>
          </>
        ) : null}

        {kind === "retail" || kind === "dish" ? (
          <label className="block">
            <span className="text-xs font-black text-muted-foreground">{t(lang, "stockDetailSellPrice")}</span>
            <input
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="UGX"
              className={fieldClass}
            />
          </label>
        ) : null}

        {kind !== "dish" || prepMode === "batch_prepared" ? (
          <label className="block">
            <span className="text-xs font-black text-muted-foreground">
              {t(lang, "hospitalityAddLowStock")}
            </span>
            <input
              value={lowStock}
              onChange={(e) => setLowStock(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className={fieldClass}
            />
          </label>
        ) : null}

        {kind === "dish" ? (
          <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-3">
            <div>
              <p className="text-xs font-black text-muted-foreground">{t(lang, "hospitalityAddPrepMode")}</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPrepMode("made_to_order")}
                  className={`min-h-11 rounded-xl border px-2 text-xs font-black ${
                    prepMode === "made_to_order"
                      ? "border-waka-600 bg-waka-50 text-waka-950"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  {t(lang, "hospitalityAddMadeToOrder")}
                </button>
                <button
                  type="button"
                  onClick={() => setPrepMode("batch_prepared")}
                  className={`min-h-11 rounded-xl border px-2 text-xs font-black ${
                    prepMode === "batch_prepared"
                      ? "border-waka-600 bg-waka-50 text-waka-950"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  {t(lang, "hospitalityAddBatchPrepared")}
                </button>
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-black text-muted-foreground">{t(lang, "hospitalityAddYield")}</span>
              <input
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="numeric"
                className={fieldClass}
              />
            </label>

            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black text-muted-foreground">{t(lang, "hospitalityAddRecipe")}</p>
                <button
                  type="button"
                  onClick={addRecipeRow}
                  disabled={ingredientProducts.length === 0}
                  className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-border bg-card px-2 text-xs font-black text-waka-700 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t(lang, "hospitalityAddAddIngredient")}
                </button>
              </div>

              {ingredientProducts.length === 0 ? (
                <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
                  {t(lang, "hospitalityAddNoIngredients")}
                </p>
              ) : recipeRows.length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-muted-foreground">
                  {t(lang, "hospitalityAddRecipeRequired")}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {recipeRows.map((row, index) => {
                    const ingredient = ingredientById.get(row.ingredientProductId);
                    const pack = ingredient ? recipePackUnitForIngredient(ingredient) : null;
                    const entryUnit: RecipeEntryUnit = pack ? row.entryUnit : "base";
                    const parsed = parseRecipeQuantityInput(row.quantity);
                    const baseQty =
                      parsed == null ? null : recipeQuantityToBase(parsed, entryUnit, pack);
                    const baseUnitLabel = ingredient?.baseUnit ?? "ea";
                    const conversionHint = pack
                      ? tTemplate(lang, "menuRecipePackConversion", {
                          pack: pack.label,
                          rate: formatRecipeQuantityInput(pack.baseUnitsPerPack),
                          unit: pack.baseUnit,
                        })
                      : baseUnitLabel;
                    const equivalentHint =
                      entryUnit === "pack" && pack && baseQty != null
                        ? tTemplate(lang, "menuRecipePackEquivalent", {
                            qty: formatRecipeQuantityInput(baseQty),
                            unit: pack.baseUnit,
                          })
                        : null;
                    return (
                      <li key={index} className="grid grid-cols-[1fr_84px_28px] items-center gap-2">
                        <select
                          value={row.ingredientProductId}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            // Preserve the physical base quantity; never reinterpret
                            // the typed number as the new ingredient's pack size.
                            const base =
                              parsed == null
                                ? 0
                                : recipeQuantityToBase(parsed, entryUnit, pack) ?? 0;
                            updateRecipeRow(index, {
                              ingredientProductId: nextId,
                              quantity: formatRecipeQuantityInput(base),
                              entryUnit: "base",
                            });
                          }}
                          className="min-h-11 rounded-xl border border-border bg-card px-2 text-xs font-bold"
                        >
                          <option value="">{t(lang, "menuCostSelectIngredient")}</option>
                          {ingredientProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={row.quantity}
                          onChange={(e) =>
                            updateRecipeRow(index, { quantity: e.target.value.replace(/[^\d.]/g, "") })
                          }
                          inputMode="decimal"
                          aria-label={t(lang, "menuCostQuantity")}
                          className="min-h-11 rounded-xl border border-border bg-card px-2 text-xs font-black"
                        />
                        <button
                          type="button"
                          onClick={() => removeRecipeRow(index)}
                          aria-label={t(lang, "menuCostRemoveIngredient")}
                          className="flex min-h-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <div className="col-span-3 -mt-1 flex flex-wrap items-center gap-2">
                          {pack ? (
                            <select
                              value={entryUnit}
                              onChange={(e) => {
                                const next = e.target.value as RecipeEntryUnit;
                                const base =
                                  parsed == null
                                    ? 0
                                    : recipeQuantityToBase(parsed, entryUnit, pack) ?? 0;
                                const display = recipeQuantityForEntry(base, next, pack);
                                updateRecipeRow(index, {
                                  entryUnit: next,
                                  quantity: formatRecipeQuantityInput(display),
                                });
                              }}
                              aria-label={t(lang, "menuRecipeQuantityUnit")}
                              className="min-h-[32px] rounded-lg border border-border bg-card px-1 text-[10px] font-bold"
                            >
                              <option value="base">{baseUnitLabel}</option>
                              <option value="pack">{pack.label}</option>
                            </select>
                          ) : null}
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {equivalentHint ? `${equivalentHint} · ` : ""}
                            {conversionHint}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <p className="text-[11px] font-semibold text-muted-foreground">
              {t(lang, "hospitalityAddDishCostNote")}
            </p>
            {prepMode === "batch_prepared" ? (
              <p className="text-[11px] font-semibold text-muted-foreground">
                {t(lang, "hospitalityAddDishStockNote")}
              </p>
            ) : null}
            {canOpenMenuBuilder ? (
              <Link to="/settings/menu" className="inline-flex min-h-9 items-center text-xs font-black text-waka-700">
                {t(lang, "menuBuilderOpen")} →
              </Link>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
            {t(lang, "hospitalityAddSaved")}
          </p>
        ) : null}
      </div>
    </ModalSheet>
  );
}
