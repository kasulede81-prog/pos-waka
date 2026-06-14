import type { Language, ReturnRecord, Sale } from "../../types";
import { t } from "../../lib/i18n";
import { buildReturnRefundTrace, type ReturnRefundTrace } from "../../lib/refundBreakdown";
import { RefundBreakdownPanel } from "./RefundBreakdownPanel";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  open: boolean;
  sale: Sale | null;
  returnRecord: ReturnRecord | null;
  returnRecords: ReturnRecord[];
  actorLabel: string;
  onClose: () => void;
};

function TraceBody({ lang, trace }: { lang: Language; trace: ReturnRefundTrace }) {
  const disc = trace.saleDiscountBreakdown;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-50 px-3 py-2">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          {t(lang, "refundTraceOriginalSaleTotal")}
        </p>
        <p className="mt-0.5 text-sm font-black text-slate-900">
          UGX {trace.originalSaleTotalUgx.toLocaleString()}
        </p>
      </div>

      {(disc.lineDiscountsUgx > 0 || disc.cartDiscountUgx > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
          <p className="font-black uppercase tracking-wide text-slate-500">{t(lang, "refundTraceDiscounts")}</p>
          <dl className="mt-1 space-y-0.5">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">{t(lang, "checkoutSubtotalLabel")}</dt>
              <dd className="font-bold">UGX {disc.listSubtotalUgx.toLocaleString()}</dd>
            </div>
            {disc.lineDiscountsUgx > 0 ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">{t(lang, "checkoutLineDiscountsLabel")}</dt>
                <dd className="font-bold">− UGX {disc.lineDiscountsUgx.toLocaleString()}</dd>
              </div>
            ) : null}
            {disc.cartDiscountUgx > 0 ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-600">{t(lang, "checkoutCartDiscountLabel")}</dt>
                <dd className="font-bold">− UGX {disc.cartDiscountUgx.toLocaleString()}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-1">
              <dt className="font-semibold text-slate-800">{t(lang, "refundTraceFinalPaid")}</dt>
              <dd className="font-black">UGX {disc.finalTotalUgx.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      )}

      {trace.priorRefundsUgx > 0 ? (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
          <p className="font-black uppercase tracking-wide text-slate-500">{t(lang, "refundTracePriorRefunds")}</p>
          <p className="mt-0.5 font-bold text-slate-900">UGX {trace.priorRefundsUgx.toLocaleString()}</p>
        </div>
      ) : null}

      <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs">
        <p className="font-black uppercase tracking-wide text-amber-900">{t(lang, "refundTraceCurrentRefund")}</p>
        <p className="mt-0.5 text-lg font-black text-amber-950">
          UGX {trace.currentRefundUgx.toLocaleString()}
        </p>
        <p className="mt-1 text-slate-700">
          {trace.productName} · {t(lang, `returnReason_${trace.reason}` as Parameters<typeof t>[1])}
        </p>
      </div>

      {trace.lineBreakdown ? (
        <RefundBreakdownPanel lang={lang} breakdown={trace.lineBreakdown} compact />
      ) : null}

      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
        <p className="font-black uppercase tracking-wide text-slate-500">{t(lang, "refundTraceRemainingBalance")}</p>
        <p className="mt-0.5 font-bold text-slate-900">UGX {trace.remainingBalanceUgx.toLocaleString()}</p>
      </div>

      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
        <p className="font-black uppercase tracking-wide text-slate-500">{t(lang, "refundTraceIssuedBy")}</p>
        <p className="mt-0.5 font-semibold text-slate-900">{trace.actorLabel}</p>
        <p className="mt-0.5 text-slate-600">{new Date(trace.createdAt).toLocaleString()}</p>
      </div>
    </div>
  );
}

export function RefundCalculationDrawer({
  lang,
  open,
  sale,
  returnRecord,
  returnRecords,
  actorLabel,
  onClose,
}: Props) {
  if (!open || !returnRecord) return null;

  const trace =
    sale != null
      ? buildReturnRefundTrace({ sale, returnRecord, returnRecords, actorLabel })
      : null;

  return (
    <AppModalOverlay className="z-[70] flex justify-end bg-black/40 p-0" role="dialog" aria-modal onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "refundTraceTitle")}</h2>
          <button type="button" className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600" onClick={onClose}>
            {t(lang, "cancel")}
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!sale ? (
            <p className="text-sm text-slate-600">{t(lang, "refundTraceUnlinked")}</p>
          ) : trace ? (
            <TraceBody lang={lang} trace={trace} />
          ) : null}
        </div>
      </div>
    </AppModalOverlay>
  );
}

export function RefundCalculationInline({ lang, trace }: { lang: Language; trace: ReturnRefundTrace }) {
  return <TraceBody lang={lang} trace={trace} />;
}
