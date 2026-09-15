import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Receipt, Scale, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerFinancialExtended } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx, pctChangeLabel, type SparkPoint } from "../../lib/commandCenterPageView";
import { MiniSparkline } from "./MiniSparkline";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { Caption, MonoNumber } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";

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
  icon: LucideIcon;
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
      icon: TrendingUp,
    },
    {
      labelKey: "ownerFinancialProfit",
      value: formatShortUgx(financial.profitUgx),
      pct: pctChangeLabel(financial.trendVsPriorDay?.pctProfit ?? null),
      icon: PiggyBank,
    },
    { labelKey: "ownerFinancialPurchases", value: formatShortUgx(financial.purchasesUgx), pct: null, icon: ArrowUpRight },
    { labelKey: "ownerFinancialExpensesPeriod", value: formatShortUgx(financial.expensesPeriodUgx), pct: null, icon: Receipt },
    { labelKey: "ownerFinancialReceivables", value: formatShortUgx(financial.receivablesUgx), pct: null, icon: Wallet },
    { labelKey: "ownerFinancialPayables", value: formatShortUgx(financial.payablesUgx), pct: null, icon: Scale },
    { labelKey: "ownerFinancialDebtCollected", value: formatShortUgx(financial.debtCollectedUgx), pct: null, icon: ArrowDownLeft },
    { labelKey: "ownerFinancialDebtIssued", value: formatShortUgx(financial.debtIssuedUgx), pct: null, icon: ArrowUpRight },
  ];

  return (
    <EnterpriseCard title={t(lang, "cmdCenterFinancialTitle")} subtitle={periodLabel}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map((m) => (
          <EnterpriseKpiCard
            key={m.labelKey}
            icon={m.icon}
            label={t(lang, m.labelKey)}
            value={
              <div className="flex items-end justify-between gap-1">
                <MonoNumber className="text-sm sm:text-base">{m.value}</MonoNumber>
                <MiniSparkline points={revenueSparkline} strokeClass="stroke-stone-400" />
              </div>
            }
            hint={m.pct ? `${m.pct} ${t(lang, "cmdCenterVsYesterday")}` : undefined}
          />
        ))}
      </div>

      {mixTotal > 0 ? (
        <div className="mt-4 rounded-2xl bg-muted p-3">
          <Caption className="uppercase tracking-wide">{t(lang, "ownerFinancialPaymentMix")}</Caption>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-waka-500 transition-all" style={{ width: `${cashPct}%` }} />
          </div>
          <Caption className="mt-1">
            {t(lang, "ownerFinancialCash")} {cashPct}%
          </Caption>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Link to="/office/audit-center">
          <WakaButton type="button" variant="secondary" className="w-full">
            {t(lang, "ownerFinancialDrillDown")} →
          </WakaButton>
        </Link>
        <Link to="/purchases">
          <WakaButton type="button" variant="secondary" className="w-full">
            {t(lang, "ownerFinancialViewPurchases")} →
          </WakaButton>
        </Link>
      </div>
    </EnterpriseCard>
  );
}
