import { useEffect, useMemo, useState } from "react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { dateKeyKampala } from "../../lib/datesUg";
import { formatMedicineFullLabel } from "../../lib/pharmacyMedicine";
import { getProductBatches } from "../../lib/pharmacyBatches";
import { StockAdjustmentShell } from "../inventory/adjustments/StockAdjustmentShell";
import { PharmacyBatchAdjustmentExtension } from "../inventory/adjustments/PharmacyBatchAdjustmentExtension";
import { AdjustmentQuantityEditor } from "../inventory/adjustments/AdjustmentQuantityEditor";
import { AdjustmentMovementPreview } from "../inventory/adjustments/AdjustmentMovementPreview";
import { AdjustmentSummaryPanel } from "../inventory/adjustments/AdjustmentSummaryPanel";
import { AdjustmentFooter } from "../inventory/adjustments/AdjustmentFooter";
import { AdjustmentStatusStrip } from "../inventory/adjustments/AdjustmentStatusStrip";

export type PharmacyBatchAdjustmentKind = "writeoff" | "supplier_return";

type Props = {
  lang: Language;
  open: boolean;
  product: Product;
  kind: PharmacyBatchAdjustmentKind;
  onClose: () => void;
  onDone?: () => void;
};

export function PharmacyBatchAdjustmentSheet({ lang, open, product, kind, onClose, onDone }: Props) {
  const actor = useSessionActor();
  const writeOffExpiredStock = usePosStore((s) => s.writeOffExpiredStock);
  const pharmacySupplierReturn = usePosStore((s) => s.pharmacySupplierReturn);

  const batches = useMemo(
    () => getProductBatches(product).filter((b) => b.quantityRemaining > 0),
    [product],
  );

  const [batchId, setBatchId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedBatch = batches.find((b) => b.id === batchId);
  const qtyN = Math.max(0, Math.floor(Number(quantity) || 0));
  const maxQty = selectedBatch?.quantityRemaining ?? 0;
  const delta = qtyN > 0 ? -qtyN : 0;
  const inventoryValueUgx = Math.round(product.stockOnHand * Math.max(0, product.costPricePerUnitUgx));

  useEffect(() => {
    if (!open) return;
    const first = batches[0]?.id ?? "";
    setBatchId(first);
    setQuantity(first ? "1" : "");
    setError(null);
  }, [open, product.id, batches]);

  const submit = () => {
    if (!batchId) {
      setError(t(lang, "adjBatchRequired"));
      return;
    }
    if (qtyN <= 0) {
      setError(t(lang, "invalidQty"));
      return;
    }
    if (qtyN > maxQty) {
      setError(t(lang, "invalidQty"));
      return;
    }

    setBusy(true);
    const r =
      kind === "writeoff"
        ? writeOffExpiredStock({ productId: product.id, batchId, quantity: qtyN, reason: "expired" })
        : pharmacySupplierReturn({ productId: product.id, batchId, quantity: qtyN, reason: "near_expiry_return" });
    setBusy(false);

    if (!r.ok) {
      setError(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    onDone?.();
    onClose();
  };

  const title = kind === "writeoff" ? t(lang, "pharmacyWriteOffTitle") : t(lang, "adjConfirmSupplierReturnTitle");
  const reasonLabel =
    kind === "writeoff" ? t(lang, "adjReasonExpired") : t(lang, "adjReasonSupplierReturn");
  const primaryLabelKey = kind === "writeoff" ? "pharmacyWriteOffCta" : "pharmacyReturnSupplier";

  return (
    <StockAdjustmentShell
      lang={lang}
      open={open}
      title={title}
      subtitle={formatMedicineFullLabel(product)}
      error={error}
      onRequestClose={onClose}
      zClassName="z-[76]"
      statusStrip={<AdjustmentStatusStrip lang={lang} />}
      footer={
        <AdjustmentFooter
          lang={lang}
          onCancel={onClose}
          primaryLabelKey={primaryLabelKey}
          primaryType="button"
          onPrimary={submit}
          primaryDisabled={!batchId || qtyN <= 0 || qtyN > maxQty}
          primaryBusy={busy}
          primaryClassName={kind === "writeoff" ? "bg-rose-700 text-white hover:bg-rose-800" : undefined}
        />
      }
    >
      <PharmacyBatchAdjustmentExtension
        lang={lang}
        product={product}
        batchId={batchId}
        onBatchIdChange={setBatchId}
      />

      <AdjustmentQuantityEditor
        lang={lang}
        quantity={quantity}
        onQuantityChange={setQuantity}
        unitLabel={product.baseUnit}
      />

      {selectedBatch && qtyN > 0 ? (
        <>
          <AdjustmentMovementPreview
            lang={lang}
            mode="return"
            currentStock={product.stockOnHand}
            adjustment={delta}
            unitLabel={product.baseUnit}
          />
          <AdjustmentSummaryPanel
            lang={lang}
            productName={product.name}
            reasonLabel={reasonLabel}
            quantity={qtyN}
            currentStock={product.stockOnHand}
            newStock={product.stockOnHand + delta}
            inventoryValueUgx={inventoryValueUgx}
            operatorName={actor.displayName ?? actor.userId}
            businessDate={dateKeyKampala(new Date())}
          />
        </>
      ) : null}
    </StockAdjustmentShell>
  );
}
