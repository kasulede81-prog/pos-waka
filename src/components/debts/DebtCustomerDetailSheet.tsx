import { useEffect } from "react";
import clsx from "clsx";
import type { Customer, Language } from "../../types";
import type { CreditActivityEntry } from "../../lib/customerDebtActivity";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { customerInitials, formatActivityWhen } from "../../lib/debtsPageView";

type Props = {
  lang: Language;
  open: boolean;
  customer: Customer | null;
  timeline: CreditActivityEntry[];
  onClose: () => void;
  onReceive: () => void;
  canDebt: boolean;
};

export function DebtCustomerDetailSheet({
  lang,
  open,
  customer,
  timeline,
  onClose,
  onReceive,
  canDebt,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !customer) return null;

  const localeLang = lang === "sw" ? "sw" : "en";

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-stone-900/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div className="relative z-[55] max-h-[min(85dvh,40rem)] w-full overflow-y-auto rounded-t-[1.75rem] border border-stone-200 bg-white px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" aria-hidden />

        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-waka-100 text-sm font-black text-waka-800">
            {customerInitials(customer.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-black text-stone-950">{customer.name}</p>
            <p className="text-xs font-semibold text-stone-500">{customer.phone || t(lang, "debtNoPhone")}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-stone-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "debtBalanceLabel")}</p>
          <p className="text-xl font-black tabular-nums text-waka-700">UGX {customer.debtBalanceUgx.toLocaleString()}</p>
        </div>

        <div className="mt-3">
          <p className="text-xs font-black text-stone-800">{t(lang, "creditActivityTitle")}</p>
          {timeline.length === 0 ? (
            <p className="mt-2 text-sm font-medium text-stone-500">{t(lang, "creditActivityEmpty")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {timeline.slice(0, 12).map((entry) => (
                <li key={`${entry.kind}-${entry.id}`} className="flex items-start justify-between gap-2 rounded-xl border border-stone-100 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-stone-800">
                      {entry.kind === "credit_sale" ? t(lang, "creditSaleActivity") : t(lang, "debtPaymentActivity")}
                      {entry.receiptSeq != null ? ` #${String(entry.receiptSeq).padStart(3, "0")}` : ""}
                    </p>
                    <p className="text-[10px] font-medium text-stone-500">{formatActivityWhen(entry.at, localeLang)}</p>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 text-xs font-black tabular-nums",
                      entry.kind === "debt_payment" ? "text-teal-800" : "text-waka-700",
                    )}
                  >
                    {entry.kind === "debt_payment" ? "−" : "+"}UGX {entry.amountUgx.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canDebt && customer.debtBalanceUgx > 0 ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onReceive();
            }}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 text-sm font-black text-white active:bg-waka-700"
          >
            {t(lang, "repayDebt")}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-stone-200 text-sm font-bold text-stone-600 active:bg-stone-50"
        >
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
