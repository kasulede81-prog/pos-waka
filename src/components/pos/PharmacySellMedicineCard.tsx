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

type Props = {
  lang: Language;
  product: Product;
  onPick: (p: Product) => void;
  locked?: boolean;
  lockedBadge?: string;
  compact?: boolean;
};

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

  return (
    <button
      type="button"
      onClick={() => onPick(p)}
      disabled={locked}
      className={clsx(
        "relative flex w-full flex-col justify-between rounded-2xl border p-3 text-left shadow-sm transition-waka touch-manipulation",
        compact ? "min-h-[148px]" : "min-h-[168px]",
        locked
          ? "border-border/80 bg-muted/90 opacity-55"
          : "border-border bg-card hover:border-teal-300 hover:shadow-md active:scale-[0.98] motion-reduce:active:scale-100",
      )}
      style={{ contentVisibility: "auto" }}
    >
      {locked && lockedBadge ? (
        <span className="absolute right-2 top-2 rounded-full bg-foreground/90 px-1.5 py-0.5 text-[9px] font-black uppercase text-background">
          {lockedBadge}
        </span>
      ) : null}
      <span className="min-w-0 pr-1">
        <span className="line-clamp-2 text-base font-black leading-tight text-foreground">
          {brand || formatMedicineListPrimary(p)}
        </span>
        {generic ? (
          <span className="mt-0.5 block truncate text-[11px] font-semibold text-muted-foreground">{generic}</span>
        ) : null}
        {detail ? (
          <span className="mt-0.5 block truncate text-[11px] font-bold text-muted-foreground">{detail}</span>
        ) : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          <ExpiryStatusBadge lang={lang} product={p} compact />
          {controlled ? (
            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-violet-900">
              {t(lang, "pharmacyControlledBadge")}
            </span>
          ) : null}
          {prescriptionRequired ? (
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[8px] font-black uppercase text-sky-900">
              {t(lang, "pharmacyRxRequiredBadge")}
            </span>
          ) : null}
        </span>
        <span className="mt-1.5 block text-[11px] font-bold text-muted-foreground">
          {t(lang, "pharmacySellStock")}: {stockText}
        </span>
        {batchSummary ? (
          <span className="mt-0.5 block text-[10px] font-semibold text-teal-800">
            {batchSummary.activeBatchCount > 0
              ? t(lang, "pharmacySellFefoBatches").replace("{count}", String(batchSummary.activeBatchCount))
              : t(lang, "pharmacySellNoBatches")}
            {batchSummary.nearestExpiry
              ? ` · ${t(lang, "pharmacySellEarliestExpiry")} ${batchSummary.nearestExpiry}`
              : null}
          </span>
        ) : null}
      </span>
      <span className="mt-2 text-sm font-black text-waka-700">{formatProductPriceLabel(p)}</span>
    </button>
  );
}
