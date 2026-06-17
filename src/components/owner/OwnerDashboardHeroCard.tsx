import { Banknote, TrendingUp, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterValue } from "../../lib/dateFilters";
import { selectedDayKeyForFilter } from "../../lib/dateFilterLabels";
import { HistoryHeroCard } from "../shared/HistoryHeroCard";

type Props = {
  lang: Language;
  salesUgx: number;
  profitUgx: number;
  expectedCashUgx: number;
  saleCount: number;
  countedCashUgx: number | null;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
};

export function OwnerDashboardHeroCard({
  lang,
  salesUgx,
  profitUgx,
  expectedCashUgx,
  saleCount,
  countedCashUgx,
  filter,
  onFilterChange,
}: Props) {
  const isSingleDay = selectedDayKeyForFilter(filter) != null;
  const salesLabel = isSingleDay ? t(lang, "salesHistoryTodaySales") : t(lang, "salesHistorySalesInRange");
  const cashLabel = isSingleDay ? t(lang, "ownerCardExpectedCash") : t(lang, "ownerCardExpectedCash");

  return (
    <HistoryHeroCard
      lang={lang}
      filter={filter}
      onFilterChange={onFilterChange}
      metrics={[
        {
          label: salesLabel,
          icon: Wallet,
          value: `UGX ${salesUgx.toLocaleString()}`,
          hint: `${saleCount} ${t(lang, "salesCount")}`,
        },
        {
          label: t(lang, "estimatedProfit"),
          icon: TrendingUp,
          value: `UGX ${profitUgx.toLocaleString()}`,
          hint: profitUgx < 0 ? t(lang, "estimatedProfitNegativeHint") : t(lang, "estimatedProfitHint"),
        },
        {
          label: cashLabel,
          icon: Banknote,
          value: `UGX ${expectedCashUgx.toLocaleString()}`,
          hint:
            countedCashUgx !== null
              ? `${t(lang, "ownerCardCountedCash")}: UGX ${countedCashUgx.toLocaleString()}`
              : t(lang, "ownerNoCloseYet"),
        },
      ]}
    />
  );
}
