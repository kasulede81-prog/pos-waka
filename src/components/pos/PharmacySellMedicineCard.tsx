import clsx from "clsx";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel } from "../../lib/sellingEngine";
import { formatPharmacyStockPrimary } from "../../lib/pharmacyPackaging";
import { isPharmacyPackagingActive } from "../../lib/pharmacyPackaging";
import {
  formatMedicineDetailSuffix,
  formatMedicineListPrimary,
} from "../../lib/pharmacyMedicine";
import { computeMedicineBatchSummary, medicineDisplayBrand, medicineDisplayGeneric } from "../../lib/pharmacyBatches";
import { ExpiryStatusBadge } from "../pharmacy/ExpiryStatusBadge";
import { POS_CATALOG_TILE_TOUCH_CLASS } from "../../lib/posTouchInteraction";

type Props = {
  lang: Language;
  product: Product;
  onPick: (p: Product) => void;
  locked?: boolean;
  lockedBadge?: string;
  compact?: boolean;
};

/**
 * Phase 32.4.3 — pharmacy sell tile, whole-card selection (no floating +).
 * Hierarchy: Name → Price → Stock; clinical badges remain secondary.
 */
export function PharmacySellMedicineCard({
  lang,
  product: p,
  onPick,
  locked = false,
  lockedBadge,
  compact = false,
}: Props) {
  const master = p.pharmacyMaster;
  const brand = medicineDisplayBrand(p);
  const generic = medicineDisplayGeneric(p);
  const detail = formatMedicineDetailSuffix(p);
  const batchSummary = computeMedicineBatchSummary(p);
  const stockText = isPharmacyPackagingActive(p) ? formatPharmacyStockPrimary(p) : formatStockLabel(p);
  const prescriptionRequired = master?.otcOrPrescription === "prescription";
  const controlled = Boolean(master?.controlledDrug);
  const lowStock = p.stockOnHand <= p.minimumStockAlert;
  const title = brand || formatMedicineListPrimary(p);

  return (
    <button
      type="button"
      onClick={() => onPick(p)}
      disabled={locked}
      aria-label={`${t(lang, "add")}: ${title}`}
      className={clsx(
        "pos-ds-product-card pos-sell-direct-card relative flex w-full cursor-pointer flex-col rounded-xl border p-2.5 text-left shadow-sm",
        "transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out motion-reduce:transition-none",
        POS_CATALOG_TILE_TOUCH_CLASS,
        compact ? "min-h-[132px]" : "min-h-[148px]",
        locked
          ? "cursor-not-allowed border-border/80 bg-muted/90 opacity-55"
          : [
              "border-border/90 bg-card",
              "hover:border-teal-300/80 hover:shadow-md",
              "active:scale-[0.985] active:border-teal-500 active:bg-teal-50/90 active:shadow-sm",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500",
              "motion-reduce:active:scale-100",
            ],
      )}
      style={{ contentVisibility: "auto" }}
    >
      {locked && lockedBadge ? (
        <span className="absolute right-1.5 top-1.5 z-[1] rounded-full bg-foreground/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-background">
          {lockedBadge}
        </span>
      ) : null}

      <div className={clsx("flex min-h-0 min-w-0 flex-1 flex-col justify-center", locked ? "pr-7" : undefined)}>
        <p className="pos-ds-product-name line-clamp-3 text-sm font-black leading-snug text-foreground">
          {title}
        </p>
        <p className="pos-ds-product-price mt-1.5 text-xs font-black tabular-nums text-waka-800">
          {formatProductPriceLabel(p)}
        </p>
        {generic ? (
          <span className="mt-0.5 block truncate text-[11px] font-semibold text-muted-foreground">{generic}</span>
        ) : null}
        {detail ? (
          <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">{detail}</span>
        ) : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          <ExpiryStatusBadge lang={lang} product={p} compact />
          {controlled ? (
            <span className="rounded-full bg-trial-muted px-1.5 py-0.5 text-[8px] font-black uppercase text-trial">
              {t(lang, "pharmacyControlledBadge")}
            </span>
          ) : null}
          {prescriptionRequired ? (
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-sky-900">
              {t(lang, "pharmacyRxRequiredBadge")}
            </span>
          ) : null}
        </span>
        <span
          className={clsx(
            "pos-ds-product-stock mt-1.5 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold",
            lowStock ? "bg-danger-muted text-danger" : "bg-success-muted text-success",
          )}
        >
          {t(lang, "pharmacySellStock")}: {stockText}
        </span>
        {batchSummary ? (
          <span className="mt-0.5 block truncate text-[10px] font-semibold text-teal-800">
            {batchSummary.activeBatchCount > 0
              ? t(lang, "pharmacySellFefoBatches").replace("{count}", String(batchSummary.activeBatchCount))
              : t(lang, "pharmacySellNoBatches")}
            {batchSummary.nearestExpiry
              ? ` · ${t(lang, "pharmacySellEarliestExpiry")} ${batchSummary.nearestExpiry}`
              : null}
          </span>
        ) : null}
      </div>
    </button>
  );
}
