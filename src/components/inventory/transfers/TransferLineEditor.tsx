import { Trash2 } from "lucide-react";
import type { Language, Product, BusinessType } from "../../../types";
import { t } from "../../../lib/i18n";
import { validateTransferLinePresentation } from "../../../lib/transferWorkspace";
import { getProductBatches } from "../../../lib/pharmacyBatches";
import { shouldTrackBatchesForProduct } from "../../../lib/pharmacyStoreBatch";
import { TransferMovementPreview } from "./TransferMovementPreview";
import { PharmacyTransferExtension } from "./PharmacyTransferExtension";
import { XFER_FIELD_LABEL, WIZARD_INPUT_NUMERIC } from "./transferTokens";

type Props = {
  lang: Language;
  product: Product;
  businessType: BusinessType;
  pharmacyModeEnabled?: boolean;
  quantity: string;
  batchId: string;
  onQuantityChange: (value: string) => void;
  onBatchIdChange: (value: string) => void;
  onRemove: () => void;
};

export function TransferLineEditor({
  lang,
  product,
  businessType,
  pharmacyModeEnabled,
  quantity,
  batchId,
  onQuantityChange,
  onBatchIdChange,
  onRemove,
}: Props) {
  const qtyN = Math.max(0, Math.floor(Number(quantity) || 0));
  const batchTracked = shouldTrackBatchesForProduct(businessType, pharmacyModeEnabled, product);
  const selectedBatch = batchTracked
    ? getProductBatches(product).find((b) => b.id === batchId)
    : undefined;
  const validation = validateTransferLinePresentation(
    product,
    qtyN,
    selectedBatch?.quantityRemaining,
  );
  const shelf = product.category?.trim() || "—";
  const sku = product.sku?.trim() || "—";

  return (
    <li className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-black text-foreground">{product.name}</p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {t(lang, "cntSku")}: {sku} · {t(lang, "cntShelf")}: {shelf}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {t(lang, "xferCurrentStock")}: {product.stockOnHand} {product.baseUnit}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-rose-700"
          aria-label={t(lang, "remove")}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <PharmacyTransferExtension
        lang={lang}
        product={product}
        businessType={businessType}
        pharmacyModeEnabled={pharmacyModeEnabled}
        batchId={batchId}
        onBatchIdChange={onBatchIdChange}
      />

      <label className="mt-3 block">
        <span className={XFER_FIELD_LABEL}>{t(lang, "xferQuantityLabel")}</span>
        <input
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => onQuantityChange(e.target.value)}
          className={`${WIZARD_INPUT_NUMERIC} mt-2`}
        />
      </label>

      {!validation.ok && qtyN > 0 ? (
        <p className="mt-2 text-xs font-semibold text-rose-700">{t(lang, validation.errorKey ?? "invalid")}</p>
      ) : null}
      {validation.warningKey && qtyN > 0 ? (
        <p className="mt-2 text-xs font-semibold text-amber-800">{t(lang, validation.warningKey)}</p>
      ) : null}

      {qtyN > 0 && validation.ok ? (
        <div className="mt-3">
          <TransferMovementPreview
            lang={lang}
            currentStock={product.stockOnHand}
            transferQty={qtyN}
            unitLabel={product.baseUnit}
          />
        </div>
      ) : null}
    </li>
  );
}
