import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { LineRefundBreakdown } from "../../lib/refundBreakdown";

type Props = {
  lang: Language;
  breakdown: LineRefundBreakdown;
  compact?: boolean;
};

function money(n: number): string {
  return n.toLocaleString();
}

export function RefundBreakdownPanel({ lang, breakdown, compact = false }: Props) {
  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    {
      label: t(lang, "refundBreakdownListPrice"),
      value: `UGX ${money(breakdown.listPriceUgx)}`,
    },
    {
      label: t(lang, "refundBreakdownLineDiscount"),
      value: `UGX ${money(breakdown.lineDiscountUgx)}`,
    },
    {
      label: t(lang, "refundBreakdownCartDiscount"),
      value: `UGX ${money(breakdown.cartDiscountAllocationUgx)}`,
    },
    {
      label: t(lang, "refundBreakdownCustomerPaid"),
      value: `UGX ${money(breakdown.customerPaidUgx)}`,
      bold: true,
    },
  ];

  if (breakdown.previouslyRefundedUgx > 0) {
    rows.push({
      label: t(lang, "refundBreakdownPreviouslyRefunded"),
      value: `UGX ${money(breakdown.previouslyRefundedUgx)}`,
    });
  }

  if (!compact) {
    rows.push({
      label: t(lang, "refundBreakdownRemainingRefundable"),
      value: `UGX ${money(breakdown.remainingRefundableUgx)}`,
    });
  }

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/90 p-3 text-sm">
      <p className="font-black text-slate-900">{breakdown.productName}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-600">
        {tTemplate(lang, "refundBreakdownQtyReturning", {
          sold: String(breakdown.quantitySold),
          returning: String(breakdown.quantityReturning),
        })}
      </p>
      <dl className="mt-2 space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2 text-xs">
            <dt className="font-semibold text-slate-600">{row.label}</dt>
            <dd className={row.bold ? "font-black text-slate-900" : "font-bold text-slate-800"}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 border-t border-slate-200 pt-2">
        <div className="flex justify-between gap-2">
          <span className="text-xs font-black uppercase tracking-wide text-amber-900">
            {t(lang, "refundBreakdownRefundAmount")}
          </span>
          <span className="text-base font-black text-amber-950">
            UGX {money(breakdown.refundAmountUgx)}
          </span>
        </div>
      </div>
      {breakdown.saleRoundingRemainderUgx > 0 ? (
        <p className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs font-semibold text-violet-900">
          {tTemplate(lang, "refundRoundingRemainderHint", {
            amount: money(breakdown.saleRoundingRemainderUgx),
          })}
        </p>
      ) : null}
    </div>
  );
}
