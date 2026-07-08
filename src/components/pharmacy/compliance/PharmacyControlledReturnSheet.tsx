import { useMemo, useState } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { isControlledProduct } from "../../../lib/pharmacyControlledMedicine";
import { formatMedicineFullLabel } from "../../../lib/pharmacyMedicine";
import { StockAdjustmentShell } from "../../inventory/adjustments/StockAdjustmentShell";
import { AdjustmentQuantityEditor } from "../../inventory/adjustments/AdjustmentQuantityEditor";
import { AdjustmentMovementPreview } from "../../inventory/adjustments/AdjustmentMovementPreview";
import { AdjustmentSummaryPanel } from "../../inventory/adjustments/AdjustmentSummaryPanel";
import { AdjustmentFooter } from "../../inventory/adjustments/AdjustmentFooter";
import { AdjustmentStatusStrip } from "../../inventory/adjustments/AdjustmentStatusStrip";
import { wizardChoiceButtonClass } from "../../inventory/adjustments/adjustmentTokens";
import clsx from "clsx";
import { dateKeyKampala } from "../../../lib/datesUg";
import { useSessionActor } from "../../../context/SessionActorContext";

type Disposition = "return_to_stock" | "destroy" | "supplier_recall" | "regulatory_disposal";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

export function PharmacyControlledReturnSheet({ lang, open, onClose, onDone }: Props) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const recordControlledReturn = usePosStore((s) => s.recordControlledReturn);

  const controlledProducts = useMemo(
    () => products.filter((p) => isControlledProduct(p)).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [disposition, setDisposition] = useState<Disposition>("return_to_stock");
  const [reason, setReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const product = products.find((p) => p.id === productId);
  const qtyN = Math.max(1, Math.floor(Number(quantity) || 0));
  const storeDisposition = disposition === "destroy" || disposition === "regulatory_disposal" ? "destroy" : "return";
  const delta = storeDisposition === "return" ? qtyN : -qtyN;

  const submit = () => {
    if (!productId) {
      setError(t(lang, "pharmacyComplianceReturnProductRequired"));
      return;
    }
    if (!reason.trim()) {
      setError(t(lang, "pharmacyRxControlledReasonRequired"));
      return;
    }
    setBusy(true);
    const fullReason = `${disposition}: ${reason.trim()}`;
    const r = recordControlledReturn({
      disposition: storeDisposition,
      productId,
      quantity: qtyN,
      reason: fullReason,
      managerPin,
    });
    setBusy(false);
    if (!r.ok) {
      setError(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    setProductId("");
    setQuantity("1");
    setReason("");
    setManagerPin("");
    setError(null);
    onDone?.();
    onClose();
  };

  const dispositions: { id: Disposition; labelKey: string }[] = [
    { id: "return_to_stock", labelKey: "pharmacyComplianceReturnStock" },
    { id: "destroy", labelKey: "pharmacyComplianceReturnDestroy" },
    { id: "supplier_recall", labelKey: "pharmacyComplianceReturnRecall" },
    { id: "regulatory_disposal", labelKey: "pharmacyComplianceReturnDisposal" },
  ];

  return (
    <StockAdjustmentShell
      lang={lang}
      open={open}
      title={t(lang, "pharmacyComplianceReturnTitle")}
      subtitle={t(lang, "pharmacyComplianceReturnSub")}
      error={error}
      onRequestClose={onClose}
      zClassName="z-[78]"
      statusStrip={<AdjustmentStatusStrip lang={lang} />}
      footer={
        <AdjustmentFooter
          lang={lang}
          onCancel={onClose}
          primaryLabelKey="pharmacyComplianceReturnSubmit"
          primaryType="button"
          onPrimary={submit}
          primaryBusy={busy}
          primaryClassName="bg-violet-700 text-white hover:bg-violet-800"
        />
      }
    >
      <label className="block">
        <span className="text-sm font-bold text-foreground">{t(lang, "pharmacyTerm_medicines")}</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="mt-2 min-h-[52px] w-full rounded-2xl border border-input bg-card px-4 text-base font-bold"
        >
          <option value="">{t(lang, "pharmacyComplianceReturnSelect")}</option>
          {controlledProducts.map((p) => (
            <option key={p.id} value={p.id}>
              {formatMedicineFullLabel(p)}
            </option>
          ))}
        </select>
      </label>

      <AdjustmentQuantityEditor lang={lang} quantity={quantity} onQuantityChange={setQuantity} />

      <section className="space-y-2">
        <p className="text-sm font-bold text-foreground">{t(lang, "pharmacyComplianceReturnDisposition")}</p>
        <div className="grid grid-cols-2 gap-2">
          {dispositions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDisposition(d.id)}
              className={clsx(wizardChoiceButtonClass(disposition === d.id), "min-h-[52px] text-sm")}
            >
              {t(lang, d.labelKey)}
            </button>
          ))}
        </div>
      </section>

      <label className="block">
        <span className="text-sm font-bold text-foreground">{t(lang, "pharmacyRxControlledReason")}</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-2 min-h-[80px] w-full rounded-2xl border border-input bg-card px-4 py-3 text-base"
        />
      </label>

      <label className="block">
        <span className="text-sm font-bold text-foreground">{t(lang, "pharmacyRxManagerPin")}</span>
        <input
          type="password"
          inputMode="numeric"
          value={managerPin}
          onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          className="mt-2 min-h-[52px] w-full rounded-2xl border border-violet-200 bg-card px-4 font-mono text-base"
        />
      </label>

      {product && qtyN > 0 ? (
        <>
          <AdjustmentMovementPreview
            lang={lang}
            currentStock={product.stockOnHand}
            adjustment={delta}
            unitLabel={product.baseUnit}
          />
          <AdjustmentSummaryPanel
            lang={lang}
            productName={product.name}
            reasonLabel={t(lang, "adjReasonControlledReturn")}
            quantity={qtyN}
            currentStock={product.stockOnHand}
            newStock={product.stockOnHand + delta}
            operatorName={actor.displayName ?? actor.userId}
            businessDate={dateKeyKampala(new Date())}
          />
        </>
      ) : null}
    </StockAdjustmentShell>
  );
}
