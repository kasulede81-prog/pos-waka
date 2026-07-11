import clsx from "clsx";
import { MoreHorizontal, Phone } from "lucide-react";
import type { Customer, Language } from "../../types";
import type { CreditActivityIndex } from "../../lib/customerDebtActivity";
import { t } from "../../lib/i18n";
import { customerInitials, deriveCustomerDebtMeta, formatActivityWhen } from "../../lib/debtsPageView";

type Props = {
  lang: Language;
  customer: Customer;
  creditIndex: CreditActivityIndex;
  canDebt: boolean;
  onOpenDetail: () => void;
  onReceive: () => void;
};

export function DebtCustomerCard({ lang, customer, creditIndex, canDebt, onOpenDetail, onReceive }: Props) {
  const meta = deriveCustomerDebtMeta(customer, creditIndex);
  const localeLang = lang === "sw" ? "sw" : "en";
  const hasBalance = customer.debtBalanceUgx > 0;

  const status = !hasBalance
    ? { label: t(lang, "debtsStatusCleared"), className: "bg-emerald-100 text-emerald-800" }
    : meta.isOverdue
      ? { label: t(lang, "debtsStatusOverdue"), className: "bg-rose-100 text-rose-800" }
      : meta.isDueSoon
        ? { label: t(lang, "debtsStatusDueSoon"), className: "bg-amber-100 text-amber-900" }
        : { label: t(lang, "debtBalanceShort"), className: "bg-waka-100 text-waka-900" };

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-3 shadow-sm transition-all active:scale-[0.99] motion-reduce:active:scale-100">
      <button type="button" onClick={onOpenDetail} className="flex w-full items-start gap-2.5 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-waka-100 text-sm font-black text-waka-800">
          {customerInitials(customer.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-foreground">{customer.name}</p>
              <p className="truncate text-xs font-semibold text-muted-foreground">
                {customer.phone || t(lang, "debtNoPhone")}
              </p>
            </div>
            <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase", status.className)}>
              {status.label}
            </span>
          </div>
          <p className={clsx("mt-1 text-base font-black tabular-nums", hasBalance ? "text-waka-700" : "text-muted-foreground")}>
            UGX {customer.debtBalanceUgx.toLocaleString()}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] font-medium text-muted-foreground">
            {meta.lastPayment ? (
              <span>
                {t(lang, "debtsLastPayment")}: {formatActivityWhen(meta.lastPayment.at, localeLang)}
              </span>
            ) : null}
            {meta.lastSale ? (
              <span>
                {t(lang, "debtsLastSale")}: {formatActivityWhen(meta.lastSale.at, localeLang)}
              </span>
            ) : null}
          </div>
        </div>
      </button>

      <div className="mt-2.5 flex gap-1.5">
        {customer.phone ? (
          <a
            href={`tel:${customer.phone.replace(/\s/g, "")}`}
            className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1 rounded-xl border border-border text-xs font-bold text-foreground active:bg-muted"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden />
            {t(lang, "debtsCall")}
          </a>
        ) : null}
        {canDebt && hasBalance ? (
          <button
            type="button"
            onClick={onReceive}
            className="min-h-[36px] flex-[1.4] rounded-xl bg-waka-600 px-2 text-xs font-black text-white active:bg-waka-700"
          >
            {t(lang, "repayDebt")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenDetail}
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-xl border border-border text-muted-foreground active:bg-muted"
          aria-label={t(lang, "salesHistoryMoreActions")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
