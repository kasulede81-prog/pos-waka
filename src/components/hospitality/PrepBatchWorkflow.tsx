import { useState } from "react";
import type {
  Language,
  PrepBatch,
  PrepBatchAdditionalCost,
  Product,
} from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  computeMenuItemFoodCostUgx,
  computePrepBatchProjection,
  missingRecipeIngredientIds,
  prepRequirementsForPortions,
  preparedPortionsAvailable,
  productPrepMode,
  requirementsFoodCostUgx,
} from "../../lib/recipeEngine";
import { formatUgx } from "../../lib/formatUgx";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  lang: Language;
  /** Saved product — batch truth and action validation always use this record. */
  product: Product;
  /** Recipe preview source; the Menu Builder passes its unsaved local menu. */
  previewProduct: Product;
  /**
   * Menu Builder only: persist `prepMode: batch_prepared` before the first
   * preparation. The Inventory sheet never provides this — switching a dish's
   * preparation mode is a shop-configuration edit, not an inventory action.
   */
  onEnsureBatchPrepared?: () => void;
};

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

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Phase 5 batch-preparation workflow: recorded preparation, waste and
 * cancellation through the existing store actions. Shared by Menu Builder and
 * the Inventory prep sheet so there is exactly one batch UI, costing path and
 * sync queue.
 */
export function PrepBatchWorkflow({ lang, product, previewProduct, onEnsureBatchPrepared }: Props) {
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
  const storeBatches = product.menu?.prepBatches ?? [];
  const availablePrepared = preparedPortionsAvailable(product);
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
    setPrepExpectedQty(String(product.menu?.recipe?.yieldQty ?? 1));
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
    Math.max(1, Math.floor(product.menu?.recipe?.yieldQty ?? 1));
  const prepActualQtyValue = positiveIntOrNull(prepActualQty);
  const prepPreparedQty = prepActualQtyValue ?? prepExpectedQtyValue;
  const prepPreview = prepRequirementsForPortions(previewProduct, prepExpectedQtyValue);
  const prepPreviewRows = [...prepPreview.entries()].map(([ingredientId, required]) => {
    const ing = allProducts.find((p) => p.id === ingredientId);
    const available = ing?.stockOnHand ?? 0;
    return { ingredientId, name: ing?.name ?? ingredientId, unit: ing?.baseUnit ?? "ea", required, available };
  });
  const missingPrepIngredientIds = missingRecipeIngredientIds(previewProduct, allProducts);
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
  // Recipe ingredient cost per plate (recipe yield basis), NOT the batch cost.
  const prepRecipeCostPerPlateUgx = Math.max(
    0,
    Math.round(computeMenuItemFoodCostUgx(previewProduct, allProducts)),
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
    if (productPrepMode(product) !== "batch_prepared") {
      if (!onEnsureBatchPrepared) {
        setActionError(t(lang, "prepModeRequiresBatch"));
        return;
      }
      onEnsureBatchPrepared();
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

  return (
    <div className="space-y-3">
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
                placeholder={String(product.menu?.recipe?.yieldQty ?? 1)}
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
              <span className="font-bold text-muted-foreground">{t(lang, "menuPrepRecipeCostPerPlate")}</span>
              <span className="font-black">{formatUgx(prepRecipeCostPerPlateUgx)}</span>
            </p>
            <p className="flex items-center justify-between">
              <span className="font-bold text-muted-foreground">{t(lang, "menuPrepSaleCogsPerPlate")}</span>
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
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">
              {t(lang, "menuPrepBatchCostBasisNote")}
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
              const projection = computePrepBatchProjection(batch, product);
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
                      {t(lang, "menuPrepCostPerPlate")}: {formatUgx(batch.unitCostUgx)}
                      {" · "}
                      {t(lang, "menuPrepSaleCogsPerPlate")}:{" "}
                      {formatUgx(batch.batchCostPerPlateUgx ?? batch.unitCostUgx)}
                    </p>
                    {batch.batchCostPerPlateUgx == null ? (
                      <p className="font-bold text-amber-700">
                        {t(lang, "menuPrepLegacyBatch")}
                      </p>
                    ) : null}
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
                      {t(lang, "menuPrepCostPerPlate")}: {formatUgx(batch.unitCostUgx)} ·{" "}
                      {t(lang, "menuPrepLegacyBatch")}:{" "}
                      {formatUgx(batch.unitCostUgx * batch.portionsPrepared)}
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
          <p className="mt-1 text-[10px] font-medium text-muted-foreground">
            {t(lang, "menuPrepBatchCostBasisNote")}
          </p>
        </div>
      )}

      {actionError && <p className="text-xs font-bold text-red-600">{actionError}</p>}
    </div>
  );
}
