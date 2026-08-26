import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import { WIZARD_INPUT_NUMERIC, wizardChoiceButtonClass } from "./receiveTokens";
import { RECEIVE_FIELD_LABEL } from "./receiveTokens";
import type { ReceivePayStatus } from "./receivePaymentStatus";

type Props = {
  lang: Language;
  totalUgx: number;
  showPartialPayment?: boolean;
  payStatus?: ReceivePayStatus;
  onPayStatusChange?: (status: ReceivePayStatus) => void;
  paidStr?: string;
  onPaidChange?: (value: string) => void;
  balanceOwedUgx?: number;
};

const STATUSES: ReceivePayStatus[] = ["paid", "partial", "unpaid"];

export function ReceiveTotalsPanel({
  lang,
  totalUgx,
  showPartialPayment,
  payStatus = "unpaid",
  onPayStatusChange,
  paidStr,
  onPaidChange,
  balanceOwedUgx,
}: Props) {
  const statusLabel: Record<ReceivePayStatus, string> = {
    paid: t(lang, "restockPayPaid"),
    partial: t(lang, "restockPayPartial"),
    unpaid: t(lang, "restockPayUnpaid"),
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-muted-foreground">{t(lang, "restockTotalBuy")}</span>
        <span className="text-xl font-black tabular-nums text-foreground">{formatShortUgx(totalUgx)}</span>
      </div>

      {showPartialPayment ? (
        <>
          <p className={`${RECEIVE_FIELD_LABEL} mt-4`}>{t(lang, "restockPayStatus")}</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onPayStatusChange?.(status)}
                className={wizardChoiceButtonClass(payStatus === status)}
              >
                {statusLabel[status]}
              </button>
            ))}
          </div>

          {payStatus === "partial" ? (
            <label className="mt-4 block">
              <span className={RECEIVE_FIELD_LABEL}>{t(lang, "restockPaidToday")}</span>
              <input
                value={paidStr ?? ""}
                onChange={(e) => onPaidChange?.(e.target.value.replace(/\D/g, "").slice(0, 12))}
                inputMode="numeric"
                placeholder="0"
                className={`${WIZARD_INPUT_NUMERIC} mt-2`}
              />
            </label>
          ) : null}

          <p className="mt-3 text-sm font-semibold text-muted-foreground">{t(lang, "restockPaidHint")}</p>

          {payStatus === "paid" ? (
            <p className="mt-2 text-sm font-bold text-success-foreground">{t(lang, "restockPayPaidHint")}</p>
          ) : null}

          {balanceOwedUgx != null && balanceOwedUgx > 0 ? (
            <p className="mt-2 text-sm font-bold text-warning-foreground">
              {tTemplate(lang, "restockStillOwe", { amount: balanceOwedUgx.toLocaleString() })}
            </p>
          ) : payStatus === "unpaid" && totalUgx > 0 ? (
            <p className="mt-2 text-sm font-bold text-warning-foreground">
              {tTemplate(lang, "restockStillOwe", { amount: totalUgx.toLocaleString() })}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
