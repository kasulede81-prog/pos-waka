import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { LineRefundBreakdown } from "../../lib/refundBreakdown";

type Props = {
  lang: Language;
  breakdown: LineRefundBreakdown;
  compact?: boolean;
  /** Collapsed details section — no product header or refund footer. */
  detailsOnly?: boolean;
};

function money(n: number): string {
  return n.toLocaleString();
}

export function RefundBreakdownPanel({ lang, breakdown, compact = false, detailsOnly = false }: Props) {
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
    <div className={`rounded-2xl border border-stone-200 bg-stone-50/90 p-3 text-sm ${detailsOnly ? "mt-2" : "mt-3"}`}>
      {!detailsOnly ? (
        <>
          <p className="font-black text-stone-900">{breakdown.productName}</p>
          <p className="mt-0.5 text-xs font-semibold text-stone-600">
            {tTemplate(lang, "refundBreakdownQtyReturning", {
              sold: breakdown.quantitySoldLabel ?? String(breakdown.quantitySold),
              returning: breakdown.quantityReturningLabel ?? String(breakdown.quantityReturning),
            })}
          </p>
        </>
      ) : null}
      <dl className={`space-y-1 ${detailsOnly ? "" : "mt-2"}`}>
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-2 text-xs">
            <dt className="font-semibold text-stone-600">{row.label}</dt>
            <dd className={row.bold ? "font-black text-stone-900" : "font-bold text-stone-800"}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {!detailsOnly && !compact ? (
        <div className="mt-2 border-t border-stone-200 pt-2">
          <div className="flex justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wide text-amber-900">
              {t(lang, "refundBreakdownRefundAmount")}
            </span>
            <span className="text-base font-black text-amber-950">
              UGX {money(breakdown.refundAmountUgx)}
            </span>
          </div>
        </div>
      ) : null}
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
