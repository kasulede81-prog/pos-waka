import { Link } from "react-router-dom";
import { ChevronRight, HandCoins, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterValue } from "../../lib/dateFilters";
import type { HistoryHeroMetric } from "../shared/HistoryHeroCard";
import { HistoryHeroCard } from "../shared/HistoryHeroCard";
import { SalesHistorySummaryStrip } from "./SalesHistorySummaryStrip";

type SummaryProps = {
  cashSalesUgx: number;
  debtCollectedUgx: number;
  expensesUgx: number;
  expensesLabel: string;
  stockValueUgx: number;
  showShopSummaries: boolean;
};

type Props = {
  lang: Language;
  salesLabel: string;
  salesUgx: number;
  profitUgx: number | null;
  showProfit: boolean;
  totalDebtUgx: number;
  showShopDebt?: boolean;
  showDebtsLink?: boolean;
  showReportsLink?: boolean;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
  sparklinePoints?: number[];
  summary?: SummaryProps;
};

function ProfitSparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const w = 88;
  const h = 28;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const area = `M0,${h} L${coords.map((c) => c.replace(",", " ")).join(" L")} L${w},${h} Z`;
  const line = coords.join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-7 w-[5.5rem]" aria-hidden>
      <defs>
        <linearGradient id="salesSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(255 237 213)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="rgb(255 237 213)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#salesSparkFill)" />
      <polyline
        fill="none"
        stroke="rgb(254 215 170)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={line}
      />
    </svg>
  );
}

export function SalesHistoryHeroCard({
  lang,
  salesLabel,
  salesUgx,
  profitUgx,
  showProfit,
  totalDebtUgx,
  showShopDebt = true,
  showDebtsLink = true,
  showReportsLink = true,
  filter,
  onFilterChange,
  sparklinePoints,
  summary,
}: Props) {
  const metrics: HistoryHeroMetric[] = [
    {
      label: salesLabel,
      value: `UGX ${salesUgx.toLocaleString()}`,
      footer: showReportsLink ? (
        <Link
          to="/reports"
          className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-waka-50/95 hover:text-white sm:mt-2 sm:text-xs"
        >
          {t(lang, "salesHistoryViewSummary")}
          <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden />
        </Link>
      ) : undefined,
    },
  ];

  if (showProfit) {
    metrics.push({
      label: t(lang, "salesHistoryProfits"),
      icon: Wallet,
      value: profitUgx != null ? `UGX ${profitUgx.toLocaleString()}` : "—",
      belowValue:
        showProfit && sparklinePoints && sparklinePoints.length > 1 ? (
          <ProfitSparkline points={sparklinePoints} />
        ) : undefined,
    });
  }

  if (showShopDebt) {
    metrics.push({
      label: t(lang, "salesHistoryTotalDebts"),
      icon: HandCoins,
      value: `UGX ${totalDebtUgx.toLocaleString()}`,
      footer: showDebtsLink ? (
        <Link
          to="/debts"
          className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-waka-50/95 hover:text-white sm:mt-2 sm:text-xs"
        >
          {t(lang, "salesHistoryViewDebts")}
          <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden />
        </Link>
      ) : undefined,
    });
  }

  return (
    <HistoryHeroCard
      lang={lang}
      filter={filter}
      onFilterChange={onFilterChange}
      metrics={metrics}
      bottomSection={
        summary ? (
          <SalesHistorySummaryStrip
            lang={lang}
            cashSalesUgx={summary.cashSalesUgx}
            debtCollectedUgx={summary.debtCollectedUgx}
            expensesUgx={summary.expensesUgx}
            expensesLabel={summary.expensesLabel}
            stockValueUgx={summary.stockValueUgx}
            showShopSummaries={summary.showShopSummaries}
            embedded
          />
        ) : undefined
      }
    />
  );
}
