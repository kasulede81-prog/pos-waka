import { ArrowDownCircle, HandCoins, Package, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  cashSalesUgx: number;
  debtCollectedUgx: number;
  expensesUgx: number;
  expensesLabel: string;
  stockValueUgx: number;
  showShopSummaries: boolean;
  /** When true, omits outer card chrome (used inside HistoryHeroCard). */
  embedded?: boolean;
};

export function SalesHistorySummaryStrip({
  lang,
  cashSalesUgx,
  debtCollectedUgx,
  expensesUgx,
  expensesLabel,
  stockValueUgx,
  showShopSummaries,
  embedded = false,
}: Props) {
  const items = [
    {
      icon: Wallet,
      label: t(lang, "salesHistoryCashInHand"),
      value: cashSalesUgx,
      iconClass: "bg-waka-100 text-waka-700",
      valueClass: "text-waka-700",
    },
    ...(showShopSummaries
      ? [
          {
            icon: HandCoins,
            label: t(lang, "salesHistoryDebtCollected"),
            value: debtCollectedUgx,
            iconClass: "bg-amber-100 text-amber-800",
            valueClass: "text-amber-900",
          },
          {
            icon: ArrowDownCircle,
            label: expensesLabel,
            value: expensesUgx,
            iconClass: "bg-emerald-100 text-emerald-700",
            valueClass: "text-emerald-700",
          },
          {
            icon: Package,
            label: t(lang, "salesHistoryStockValue"),
            value: stockValueUgx,
            iconClass: "bg-violet-100 text-violet-700",
            valueClass: "text-violet-700",
          },
        ]
      : []),
  ] as const;

  const gridClass =
    items.length === 1
      ? "grid-cols-1"
      : items.length === 2
        ? "grid-cols-2 sm:grid-cols-2"
        : "grid-cols-2 sm:grid-cols-4 sm:divide-y-0";

  return (
    <div
      className={
        embedded
          ? `grid divide-x divide-y divide-stone-200 ${gridClass}`
          : `grid divide-x divide-y divide-stone-200 rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm ${gridClass}`
      }
    >
      {items.map(({ icon: Icon, label, value, iconClass, valueClass }) => (
        <div key={label} className="flex flex-col items-center px-2 py-4 text-center sm:px-3">
          <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full ${iconClass}`}>
            <Icon className="h-4 w-4" aria-hidden />
          </div>
          <p className="text-[10px] font-bold leading-tight text-slate-600 sm:text-xs">{label}</p>
          <p className={`mt-1 text-xs font-black sm:text-sm ${valueClass}`}>UGX {value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}
