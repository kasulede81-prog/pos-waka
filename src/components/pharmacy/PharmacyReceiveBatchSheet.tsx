import { useState, type FormEvent } from "react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { usePosStore } from "../../store/usePosStore";
import { formatMedicineFullLabel } from "../../lib/pharmacyMedicine";
import { WALK_IN_SUPPLIER_ID } from "../../lib/walkInSupplier";

type Props = {
  lang: Language;
  product: Product;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
};

export function PharmacyReceiveBatchSheet({ lang, product, open, onClose, onDone }: Props) {
  const recordPurchase = usePosStore((s) => s.recordPurchase);
  const suppliers = usePosStore((s) => s.suppliers);
  const [supplierId, setSupplierId] = useState(WALK_IN_SUPPLIER_ID);
  const [invoice, setInvoice] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(String(product.costPricePerUnitUgx || ""));
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const qty = Math.floor(Number(quantity));
    const cost = Math.round(Number(unitCost));
    if (!batchNumber.trim()) {
      setError(t(lang, "pharmacyBatchNumberRequired"));
      return;
    }
    if (!expiryDate) {
      setError(t(lang, "pharmacyExpiryDateRequired"));
      return;
    }
    if (qty <= 0 || cost < 0) {
      setError(t(lang, "invalidQty"));
      return;
    }
    setBusy(true);
    const r = recordPurchase({
      supplierId,
      lines: [
        {
          productId: product.id,
          baseUnitsIn: qty,
          costPerBaseUnitUgx: cost,
          batchReceive: {
            batchNumber: batchNumber.trim(),
            expiryDate,
            quantityBase: qty,
            unitCostUgx: cost,
            manufactureDate: manufactureDate || null,
            purchaseInvoice: invoice.trim() || null,
            location: location.trim() || null,
          },
        },
      ],
      amountPaidUgx: qty * cost,
      notes: invoice.trim() ? `Invoice ${invoice.trim()}` : "",
    });
    setBusy(false);
    if (!r.ok) {
      setError(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    onDone?.();
    onClose();
  };

  return (
    <AppModalOverlay className="z-[75] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <form
        onSubmit={submit}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6"
      >
        <h2 className="text-xl font-black text-stone-950">{t(lang, "pharmacyReceiveTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-stone-600">{formatMedicineFullLabel(product)}</p>

        <label className="mt-4 block text-sm font-bold text-stone-700">
          {t(lang, "suppliersTitle")}
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base"
          >
            <option value={WALK_IN_SUPPLIER_ID}>Town / market</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm font-bold text-stone-700">
          {t(lang, "pharmacyPurchaseInvoice")}
          <input
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base"
          />
        </label>

        <label className="mt-3 block text-sm font-bold text-stone-700">
          {t(lang, "pharmacyBatchNumber")} *
          <input
            required
            value={batchNumber}
            onChange={(e) => setBatchNumber(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-bold"
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "pharmacyExpiryDateLabel")} *
            <input
              type="date"
              required
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-3 py-3 text-base"
            />
          </label>
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "pharmacyManufactureDate")}
            <input
              type="date"
              value={manufactureDate}
              onChange={(e) => setManufactureDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-3 py-3 text-base"
            />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "stockLabel")} *
            <input
              inputMode="numeric"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-xl font-black"
            />
          </label>
          <label className="block text-sm font-bold text-stone-700">
            {t(lang, "pharmacyEditBuyPriceLabel")} *
            <input
              inputMode="numeric"
              required
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base font-bold"
            />
          </label>
        </div>

        <label className="mt-3 block text-sm font-bold text-stone-700">
          {t(lang, "pharmacyBatchLocation")}
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t(lang, "pharmacyBatchLocationHint")}
            className="mt-1 w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-base"
          />
        </label>

        {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-[52px] rounded-2xl bg-teal-600 text-base font-black text-white disabled:opacity-60"
          >
            {t(lang, "pharmacyReceiveCta")}
          </button>
        </div>
      </form>
    </AppModalOverlay>
  );
}
