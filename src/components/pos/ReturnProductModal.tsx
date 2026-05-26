import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Language, Product, ReturnReason, Sale } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { pricePerBaseUnitUgx } from "../../lib/sellingEngine";

const REASONS: ReturnReason[] = ["damaged", "warm_bad", "broken", "wrong_item", "other"];

type Props = {
  lang: Language;
  open: boolean;
  sale: Sale | null;
  products: Product[];
  onClose: () => void;
  onConfirm: (input: {
    saleId: string | null;
    productId: string;
    quantity: number;
    refundAmountUgx: number;
    reason: ReturnReason;
    note: string;
  }) => { ok: boolean; errorKey?: string };
};

export function ReturnProductModal({ lang, open, sale, products, onClose, onConfirm }: Props) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [refund, setRefund] = useState("");
  const [reason, setReason] = useState<ReturnReason>("damaged");
  const [note, setNote] = useState("");

  const lineOptions = sale?.lines.filter((l) => !l.voided) ?? [];
  const pickList = lineOptions.length
    ? lineOptions.map((l) => ({ id: l.productId, name: l.name }))
    : products.map((p) => ({ id: p.id, name: p.name }));

  useEffect(() => {
    if (!open) return;
    setProductId(pickList[0]?.id ?? "");
    setQty("1");
    setRefund("");
    setReason("damaged");
    setNote("");
  }, [open, sale, products]);

  const product = products.find((p) => p.id === productId) ?? null;
  const saleLine = sale?.lines.find((l) => l.productId === productId && !l.voided);
  const qtyN = Math.max(0, Number(qty.replace(/[^\d.]/g, "")) || 0);
  const suggestedRefund =
    saleLine && saleLine.quantity > 0
      ? Math.round((saleLine.lineTotalUgx / saleLine.quantity) * qtyN)
      : product
        ? Math.round(pricePerBaseUnitUgx(product) * qtyN)
        : 0;

  if (!open) return null;

  const handleSubmit = () => {
    if (!productId || qtyN <= 0) return;
    const refundN = Math.floor(Number(refund.replace(/\D/g, "")) || 0) || suggestedRefund;
    const r = onConfirm({
      saleId: sale?.id ?? null,
      productId,
      quantity: qtyN,
      refundAmountUgx: refundN,
      reason,
      note: note.trim(),
    });
    if (r.ok) onClose();
  };

  return (
    <AppModalOverlay className="z-[64] flex items-end justify-center bg-black/55 sm:items-center" role="dialog" aria-modal onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[1.75rem] bg-white p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-black text-slate-900">{t(lang, "returnTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t(lang, "returnHint")}</p>

        <label className="mt-4 block text-sm font-bold text-slate-800">
          {t(lang, "returnProductLabel")}
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-slate-200 px-3 text-base font-bold"
          >
            {pickList.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm font-bold text-slate-800">
          {t(lang, "returnQtyLabel")}
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
            inputMode="decimal"
            className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-2xl font-black"
          />
        </label>

        <label className="mt-3 block text-sm font-bold text-slate-800">
          {t(lang, "returnRefundLabel")}
          <input
            value={refund}
            onChange={(e) => setRefund(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            placeholder={String(suggestedRefund)}
            className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 px-4 text-2xl font-black"
          />
        </label>

        <p className="mt-4 text-sm font-bold text-slate-800">{t(lang, "returnReasonLabel")}</p>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={clsx(
                "min-h-[44px] rounded-2xl border-2 px-3 text-left text-sm font-black",
                reason === r ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-200",
              )}
            >
              {t(lang, `returnReason_${r}`)}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-sm font-bold text-slate-800">
          {t(lang, "voidNoteOptional")}
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-2 min-h-[44px] w-full rounded-xl border-2 px-3" />
        </label>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button type="button" onClick={handleSubmit} className="min-h-[52px] rounded-2xl bg-amber-600 font-black text-white">
            {t(lang, "returnConfirm")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
