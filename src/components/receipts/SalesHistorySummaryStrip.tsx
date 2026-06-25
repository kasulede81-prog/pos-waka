import { ArrowDownCircle, HandCoins, Package, Wallet } from "lucide-react";
import clsx from "clsx";
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
  /** Horizontal compact cells — more room for sales list below. */
  compact?: boolean;
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
  compact = false,
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
        ? "grid-cols-2"
        : compact
          ? "grid-cols-2 lg:grid-cols-4"
          : "grid-cols-2 sm:grid-cols-4 sm:divide-y-0";

  return (
    <div
      className={clsx(
        "grid divide-stone-200",
        compact ? "divide-x divide-y" : "divide-x divide-y",
        embedded
          ? gridClass
          : `rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm ${gridClass}`,
      )}
    >
      {items.map(({ icon: Icon, label, value, iconClass, valueClass }) => (
        <div
          key={label}
          className={clsx(
            compact
              ? "flex items-center gap-2 px-2 py-2 text-left sm:px-2.5"
              : "flex flex-col items-center px-2 py-4 text-center sm:px-3",
          )}
        >
          <div
            className={clsx(
              "flex shrink-0 items-center justify-center rounded-full",
              iconClass,
              compact ? "h-7 w-7" : "mb-2 h-9 w-9",
            )}
          >
            <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
          </div>
          <div className={compact ? "min-w-0 flex-1" : undefined}>
            <p
              className={clsx(
                "font-bold leading-tight text-slate-600",
                compact ? "truncate text-[9px] sm:text-[10px]" : "text-[10px] sm:text-xs",
              )}
            >
              {label}
            </p>
            <p className={clsx("font-black", compact ? "text-[11px] sm:text-xs" : "mt-1 text-xs sm:text-sm", valueClass)}>
              UGX {value.toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
