import { useState } from "react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatMedicineFullLabel } from "../../lib/pharmacyMedicine";
import { isProductExpired } from "../../lib/pharmacyExpiry";
import { usePosStore } from "../../store/usePosStore";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  products: Product[];
  canWriteOff: boolean;
};

export function PharmacyExpiredWriteOffPanel({ lang, products, canWriteOff }: Props) {
  const writeOffExpiredStock = usePosStore((s) => s.writeOffExpiredStock);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const expiredWithStock = products.filter((p) => p.stockOnHand > 0 && isProductExpired(p));

  if (!canWriteOff || expiredWithStock.length === 0) return null;

  const confirmProduct = confirmId ? products.find((p) => p.id === confirmId) : null;

  const runWriteOff = (productId: string) => {
    const r = writeOffExpiredStock({ productId });
    setConfirmId(null);
    if (r.ok) {
      setToast(
        tTemplate(lang, "pharmacyWriteOffDone", {
          loss: String(r.lossValueUgx ?? 0),
        }),
      );
      window.setTimeout(() => setToast(null), 3200);
    } else {
      setToast(t(lang, r.errorKey ?? "invalid"));
      window.setTimeout(() => setToast(null), 2800);
    }
  };

  return (
    <section className="rounded-3xl border-2 border-red-200 bg-red-50/80 p-4 shadow-sm">
      <h2 className="text-lg font-black text-red-950">{t(lang, "pharmacyWriteOffTitle")}</h2>
      <p className="mt-1 text-sm font-medium text-red-900/90">{t(lang, "pharmacyWriteOffSub")}</p>
      {toast ? (
        <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm font-bold text-stone-900">{toast}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {expiredWithStock.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-100 bg-white px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-stone-900">{formatMedicineFullLabel(p)}</p>
              <p className="text-xs font-semibold text-stone-600">
                {p.stockOnHand} {p.baseUnit} · {p.expiryDate}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmId(p.id)}
              className="min-h-[44px] shrink-0 rounded-2xl bg-red-700 px-4 text-sm font-black text-white"
            >
              {t(lang, "pharmacyWriteOffCta")}
            </button>
          </li>
        ))}
      </ul>

      {confirmProduct ? (
        <AppModalOverlay className="z-[62] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal>
          <div className="max-w-sm rounded-3xl bg-white p-6 shadow-xl">
            <p className="text-lg font-black text-stone-950">{t(lang, "pharmacyWriteOffConfirmTitle")}</p>
            <p className="mt-2 text-sm font-semibold text-stone-700">
              {tTemplate(lang, "pharmacyWriteOffConfirmBody", {
                name: formatMedicineFullLabel(confirmProduct),
                qty: String(confirmProduct.stockOnHand),
                unit: confirmProduct.baseUnit,
                loss: String(
                  Math.round(confirmProduct.stockOnHand * Math.max(0, confirmProduct.costPricePerUnitUgx)),
                ),
              })}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-2xl border-2 py-3 font-bold text-stone-800"
                onClick={() => setConfirmId(null)}
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-2xl bg-red-700 py-3 font-black text-white"
                onClick={() => runWriteOff(confirmProduct.id)}
              >
                {t(lang, "pharmacyWriteOffCta")}
              </button>
            </div>
          </div>
        </AppModalOverlay>
      ) : null}
    </section>
  );
}
