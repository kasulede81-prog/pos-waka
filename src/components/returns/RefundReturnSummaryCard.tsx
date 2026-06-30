import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

type Props = {
  lang: Language;
  customerPaidUgx: number;
  refundingUgx: number;
  remainingAfterUgx: number;
  customRefund: boolean;
  recommendedUgx: number;
};

export function RefundReturnSummaryCard({
  lang,
  customerPaidUgx,
  refundingUgx,
  remainingAfterUgx,
  customRefund,
  recommendedUgx,
}: Props) {
  return (
    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm">
      <p className="text-xs font-black uppercase tracking-wide text-emerald-900">
        {t(lang, "returnRefundSummaryTitle")}
      </p>
      <dl className="mt-2 space-y-1.5">
        <div className="flex justify-between gap-2">
          <dt className="font-semibold text-stone-700">{t(lang, "refundBreakdownCustomerPaid")}</dt>
          <dd className="font-black text-stone-900">UGX {customerPaidUgx.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="font-semibold text-stone-700">{t(lang, "returnSummaryRefunding")}</dt>
          <dd className="font-black text-amber-950">UGX {refundingUgx.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-2 border-t border-emerald-100 pt-1.5">
          <dt className="font-semibold text-stone-700">{t(lang, "returnSummaryRemainingAfter")}</dt>
          <dd className="font-bold text-stone-800">UGX {Math.max(0, remainingAfterUgx).toLocaleString()}</dd>
        </div>
      </dl>
      {customRefund ? (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-950">
          {tTemplate(lang, "returnSummaryCustomWarning", { amount: recommendedUgx.toLocaleString() })}
        </p>
      ) : null}
    </div>
  );
}
