import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";

type Chip = { label: string; value: string };

type Props = {
  chips: Chip[];
};

export function SalesHistorySecondaryChips({ chips }: Props) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[10px] font-bold text-stone-700 shadow-sm"
        >
          <span className="truncate text-stone-500">{chip.label}</span>
          <span className="shrink-0 font-black tabular-nums text-stone-900">{chip.value}</span>
        </span>
      ))}
    </div>
  );
}

export function buildSecondaryChips(
  lang: Language,
  data: {
    cashSalesUgx: number;
    debtCollectedUgx: number;
    expensesUgx: number;
    expensesLabel: string;
    stockValueUgx: number;
    showShopSummaries: boolean;
  },
): Chip[] {
  const chips: Chip[] = [
    { label: t(lang, "salesHistoryCashInHand"), value: formatUgx(data.cashSalesUgx) },
  ];
  if (data.showShopSummaries) {
    chips.push(
      { label: t(lang, "salesHistoryDebtCollected"), value: formatUgx(data.debtCollectedUgx) },
      { label: data.expensesLabel, value: formatUgx(data.expensesUgx) },
      { label: t(lang, "salesHistoryStockValue"), value: formatUgx(data.stockValueUgx) },
    );
  }
  return chips;
}
