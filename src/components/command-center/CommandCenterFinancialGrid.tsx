import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Receipt, Scale, TrendingUp, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerFinancialExtended } from "../../lib/ownerCommandCenterBuilders";
import {
  formatOfficialHeadlineUgx,
  formatShortUgx,
  pctChangeLabel,
  type CommandCenterOfficialFinancials,
  type SparkPoint,
} from "../../lib/commandCenterPageView";
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
  officialFinancials?: CommandCenterOfficialFinancials;
  canProfit?: boolean;
  comparisonLabelKey?: string;
};

type FinMetric = {
  labelKey: string;
  value: string;
  pct: string | null;
  icon: LucideIcon;
};

export function CommandCenterFinancialGrid({
  lang,
  financial,
  periodLabel,
  revenueSparkline = [],
  officialFinancials,
  canProfit = true,
  comparisonLabelKey = "cmdCenterVsYesterday",
}: Props) {
  const officialReady = officialFinancials ? officialFinancials.presentHeadlinesAsFinal : true;
  const officialRevenue = officialReady ? (officialFinancials?.revenueUgx ?? financial.revenueUgx) : null;
  const officialProfit = officialReady ? (officialFinancials?.profitUgx ?? financial.profitUgx) : null;
  const officialCostIncomplete = officialReady
    ? (officialFinancials?.costIncomplete ?? financial.costIncomplete)
    : false;
  const mix = officialReady ? financial.paymentMix : null;
  const mixTotal = mix
    ? mix.cashUgx + mix.mobileMoneyUgx + mix.atmUgx + mix.creditUgx + mix.mixedUgx + mix.otherUgx
    : 0;
  const cashPct = mix && mixTotal > 0 ? Math.round((mix.cashUgx / mixTotal) * 100) : 0;
  const purchasesUgx = officialReady ? financial.purchasesUgx : null;
  const expensesPeriodUgx = officialReady ? financial.expensesPeriodUgx : null;
  const debtIssuedUgx = officialReady ? financial.debtIssuedUgx : null;

  const metrics: FinMetric[] = [
    {
      labelKey: "ownerFinancialRevenue",
      value: formatOfficialHeadlineUgx(officialRevenue),
      pct: officialReady ? pctChangeLabel(financial.trendVsPriorDay?.pctRevenue ?? null) : null,
      icon: TrendingUp,
    },
    ...(canProfit
      ? [
          {
            labelKey: officialCostIncomplete ? "profitGrossProfitEstimated" : "ownerFinancialProfit",
            value: formatOfficialHeadlineUgx(officialProfit),
            pct: officialReady ? pctChangeLabel(financial.trendVsPriorDay?.pctProfit ?? null) : null,
            icon: PiggyBank,
          } satisfies FinMetric,
        ]
      : []),
    { labelKey: "ownerFinancialPurchases", value: formatOfficialHeadlineUgx(purchasesUgx), pct: null, icon: ArrowUpRight },
    { labelKey: "ownerFinancialExpensesPeriod", value: formatOfficialHeadlineUgx(expensesPeriodUgx), pct: null, icon: Receipt },
    { labelKey: "ownerFinancialReceivables", value: formatShortUgx(financial.receivablesUgx), pct: null, icon: Wallet },
    { labelKey: "ownerFinancialPayables", value: formatShortUgx(financial.payablesUgx), pct: null, icon: Scale },
    { labelKey: "ownerFinancialDebtCollected", value: formatShortUgx(financial.debtCollectedUgx), pct: null, icon: ArrowDownLeft },
    { labelKey: "ownerFinancialDebtIssued", value: formatOfficialHeadlineUgx(debtIssuedUgx), pct: null, icon: ArrowUpRight },
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
            hint={m.pct ? `${m.pct} ${t(lang, comparisonLabelKey)}` : undefined}
          />
        ))}
      </div>

      {mix == null ? (
        <div className="mt-4 rounded-2xl bg-muted p-3">
          <Caption className="uppercase tracking-wide">{t(lang, "ownerFinancialPaymentMix")}</Caption>
          <MonoNumber className="mt-1 text-sm">—</MonoNumber>
        </div>
      ) : mixTotal > 0 ? (
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
