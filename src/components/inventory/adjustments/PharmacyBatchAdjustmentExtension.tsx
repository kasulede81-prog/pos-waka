import type { Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
import { getProductBatches, computeBatchIntegrity } from "../../../lib/pharmacyBatches";
import { isControlledProduct } from "../../../lib/pharmacyControlledMedicine";
import { isProductExpired } from "../../../lib/pharmacyExpiry";
import { ADJUST_FIELD_LABEL, WIZARD_INPUT_TEXT } from "./adjustmentTokens";
import { AdjustmentHeader } from "./AdjustmentHeader";
import { AdjustmentValidationBanner } from "./AdjustmentValidationBanner";

type Props = {
  lang: Language;
  product: Product;
  batchId: string;
  onBatchIdChange: (id: string) => void;
};

export function PharmacyBatchAdjustmentExtension({ lang, product, batchId, onBatchIdChange }: Props) {
  const batches = getProductBatches(product).filter((b) => b.quantityRemaining > 0);
  const selected = batches.find((b) => b.id === batchId);
  const integrity = computeBatchIntegrity(product);
  const controlled = isControlledProduct(product);
  const expired = selected ? isProductExpired({ ...product, expiryDate: selected.expiryDate }) : false;

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
      <AdjustmentHeader title={t(lang, "adjBatchSectionTitle")} />

      {!integrity.ok ? (
        <AdjustmentValidationBanner
          message={t(lang, "pharmacyBatchIntegrityHint")}
          tone="warning"
        />
      ) : null}
      {controlled ? (
        <AdjustmentValidationBanner message={t(lang, "pharmacyControlled")} tone="warning" />
      ) : null}
      {expired ? (
        <AdjustmentValidationBanner message={t(lang, "pharmacyExpiryExpired")} tone="warning" />
      ) : null}

      <label className="block">
        <span className={ADJUST_FIELD_LABEL}>{t(lang, "adjBatchSelect")}</span>
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
    </section>
  );
}
