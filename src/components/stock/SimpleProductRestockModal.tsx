import { useEffect, useState, type FormEvent } from "react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { packLabelFromProduct, stockBreakdown } from "../../lib/sellingEngine";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../../lib/walkInSupplier";

type Props = {
  lang: Language;
  open: boolean;
  product: Product | null;
  suppliers: { id: string; name: string }[];
  onClose: () => void;
  onSave: (input: {
    productId: string;
    packQty: number;
    costPerPackUgx: number;
    supplierId: string;
    supplierName: string;
  }) => { ok: boolean };
};

export function SimpleProductRestockModal({ lang, open, product, suppliers, onClose, onSave }: Props) {
  const [packQty, setPackQty] = useState("1");
  const [packPrice, setPackPrice] = useState("");
  const [supplierId, setSupplierId] = useState(WALK_IN_SUPPLIER_ID);

  const b = product ? stockBreakdown(product) : null;
  const packName = product ? packLabelFromProduct(product) ?? t(lang, "packKind_pack") : "";

  useEffect(() => {
    if (!open) return;
    setPackQty("1");
    setPackPrice("");
    setSupplierId(WALK_IN_SUPPLIER_ID);
  }, [open, product?.id]);

  if (!open || !product) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const qty = Math.max(0, Number(packQty.replace(/[^\d.]/g, "")) || 0);
    const cost = Math.floor(Number(packPrice.replace(/\D/g, "")) || 0);
    if (qty <= 0 || cost <= 0) return;
    const walkIn = isWalkInSupplierId(supplierId);
    const supplierName = walkIn ? t(lang, "restockTownBuy") : suppliers.find((s) => s.id === supplierId)?.name ?? "";
    const r = onSave({
      productId: product.id,
      packQty: qty,
      costPerPackUgx: cost,
      supplierId: walkIn ? WALK_IN_SUPPLIER_ID : supplierId,
      supplierName,
    });
    if (r.ok) onClose();
  };

  const piecesPerPack = product.conversionRate && product.conversionRate > 1 ? product.conversionRate : 1;
  const qtyN = Math.max(0, Number(packQty.replace(/[^\d.]/g, "")) || 0);
  const addsPieces = b?.hasPackTracking ? qtyN * piecesPerPack : qtyN;

  return (
    <AppModalOverlay className="z-[60] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal onClick={onClose}>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-t-[1.75rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-slate-900">
          {tTemplate(lang, "stockRestockProductTitle", { name: product.name })}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t(lang, "stockRestockProductHint")}</p>

        <label className="mt-4 block text-sm font-bold text-slate-800">
          {tTemplate(lang, "stockRestockPackQty", { pack: packName })}
          <input
            value={packQty}
            onChange={(e) => setPackQty(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
            inputMode="decimal"
            className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-2xl font-black"
          />
        </label>

        {addsPieces > 0 ? (
          <p className="mt-2 text-sm font-bold text-waka-800">
            {tTemplate(lang, "stockRestockAdds", { count: String(addsPieces), unit: product.baseUnit })}
          </p>
        ) : null}

        <label className="mt-4 block text-sm font-bold text-slate-800">
          {tTemplate(lang, "stockRestockPackPrice", { pack: packName })}
          <input
            value={packPrice}
            onChange={(e) => setPackPrice(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            placeholder="36000"
            className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-2xl font-black"
          />
        </label>

        <label className="mt-4 block text-sm font-bold text-slate-800">
          {t(lang, "restockSupplier")}
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 bg-white px-3 text-base font-bold"
          >
            <option value={WALK_IN_SUPPLIER_ID}>{t(lang, "restockTownBuy")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button type="submit" className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white">
            {t(lang, "stockRestockSave")}
          </button>
        </div>
      </form>
    </AppModalOverlay>
  );
}
