import { useState } from "react";
import type { Language, ModifierGroup, ModifierOption, PrepBatch, Product, ProductMenuConfig, ProductVariant, RecipeLine, ComboSlot } from "../../types";
import { t } from "../../lib/i18n";
import { DEFAULT_MENU_SECTIONS } from "../../lib/menuModifiers";
import {
  computeMenuItemMargin,
  prepRequirementsForPortions,
  preparedPortionsAvailable,
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

export function ProductMenuConfigFields({ lang, product, ingredientProducts, onSave }: Props) {
  const [menu, setMenu] = useState<ProductMenuConfig>(
    product.menu ?? { productKind: "finished_menu", modifierGroups: [], variants: [], recipe: { lines: [] } },
  );
  // Phase 5 — preparation workflow state (batch truth always read from the store product).
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepQty, setPrepQty] = useState("");
  const [wasteFor, setWasteFor] = useState<string | null>(null);
  const [wasteQty, setWasteQty] = useState("");
  const [wasteReason, setWasteReason] = useState<(typeof WASTE_REASONS)[number]>("spoiled");
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const confirmPrepare = () => {
    const portions = Math.floor(Number(prepQty) || 0);
    if (portions <= 0) {
      setActionError(t(lang, "invalidQty"));
      return;
    }
    // The action validates against the SAVED product — persist prepMode first if needed.
    if (storePrepMode !== "batch_prepared") {
      onSave({ ...menu, prepMode: "batch_prepared", prepBatches: storeBatches });
    }
    if (runAction(() => prepareMenuBatch({ productId: product.id, portions }))) {
      setPrepOpen(false);
      setPrepQty("");
    }
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

  const prepPreviewPortions = Math.max(1, Math.floor(Number(prepQty) || storeProduct.menu?.recipe?.yieldQty || 1));
  const prepPreview = prepRequirementsForPortions({ ...product, menu }, prepPreviewPortions);
  const prepPreviewRows = [...prepPreview.entries()].map(([ingredientId, required]) => {
    const ing = ingredientProducts.find((p) => p.id === ingredientId);
    const available = ing?.stockOnHand ?? 0;
    return { ingredientId, name: ing?.name ?? ingredientId, unit: ing?.baseUnit ?? "ea", required, available };
  });
  const prepHasShortage = prepPreviewRows.some((r) => r.required > r.available + 0.0001);

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

  const addRecipeLine = () => {
    const line: RecipeLine = {
      ingredientProductId: ingredientProducts[0]?.id ?? "",
      quantityBase: 1,
      unitLabel: ingredientProducts[0]?.baseUnit ?? "ea",
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

  // Live food-cost panel: run the exact same engine the sale finalize path uses,
  // against the in-progress (not yet saved) menu config.
  const syntheticProduct: Product = { ...product, menu };
  const liveMargin = computeMenuItemMargin(syntheticProduct, ingredientProducts);

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
          <button type="button" onClick={addRecipeLine} className="text-xs font-black text-waka-700">
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
          </div>
        ))}

        {(menu.recipe?.lines ?? []).length > 0 && (
          <div className="mt-3 rounded-xl border border-waka-200 bg-waka-50 p-3">
            <p className="mb-2 text-xs font-black uppercase text-waka-700">{t(lang, "menuCostPanelTitle")}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t(lang, "menuCostFoodCost")}</dt>
              <dd className="text-right font-black">{formatUgx(liveMargin.foodCostUgx)}</dd>
              <dt className="text-muted-foreground">{t(lang, "menuCostSellPrice")}</dt>
              <dd className="text-right font-black">{formatUgx(liveMargin.sellPriceUgx)}</dd>
              <dt className="text-muted-foreground">{t(lang, "menuCostProfit")}</dt>
              <dd className="text-right font-black">{formatUgx(liveMargin.profitUgx)}</dd>
              <dt className="text-muted-foreground">{t(lang, "menuCostMargin")}</dt>
              <dd className="text-right font-black">{liveMargin.marginPct.toFixed(1)}%</dd>
            </dl>
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
                  onClick={() => {
                    setActionError(null);
                    setPrepOpen(true);
                  }}
                  className="min-h-[44px] w-full rounded-xl bg-waka-600 text-sm font-black text-white"
                >
                  {t(lang, "menuPrepPrepare")}
                </button>
              ) : (
                <div className="rounded-xl border border-waka-200 bg-waka-50 p-3">
                  <label className="block">
                    <span className="text-xs font-bold text-muted-foreground">{t(lang, "menuPrepPortions")}</span>
                    <input
                      value={prepQty}
                      onChange={(e) => setPrepQty(e.target.value.replace(/\D/g, ""))}
                      placeholder={String(storeProduct.menu?.recipe?.yieldQty ?? 1)}
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-border px-3 text-lg font-black"
                    />
                  </label>
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
                      disabled={prepHasShortage || prepPreviewRows.length === 0}
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
                    {[...storeBatches].reverse().map((batch: PrepBatch) => (
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
                        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {batch.portionsPrepared} · {t(lang, "menuPrepRemaining")} {batch.remainingPortions}
                          </span>
                          <span>
                            {formatUgx(batch.unitCostUgx)} / {formatUgx(batch.unitCostUgx * batch.portionsPrepared)}
                          </span>
                        </div>
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
                    ))}
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
