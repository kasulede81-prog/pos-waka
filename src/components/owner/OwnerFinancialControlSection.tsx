import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerFinancialExtended } from "../../lib/ownerCommandCenterBuilders";

type Props = {
  lang: Language;
  financial: OwnerFinancialExtended;
  periodLabel: string;
};

function trendLabel(pct: number | null): string | null {
  if (pct == null) return null;
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function OwnerFinancialControlSection({ lang, financial, periodLabel }: Props) {
  const mix = financial.paymentMix;
  const mixTotal =
    mix.cashUgx + mix.mobileMoneyUgx + mix.atmUgx + mix.creditUgx + mix.mixedUgx + mix.otherUgx;

  return (
    <section className="rounded-2xl border border-border/90 bg-card p-3 shadow-sm sm:p-4">
      <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "ownerFinancialTitle")}</h2>
      <p className="text-[11px] font-semibold text-muted-foreground">{periodLabel}</p>

      <dl className="mt-3 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 sm:grid-cols-4">
        <div className="min-w-0 rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialRevenue")}</dt>
          <dd className="break-words text-sm font-black tabular-nums [overflow-wrap:anywhere]">UGX {financial.revenueUgx.toLocaleString()}</dd>
          {financial.trendVsPriorDay?.pctRevenue != null ? (
            <dd className="text-[10px] font-bold text-muted-foreground">{trendLabel(financial.trendVsPriorDay.pctRevenue)} vs day</dd>
          ) : null}
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialProfit")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.profitUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialTransactions")}</dt>
          <dd className="text-sm font-black">{financial.transactionCount}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialPurchases")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.purchasesUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialDebtCollected")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.debtCollectedUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialDebtIssued")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.debtIssuedUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialReceivables")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.receivablesUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialPayables")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.payablesUgx.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ownerFinancialExpensesPeriod")}</dt>
          <dd className="text-sm font-black tabular-nums">UGX {financial.expensesPeriodUgx.toLocaleString()}</dd>
        </div>
      </dl>

      {financial.trendVsPriorWeek?.pctRevenue != null || financial.trendVsPriorMonth?.pctRevenue != null ? (
        <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
          {financial.trendVsPriorWeek?.pctRevenue != null
            ? `${t(lang, "ownerFinancialTrendWeek")}: ${trendLabel(financial.trendVsPriorWeek.pctRevenue)}`
            : ""}
          {financial.trendVsPriorMonth?.pctRevenue != null
            ? ` · ${t(lang, "ownerFinancialTrendMonth")}: ${trendLabel(financial.trendVsPriorMonth.pctRevenue)}`
            : ""}
        </p>
      ) : null}

      {mixTotal > 0 ? (
        <div className="mt-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "ownerFinancialPaymentMix")}</p>
          <ul className="mt-1 space-y-0.5 text-[11px] font-semibold text-muted-foreground">
            {mix.cashUgx > 0 ? (
              <li className="flex justify-between"><span>{t(lang, "ownerFinancialCash")}</span><span className="font-black">UGX {mix.cashUgx.toLocaleString()}</span></li>
            ) : null}
            {mix.mobileMoneyUgx > 0 ? (
              <li className="flex justify-between"><span>{t(lang, "ownerFinancialMobile")}</span><span className="font-black">UGX {mix.mobileMoneyUgx.toLocaleString()}</span></li>
            ) : null}
            {mix.creditUgx > 0 ? (
              <li className="flex justify-between"><span>{t(lang, "ownerFinancialCredit")}</span><span className="font-black">UGX {mix.creditUgx.toLocaleString()}</span></li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Link to="/office/audit-center" className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border px-3 text-xs font-black text-foreground">
          {t(lang, "ownerFinancialDrillDown")}
        </Link>
        <Link to="/purchases" className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border px-3 text-xs font-black text-foreground">
          {t(lang, "ownerFinancialViewPurchases")}
        </Link>
      </div>
    </section>
  );
}
