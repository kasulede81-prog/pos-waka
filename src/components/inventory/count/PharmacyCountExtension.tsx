import type { Language, Product, BusinessType } from "../../../types";
import { t } from "../../../lib/i18n";
import { computeBatchIntegrity } from "../../../lib/pharmacyBatches";
import { isControlledProduct } from "../../../lib/pharmacyControlledMedicine";
import { shouldTrackBatchesForProduct } from "../../../lib/pharmacyStoreBatch";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { ExpiryStatusBadge } from "../../pharmacy/ExpiryStatusBadge";

type Props = {
  lang: Language;
  product: Product;
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
};

export function PharmacyCountExtension({ lang, product, businessType, pharmacyModeEnabled }: Props) {
  if (!isPharmacyMode(businessType, pharmacyModeEnabled)) return null;

  const batchTracked = shouldTrackBatchesForProduct(businessType, pharmacyModeEnabled, product);
  const integrity = computeBatchIntegrity(product);
  const controlled = isControlledProduct(product);
  const batchCount = product.pharmacyPackaging?.batches?.length ?? 0;
  const hasExpiry = product.expiryDate || batchCount > 0;

  if (!batchTracked && !controlled && !hasExpiry && integrity.ok) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {batchTracked ? (
        <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-teal-900">
          {t(lang, "pharmacyBatchTracked")}
          {batchCount > 0 ? ` · ${batchCount}` : ""}
        </span>
      ) : null}
      {!integrity.ok && integrity.batchTracked ? (
        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-950">
          {t(lang, "pharmacyBatchIntegrityWarning")}
        </span>
      ) : null}
      <ExpiryStatusBadge lang={lang} product={product} compact />
      {controlled ? (
        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-900">
          {t(lang, "pharmacyControlledBadge")}
        </span>
      ) : null}
    </div>
  );
}
