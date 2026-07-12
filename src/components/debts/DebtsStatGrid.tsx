import { AlertTriangle, Clock, HandCoins, TrendingDown, Users, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatShortUgx } from "../../lib/debtsPageView";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { MonoNumber } from "../enterprise/EnterpriseTypography";

type Props = {
  lang: Language;
  outstandingUgx: number;
  customersOwing: number;
  collectedUgx: number;
  creditSalesUgx: number;
  overdueCount: number;
  avgCollectionDays: number | null;
  collectedLabel?: string;
  creditSalesLabel?: string;
};

export function DebtsStatGrid({
  lang,
  outstandingUgx,
  customersOwing,
  collectedUgx,
  creditSalesUgx,
  overdueCount,
  avgCollectionDays,
  collectedLabel,
  creditSalesLabel,
}: Props) {
  const collected = collectedLabel ?? t(lang, "debtsStatCollectedToday");
  const creditSales = creditSalesLabel ?? t(lang, "debtsStatCreditSales");

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
      <EnterpriseKpiCard
        icon={Wallet}
        label={t(lang, "debtsStatOutstanding")}
        value={<MonoNumber className="text-base text-waka-700 sm:text-lg">{formatShortUgx(outstandingUgx)}</MonoNumber>}
        tone="highlight"
      />
      <EnterpriseKpiCard icon={Users} label={t(lang, "debtsStatCustomersOwing")} value={String(customersOwing)} />
      <EnterpriseKpiCard
        icon={TrendingDown}
        label={collected}
        value={<MonoNumber className="text-base text-teal-800 sm:text-lg">{formatShortUgx(collectedUgx)}</MonoNumber>}
        tone="success"
      />
      <EnterpriseKpiCard icon={HandCoins} label={creditSales} value={formatShortUgx(creditSalesUgx)} />
      <EnterpriseKpiCard
        icon={AlertTriangle}
        label={t(lang, "debtsStatOverdue")}
        value={String(overdueCount)}
        tone={overdueCount > 0 ? "danger" : "default"}
      />
      <EnterpriseKpiCard
        icon={Clock}
        label={t(lang, "debtsStatAvgCollection")}
        value={avgCollectionDays != null ? tTemplate(lang, "debtsStatAvgDays", { days: String(avgCollectionDays) }) : "—"}
      />
    </div>
  );
}
