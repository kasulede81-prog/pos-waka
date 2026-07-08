import type { Language, Product, BusinessType } from "../../../types";
import { t } from "../../../lib/i18n";
import { computeBatchIntegrity } from "../../../lib/pharmacyBatches";
import { isControlledProduct } from "../../../lib/pharmacyControlledMedicine";
import { shouldTrackBatchesForProduct } from "../../../lib/pharmacyStoreBatch";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { getProductBatches } from "../../../lib/pharmacyBatches";
import { ExpiryStatusBadge } from "../../pharmacy/ExpiryStatusBadge";
import { TransferHeader } from "./TransferHeader";
import { XFER_FIELD_LABEL, WIZARD_INPUT_TEXT } from "./transferTokens";

type Props = {
  lang: Language;
  product: Product;
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
  batchId: string;
  onBatchIdChange: (id: string) => void;
};

export function PharmacyTransferExtension({
  lang,
  product,
  businessType,
  pharmacyModeEnabled,
  batchId,
  onBatchIdChange,
}: Props) {
  if (!isPharmacyMode(businessType, pharmacyModeEnabled)) return null;
  if (!shouldTrackBatchesForProduct(businessType, pharmacyModeEnabled, product)) return null;

  const batches = getProductBatches(product).filter((b) => b.quantityRemaining > 0);
  const integrity = computeBatchIntegrity(product);
  const controlled = isControlledProduct(product);

  return (
    <section className="mt-3 space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
      <TransferHeader title={t(lang, "adjBatchSectionTitle")} />
      {!integrity.ok ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          {t(lang, "pharmacyBatchIntegrityHint")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <ExpiryStatusBadge lang={lang} product={product} compact />
        {controlled ? (
          <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-900">
            {t(lang, "pharmacyControlledBadge")}
          </span>
        ) : null}
      </div>
      {batches.length > 0 ? (
        <label className="block">
          <span className={XFER_FIELD_LABEL}>{t(lang, "adjBatchSelect")}</span>
          <select
            value={batchId}
            onChange={(e) => onBatchIdChange(e.target.value)}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          >
            <option value="">{t(lang, "adjBatchSelectPh")}</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.batchNumber} · {b.expiryDate} · {b.quantityRemaining}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}
