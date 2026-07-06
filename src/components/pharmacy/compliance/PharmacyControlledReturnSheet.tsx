import { useMemo, useState } from "react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { usePosStore } from "../../../store/usePosStore";
import { isControlledProduct } from "../../../lib/pharmacyControlledMedicine";
import { formatMedicineFullLabel } from "../../../lib/pharmacyMedicine";

type Disposition = "return_to_stock" | "destroy" | "supplier_recall" | "regulatory_disposal";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

export function PharmacyControlledReturnSheet({ lang, open, onClose, onDone }: Props) {
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

  if (!open) return null;

  const submit = () => {
    if (!productId) {
      setError(t(lang, "pharmacyComplianceReturnProductRequired"));
      return;
    }
    const qty = Math.max(1, Math.floor(Number(quantity) || 0));
    if (!reason.trim()) {
      setError(t(lang, "pharmacyRxControlledReasonRequired"));
      return;
    }
    setBusy(true);
    const storeDisposition =
      disposition === "destroy" || disposition === "regulatory_disposal" ? "destroy" : "return";
    const fullReason = `${disposition}: ${reason.trim()}`;
    const r = recordControlledReturn({
      disposition: storeDisposition,
      productId,
      quantity: qty,
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
    <AppModalOverlay className="z-[78] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
        <h2 className="text-xl font-black text-stone-950">{t(lang, "pharmacyComplianceReturnTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-stone-500">{t(lang, "pharmacyComplianceReturnSub")}</p>

        <label className="mt-4 block text-sm font-bold text-stone-800">
          {t(lang, "pharmacyTerm_medicines")}
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-bold"
          >
            <option value="">{t(lang, "pharmacyComplianceReturnSelect")}</option>
            {controlledProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {formatMedicineFullLabel(p)}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm font-bold text-stone-800">
          {t(lang, "pharmacyComplianceQty")}
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-base font-bold"
          />
        </label>

        <p className="mt-4 text-sm font-bold text-stone-800">{t(lang, "pharmacyComplianceReturnDisposition")}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {dispositions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDisposition(d.id)}
              className={`min-h-[52px] rounded-2xl border-2 px-3 text-sm font-black touch-manipulation ${
                disposition === d.id ? "border-violet-500 bg-violet-600 text-white" : "border-stone-200 bg-white"
              }`}
            >
              {t(lang, d.labelKey)}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-sm font-bold text-stone-800">
          {t(lang, "pharmacyRxControlledReason")}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="mt-1 min-h-[80px] w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base"
          />
        </label>

        <label className="mt-3 block text-sm font-bold text-stone-800">
          {t(lang, "pharmacyRxManagerPin")}
          <input
            type="password"
            inputMode="numeric"
            value={managerPin}
            onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-violet-200 px-4 font-mono text-base"
          />
        </label>

        {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-[56px] rounded-2xl border-2 font-black">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="min-h-[56px] rounded-2xl bg-violet-700 font-black text-white touch-manipulation disabled:opacity-50"
          >
            {t(lang, "pharmacyComplianceReturnSubmit")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
