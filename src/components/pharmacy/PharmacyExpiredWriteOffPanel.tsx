import { useState } from "react";
import type { Language, Product } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatMedicineFullLabel } from "../../lib/pharmacyMedicine";
import { isProductExpired } from "../../lib/pharmacyExpiry";
import { usePosStore } from "../../store/usePosStore";
import { AdjustmentConfirmDialog } from "../inventory/adjustments/AdjustmentConfirmDialog";
import { AdjustmentMovementPreview } from "../inventory/adjustments/AdjustmentMovementPreview";

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
        <p className="mt-3 rounded-xl bg-card px-3 py-2 text-sm font-bold text-foreground">{toast}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {expiredWithStock.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-100 bg-card px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-foreground">{formatMedicineFullLabel(p)}</p>
              <p className="text-xs font-semibold text-muted-foreground">
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
        <AdjustmentConfirmDialog
          lang={lang}
          open
          danger
          title={t(lang, "pharmacyWriteOffConfirmTitle")}
          confirmLabelKey="pharmacyWriteOffCta"
          onCancel={() => setConfirmId(null)}
          onConfirm={() => runWriteOff(confirmProduct.id)}
          body={
            <p>
              {tTemplate(lang, "pharmacyWriteOffConfirmBody", {
                name: formatMedicineFullLabel(confirmProduct),
                qty: String(confirmProduct.stockOnHand),
                unit: confirmProduct.baseUnit,
                loss: String(
                  Math.round(confirmProduct.stockOnHand * Math.max(0, confirmProduct.costPricePerUnitUgx)),
                ),
              })}
            </p>
          }
        >
          <div className="mt-4">
            <AdjustmentMovementPreview
              lang={lang}
              currentStock={confirmProduct.stockOnHand}
              adjustment={-confirmProduct.stockOnHand}
              unitLabel={confirmProduct.baseUnit}
            />
          </div>
        </AdjustmentConfirmDialog>
      ) : null}
    </section>
  );
}
