import { useMemo, useState } from "react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { computeBatchIntegrity } from "../../lib/pharmacyBatches";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { Link } from "react-router-dom";

type Props = {
  lang: Language;
  product: Product;
};

export function PharmacyBatchIntegrityBanner({ lang, product }: Props) {
  const integrity = useMemo(() => computeBatchIntegrity(product), [product]);
  const [showDiff, setShowDiff] = useState(false);

  if (integrity.ok || !integrity.batchTracked || integrity.batches.length === 0) return null;

  return (
    <>
      <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
        <p className="text-sm font-black text-amber-950">{t(lang, "pharmacyBatchIntegrityWarning")}</p>
        <p className="mt-1 text-xs font-semibold text-amber-900">
          {t(lang, "pharmacyBatchIntegrityMismatch")}: {integrity.stockOnHand} vs {integrity.batchSum} (
          {integrity.delta > 0 ? "+" : ""}
          {integrity.delta})
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => computeBatchIntegrity(product)}
            className="min-h-[44px] rounded-xl border border-amber-300 bg-white px-4 text-sm font-black text-amber-950 touch-manipulation"
          >
            {t(lang, "pharmacyBatchRecalculate")}
          </button>
          <button
            type="button"
            onClick={() => setShowDiff(true)}
            className="min-h-[44px] rounded-xl border border-amber-300 bg-white px-4 text-sm font-black text-amber-950 touch-manipulation"
          >
            {t(lang, "pharmacyBatchViewDiff")}
          </button>
          <Link
            to={`/settings/diagnostics?auditProduct=${product.id}`}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-amber-300 bg-white px-4 text-sm font-black text-amber-950 touch-manipulation"
          >
            {t(lang, "pharmacyBatchViewAudit")}
          </Link>
        </div>
      </div>

      {showDiff ? (
        <AppModalOverlay className="z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6">
            <h3 className="text-lg font-black text-stone-950">{t(lang, "pharmacyBatchViewDiff")}</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between font-bold">
                <dt className="text-stone-500">{t(lang, "stockTitle")}</dt>
                <dd className="tabular-nums text-stone-950">{integrity.stockOnHand}</dd>
              </div>
              <div className="flex justify-between font-bold">
                <dt className="text-stone-500">{t(lang, "pharmacyBatches")}</dt>
                <dd className="tabular-nums text-stone-950">{integrity.batchSum}</dd>
              </div>
              <div className="flex justify-between font-black text-amber-900">
                <dt>{t(lang, "pharmacyBatchIntegrityDelta")}</dt>
                <dd className="tabular-nums">
                  {integrity.delta > 0 ? "+" : ""}
                  {integrity.delta}
                </dd>
              </div>
            </dl>
            <ul className="mt-4 max-h-48 space-y-1 overflow-y-auto text-xs font-semibold text-stone-700">
              {integrity.batches.map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span>{b.batchNumber}</span>
                  <span className="tabular-nums">{b.quantityRemaining}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setShowDiff(false)}
              className="mt-4 min-h-[48px] w-full rounded-2xl border-2 font-bold"
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </AppModalOverlay>
      ) : null}
    </>
  );
}
