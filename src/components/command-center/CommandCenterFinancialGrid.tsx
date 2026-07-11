import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerFinancialExtended } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx, pctChangeLabel, type SparkPoint } from "../../lib/commandCenterPageView";
import { MiniSparkline } from "./MiniSparkline";

type Props = {
  lang: Language;
  financial: OwnerFinancialExtended;
  periodLabel: string;
  revenueSparkline?: SparkPoint[];
};

type FinMetric = {
  labelKey: string;
  value: string;
  pct: string | null;
  warn?: boolean;
};

export function CommandCenterFinancialGrid({ lang, financial, periodLabel, revenueSparkline = [] }: Props) {
  const mix = financial.paymentMix;
  const mixTotal = mix.cashUgx + mix.mobileMoneyUgx + mix.atmUgx + mix.creditUgx + mix.mixedUgx + mix.otherUgx;
  const cashPct = mixTotal > 0 ? Math.round((mix.cashUgx / mixTotal) * 100) : 0;

  const metrics: FinMetric[] = [
    {
      labelKey: "ownerFinancialRevenue",
      value: formatShortUgx(financial.revenueUgx),
      pct: pctChangeLabel(financial.trendVsPriorDay?.pctRevenue ?? null),
    },
    {
      labelKey: "ownerFinancialProfit",
      value: formatShortUgx(financial.profitUgx),
      pct: pctChangeLabel(financial.trendVsPriorDay?.pctProfit ?? null),
    },
    { labelKey: "ownerFinancialPurchases", value: formatShortUgx(financial.purchasesUgx), pct: null },
    { labelKey: "ownerFinancialExpensesPeriod", value: formatShortUgx(financial.expensesPeriodUgx), pct: null },
    { labelKey: "ownerFinancialReceivables", value: formatShortUgx(financial.receivablesUgx), pct: null },
    { labelKey: "ownerFinancialPayables", value: formatShortUgx(financial.payablesUgx), pct: null },
    { labelKey: "ownerFinancialDebtCollected", value: formatShortUgx(financial.debtCollectedUgx), pct: null },
    { labelKey: "ownerFinancialDebtIssued", value: formatShortUgx(financial.debtIssuedUgx), pct: null },
  ];

  return (
    <section className="rounded-3xl border border-border/90 bg-card p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cmdCenterFinancialTitle")}</h2>
        <p className="text-[11px] font-semibold text-muted-foreground">{periodLabel}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.labelKey} className="rounded-2xl border border-border bg-muted/80 p-2.5">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, m.labelKey)}</p>
            <p className="mt-0.5 text-sm font-black tabular-nums text-foreground">{m.value}</p>
            <div className="mt-1 flex items-end justify-between">
              {m.pct ? <span className="text-[10px] font-bold text-teal-700">{m.pct}</span> : <span />}
              <MiniSparkline points={revenueSparkline} strokeClass="stroke-stone-400" />
            </div>
          </div>
        ))}
      </div>

      {mixTotal > 0 ? (
        <div className="mt-4 rounded-2xl bg-muted p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "ownerFinancialPaymentMix")}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-waka-500 transition-all" style={{ width: `${cashPct}%` }} />
          </div>
          <p className="mt-1 text-[11px] font-bold text-muted-foreground">
            {t(lang, "ownerFinancialCash")} {cashPct}%
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Link
          to="/office/audit-center"
          className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border text-xs font-black text-foreground"
        >
          {t(lang, "ownerFinancialDrillDown")} →
        </Link>
        <Link
          to="/purchases"
          className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-border text-xs font-black text-foreground"
        >
          {t(lang, "ownerFinancialViewPurchases")} →
        </Link>
      </div>
    </section>
  );
}
