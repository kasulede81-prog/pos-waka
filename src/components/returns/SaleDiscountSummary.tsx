import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { SaleDiscountBreakdown } from "../../lib/discountBreakdown";

type Props = {
  lang: Language;
  breakdown: SaleDiscountBreakdown;
  className?: string;
};

export function SaleDiscountSummary({ lang, breakdown, className = "" }: Props) {
  const hasDiscount = breakdown.lineDiscountsUgx > 0 || breakdown.cartDiscountUgx > 0;
  if (!hasDiscount) return null;

  return (
    <div className={`rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-xs ${className}`}>
      <p className="font-black uppercase tracking-wide text-violet-900">{t(lang, "receiptDiscountBreakdownTitle")}</p>
      <dl className="mt-1 space-y-0.5">
        <div className="flex justify-between gap-2">
          <dt className="font-semibold text-stone-700">{t(lang, "checkoutSubtotalLabel")}</dt>
          <dd className="font-bold text-stone-900">UGX {breakdown.listSubtotalUgx.toLocaleString()}</dd>
        </div>
        {breakdown.lineDiscountsUgx > 0 ? (
          <div className="flex justify-between gap-2">
            <dt className="font-semibold text-stone-700">{t(lang, "checkoutLineDiscountsLabel")}</dt>
            <dd className="font-bold text-rose-800">− UGX {breakdown.lineDiscountsUgx.toLocaleString()}</dd>
          </div>
        ) : null}
        {breakdown.cartDiscountUgx > 0 ? (
          <div className="flex justify-between gap-2">
            <dt className="font-semibold text-stone-700">{t(lang, "checkoutCartDiscountLabel")}</dt>
            <dd className="font-bold text-rose-800">− UGX {breakdown.cartDiscountUgx.toLocaleString()}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 border-t border-violet-100 pt-1">
          <dt className="font-bold text-stone-800">{t(lang, "receiptFinalPaidLabel")}</dt>
          <dd className="font-black text-stone-950">UGX {breakdown.finalTotalUgx.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}
