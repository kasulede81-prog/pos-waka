import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerCashExtended } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  cash: OwnerCashExtended;
};

export function CommandCenterCashCard({ lang, cash }: Props) {
  return (
    <section className="rounded-3xl border border-stone-200/90 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-stone-950 sm:text-base">{t(lang, "cmdCenterCashTitle")}</h2>
          <p className="text-[11px] font-semibold text-stone-500">{t(lang, "ownerCashSub")}</p>
        </div>
        {cash.hasUnresolvedVariance ? (
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-black uppercase text-rose-800">
            {t(lang, "ownerCashUnresolved")}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <CashMetric label={t(lang, "ownerCashExpected")} value={formatShortUgx(cash.periodExpectedCashUgx)} />
        <CashMetric
          label={t(lang, "ownerCashCounted")}
          value={cash.latestCountedCashUgx != null ? formatShortUgx(cash.latestCountedCashUgx) : "—"}
        />
        <CashMetric
          label={t(lang, "ownerCashDayVariance")}
          value={cash.latestDayVarianceUgx != null ? formatShortUgx(cash.latestDayVarianceUgx) : "—"}
          warn={cash.latestDayVarianceUgx != null && cash.latestDayVarianceUgx !== 0}
        />
        <CashMetric label={t(lang, "ownerCashOwnerWithdrawal")} value={formatShortUgx(cash.ownerWithdrawalsUgx)} />
        <CashMetric label={t(lang, "ownerCashBankDeposit")} value={formatShortUgx(cash.bankDepositsUgx)} />
        <CashMetric label={t(lang, "ownerCashExpenses")} value={formatShortUgx(cash.cashExpensesUgx)} />
      </dl>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          to="/office/cash-position"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-waka-600 px-4 text-sm font-black text-white"
        >
          {t(lang, "ownerCashViewPosition")}
        </Link>
        <Link
          to="/close-day"
          className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border-2 border-stone-200 px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "ownerCashViewClose")}
        </Link>
      </div>
    </section>
  );
}

function CashMetric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={clsx("rounded-2xl px-2.5 py-2", warn ? "bg-rose-50" : "bg-stone-50")}>
      <dt className="text-[10px] font-bold uppercase text-stone-500">{label}</dt>
      <dd className={clsx("mt-0.5 text-sm font-black tabular-nums", warn ? "text-rose-800" : "text-stone-950")}>
        {value}
      </dd>
    </div>
  );
}
