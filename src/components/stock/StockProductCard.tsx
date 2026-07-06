import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../lib/sellingEngine";
import {
  formatPharmacyStockPrimary,
  isPharmacyPackagingActive,
} from "../../lib/pharmacyPackaging";
import { normalizedCategoryKey, shelfIconFor } from "../../lib/productCategories";
import { formatMedicineListPrimary, formatMedicineListSecondary } from "../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../lib/pharmacy";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { ExpiryStatusBadge } from "../pharmacy/ExpiryStatusBadge";
import { computeMedicineBatchSummary, medicineDisplayBrand, medicineDisplayGeneric } from "../../lib/pharmacyBatches";
import { StockProductActionSheet } from "./StockProductActionSheet";

type RowAction = "edit" | "sell" | "restock" | "duplicate" | "remove";

type Props = {
  lang: Language;
  product: Product;
  preferences: ShopPreferences;
  locked: boolean;
  canAdd: boolean;
  canRemove: boolean;
  canSell: boolean;
  canRestock: boolean;
  isOnlyProduct?: boolean;
  variant?: "default" | "lowStock";
  onAction: (action: RowAction) => void;
  onOpenDetail?: () => void;
};

export function StockProductCard({
  lang,
  product: p,
  preferences,
  locked,
  canAdd,
  canRemove,
  canSell,
  canRestock,
  isOnlyProduct: _isOnlyProduct,
  variant = "default",
  onAction,
  onOpenDetail,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const low = isLowStock(p);
  const shelf = normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized");
  const shelfIcon = shelfIconFor(shelf);
  const detail = pharmacyMode ? formatMedicineListSecondary(p) : null;
  const stockText = isPharmacyPackagingActive(p)
    ? formatPharmacyStockPrimary(p)
    : formatStockLabel(p);
  const batchSummary = pharmacyMode ? computeMedicineBatchSummary(p) : null;
  const lowStockFocus = variant === "lowStock";

  return (
    <>
      <div
        className={clsx(
          "rounded-xl border bg-white p-2.5 shadow-sm transition-all",
          locked ? "border-stone-200/80 opacity-55" : "border-stone-200/90",
          low && !locked && lowStockFocus && "border-rose-200/90 bg-rose-50/30",
        )}
      >
        <button
          type="button"
          onClick={() => onOpenDetail?.()}
          disabled={!onOpenDetail}
          className={clsx(
            "flex w-full gap-2.5 text-left",
            onOpenDetail && "active:opacity-90",
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-lg leading-none">
            {shelfIcon ?? "📦"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="line-clamp-1 text-sm font-black text-stone-950">
                {pharmacyMode ? medicineDisplayBrand(p) : formatMedicineListPrimary(p)}
              </p>
              {pharmacyMode && medicineDisplayGeneric(p) ? (
                <span className="truncate text-[10px] font-semibold text-stone-500">{medicineDisplayGeneric(p)}</span>
              ) : null}
              {pharmacyMode ? <ExpiryStatusBadge lang={lang} product={p} compact /> : null}
              {pharmacyMode && p.pharmacyMaster?.controlledDrug ? (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-violet-900">
                  {t(lang, "pharmacyControlledBadge")}
                </span>
              ) : null}
              {pharmacyMode && p.pharmacyMaster?.refrigerated ? (
                <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-sky-900">
                  {t(lang, "pharmacyColdBadge")}
                </span>
              ) : null}
              {locked ? (
                <span className="rounded-full bg-stone-800 px-1.5 py-0.5 text-[8px] font-black uppercase text-white">
                  {t(lang, "productLockedBadge")}
                </span>
              ) : null}
              {low && !locked && lowStockFocus ? (
                <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-rose-800">
                  {t(lang, "cardLowStock")}
                </span>
              ) : null}
            </div>
            {detail ? <p className="truncate text-[10px] font-semibold text-stone-600">{detail}</p> : null}
            <p className="mt-0.5 truncate text-[10px] font-semibold text-stone-500">{shelf}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={clsx(
                  "text-[10px] font-bold",
                  low && !locked ? "text-rose-700" : "text-stone-600",
                )}
              >
                {t(lang, "stockLabel")}: {stockText}
              </span>
              {batchSummary && batchSummary.batchCount > 0 ? (
                <span className="text-[10px] font-bold text-stone-500">
                  · {batchSummary.batchCount} {t(lang, "pharmacyBatches").toLowerCase()}
                  {batchSummary.nearestExpiry ? ` · ${batchSummary.nearestExpiry}` : ""}
                </span>
              ) : null}
              <span className="text-xs font-black text-teal-700">{formatProductPriceLabel(p)}</span>
            </div>
          </div>
        </button>

        {!locked ? (
          <div className="mt-2 flex gap-1.5">
            {lowStockFocus && canRestock ? (
              <button
                type="button"
                onClick={() => onAction("restock")}
                className="min-h-[36px] flex-1 rounded-lg bg-waka-600 px-2 text-xs font-black text-white active:bg-waka-700"
              >
                {t(lang, "stockGoRestock")}
              </button>
            ) : (
              <>
                {canSell ? (
                  <button
                    type="button"
                    onClick={() => onAction("sell")}
                    className="min-h-[36px] flex-1 rounded-lg bg-waka-600 px-2 text-xs font-black text-white active:bg-waka-700"
                  >
                    {pharmacyMode ? pt("stockCardSell") : t(lang, "stockCardSell")}
                  </button>
                ) : null}
                {canAdd ? (
                  <button
                    type="button"
                    onClick={() => onAction("edit")}
                    className="min-h-[36px] flex-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-black text-stone-800 active:bg-stone-50"
                  >
                    {t(lang, "stockCardEdit")}
                  </button>
                ) : null}
              </>
            )}
            {(canAdd || canRestock || canRemove) ? (
              <button
                type="button"
                aria-expanded={sheetOpen}
                onClick={() => setSheetOpen(true)}
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-700 active:bg-stone-50"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">{t(lang, "stockMoreActions")}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <StockProductActionSheet
        lang={lang}
        open={sheetOpen}
        productName={p.name}
        canAdd={canAdd}
        canRestock={canRestock}
        canRemove={canRemove}
        onClose={() => setSheetOpen(false)}
        onAction={(action) => onAction(action)}
      />
    </>
  );
}
