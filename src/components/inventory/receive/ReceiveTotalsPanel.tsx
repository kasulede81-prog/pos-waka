import type { Language } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import { WIZARD_INPUT_NUMERIC } from "./receiveTokens";
import { RECEIVE_FIELD_LABEL } from "./receiveTokens";

type Props = {
  lang: Language;
  totalUgx: number;
  showPartialPayment?: boolean;
  paidStr?: string;
  onPaidChange?: (value: string) => void;
  balanceOwedUgx?: number;
};

export function ReceiveTotalsPanel({
  lang,
  totalUgx,
  showPartialPayment,
  paidStr,
  onPaidChange,
  balanceOwedUgx,
}: Props) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-muted-foreground">{t(lang, "restockTotalBuy")}</span>
        <span className="text-xl font-black tabular-nums text-foreground">{formatShortUgx(totalUgx)}</span>
      </div>

      {showPartialPayment ? (
        <>
          <label className="mt-4 block">
            <span className={RECEIVE_FIELD_LABEL}>{t(lang, "restockPaidToday")}</span>
            <input
              value={paidStr ?? ""}
              onChange={(e) => onPaidChange?.(e.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              placeholder={String(totalUgx)}
              className={`${WIZARD_INPUT_NUMERIC} mt-2`}
            />
          </label>
          {balanceOwedUgx != null && balanceOwedUgx > 0 ? (
            <p className="mt-2 text-sm font-bold text-amber-800">
              {tTemplate(lang, "restockStillOwe", { amount: balanceOwedUgx.toLocaleString() })}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
