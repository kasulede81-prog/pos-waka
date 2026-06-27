import { useEffect } from "react";
import clsx from "clsx";
import type { Language, Product, ShopPreferences } from "../../types";
import { t } from "../../lib/i18n";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../lib/sellingEngine";
import { normalizedCategoryKey, shelfIconFor } from "../../lib/productCategories";
import { formatMedicineListPrimary, formatMedicineListSecondary } from "../../lib/pharmacyMedicine";
import { isPharmacyMode } from "../../lib/pharmacy";
import { usePharmacyTerms } from "../../lib/pharmacyTerms";
import { profitPerSellUnitUgx } from "../../lib/simpleProductWizard";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { ExpiryStatusBadge } from "../pharmacy/ExpiryStatusBadge";

type Props = {
  lang: Language;
  open: boolean;
  product: Product | null;
  preferences: ShopPreferences;
  locked: boolean;
  canAdd: boolean;
  canSell: boolean;
  onClose: () => void;
  onSell: () => void;
  onEdit: () => void;
  onMore: () => void;
};

function formatUpdated(iso: string, lang: Language): string {
  const locale = lang === "sw" ? "sw-UG" : "en-UG";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Kampala",
  }).format(new Date(iso));
}

export function StockProductDetailSheet({
  lang,
  open,
  product,
  preferences,
  locked,
  canAdd,
  canSell,
  onClose,
  onSell,
  onEdit,
  onMore,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !product) return null;

  const pharmacyMode = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const shelf = normalizedCategoryKey(product) ? product.category!.trim() : t(lang, "uncategorized");
  const shelfIcon = shelfIconFor(shelf) ?? "📦";
  const low = isLowStock(product);
  const profit = profitPerSellUnitUgx(product.sellingPricePerUnitUgx, product.costPricePerUnitUgx);
  const marginPct =
    product.sellingPricePerUnitUgx > 0 && profit != null
      ? Math.round((profit / product.sellingPricePerUnitUgx) * 1000) / 10
      : null;

  const rows = [
    { label: t(lang, "stockDetailCategory"), value: shelf },
    { label: t(lang, "stockDetailShelf"), value: shelf },
    { label: t(lang, "stockDetailBarcode"), value: product.sku?.trim() || "—" },
    {
      label: t(lang, "stockLabel"),
      value: formatStockLabel(product),
      valueClass: low ? "text-rose-700" : undefined,
    },
    {
      label: t(lang, "stockDetailCost"),
      value: product.costPricePerUnitUgx > 0 ? `UGX ${Math.round(product.costPricePerUnitUgx).toLocaleString()}` : "—",
    },
    { label: t(lang, "stockDetailSellPrice"), value: formatProductPriceLabel(product) },
    {
      label: t(lang, "stockDetailProfit"),
      value: profit != null ? `UGX ${profit.toLocaleString()}` : "—",
      valueClass: profit != null && profit < 0 ? "text-rose-700" : profit != null ? "text-teal-800" : undefined,
    },
    ...(marginPct != null
      ? [{ label: t(lang, "profitStatMargin"), value: `${marginPct.toFixed(1)}%`, valueClass: marginPct < 0 ? "text-rose-700" : "text-teal-800" }]
      : []),
    { label: t(lang, "stockDetailLastUpdated"), value: formatUpdated(product.updatedAt, lang) },
  ];

  const closeAnd = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-stone-900/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div className="relative z-[55] max-h-[min(88dvh,42rem)] w-full overflow-y-auto rounded-t-[1.75rem] border border-stone-200 bg-white px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" aria-hidden />

        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-2xl leading-none">
            {shelfIcon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-black text-stone-950">{formatMedicineListPrimary(product)}</p>
            {pharmacyMode && formatMedicineListSecondary(product) ? (
              <p className="text-xs font-semibold text-stone-600">{formatMedicineListSecondary(product)}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1">
              {pharmacyMode ? <ExpiryStatusBadge lang={lang} product={product} compact /> : null}
              {low ? (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase text-rose-800">
                  {t(lang, "cardLowStock")}
                </span>
              ) : null}
              {locked ? (
                <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[9px] font-black uppercase text-white">
                  {t(lang, "productLockedBadge")}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="mt-4 space-y-2 rounded-xl bg-stone-50 p-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-sm">
              <dt className="font-semibold text-stone-500">{row.label}</dt>
              <dd className={clsx("font-black tabular-nums text-stone-950", row.valueClass)}>{row.value}</dd>
            </div>
          ))}
        </dl>

        {!locked ? (
          <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
            {canSell ? (
              <button
                type="button"
                onClick={() => closeAnd(onSell)}
                className="min-h-[44px] rounded-xl bg-waka-600 text-sm font-black text-white active:bg-waka-700"
              >
                {pharmacyMode ? pt("stockCardSell") : t(lang, "stockCardSell")}
              </button>
            ) : (
              <span />
            )}
            {canAdd ? (
              <button
                type="button"
                onClick={() => closeAnd(onEdit)}
                className="min-h-[44px] rounded-xl border border-stone-200 text-sm font-black text-stone-800 active:bg-stone-50"
              >
                {t(lang, "stockCardEdit")}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => closeAnd(onMore)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-stone-200 text-sm font-black text-stone-700 active:bg-stone-50"
              aria-label={t(lang, "stockMoreActions")}
            >
              ⋮
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-stone-200 text-sm font-bold text-stone-600 active:bg-stone-50"
        >
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
