import { HandCoins, TrendingDown, Users } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterValue } from "../../lib/dateFilters";
import { selectedDayKeyForFilter } from "../../lib/dateFilterLabels";
import { HistoryHeroCard } from "../shared/HistoryHeroCard";

type Props = {
  lang: Language;
  totalDebtUgx: number;
  collectedUgx: number;
  creditIssuedUgx: number;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
};

export function DebtsHeroCard({
  lang,
  totalDebtUgx,
  collectedUgx,
  creditIssuedUgx,
  filter,
  onFilterChange,
}: Props) {
  const isSingleDay = selectedDayKeyForFilter(filter) != null;
  const collectedLabel = isSingleDay ? t(lang, "closeDebtCollectedToday") : t(lang, "debtsHeroCollectedInRange");
  const creditLabel = isSingleDay ? t(lang, "debtsHeroCreditToday") : t(lang, "debtsHeroCreditInRange");

  return (
    <HistoryHeroCard
      lang={lang}
      filter={filter}
      onFilterChange={onFilterChange}
      metrics={[
        {
          label: t(lang, "salesHistoryTotalDebts"),
          icon: Users,
          value: `UGX ${totalDebtUgx.toLocaleString()}`,
          hint: t(lang, "ownerDebtHint"),
        },
        {
          label: collectedLabel,
          icon: TrendingDown,
          value: `UGX ${collectedUgx.toLocaleString()}`,
        },
        {
          label: creditLabel,
          icon: HandCoins,
          value: `UGX ${creditIssuedUgx.toLocaleString()}`,
        },
      ]}
    />
  );
}
