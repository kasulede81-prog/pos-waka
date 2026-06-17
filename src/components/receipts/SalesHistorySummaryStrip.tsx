import { ArrowDownCircle, Package, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  cashInHandUgx: number;
  expensesUgx: number;
  expensesLabel: string;
  stockValueUgx: number;
};

export function SalesHistorySummaryStrip({
  lang,
  cashInHandUgx,
  expensesUgx,
  expensesLabel,
  stockValueUgx,
}: Props) {
  const items = [
    {
      icon: Wallet,
      label: t(lang, "salesHistoryCashInHand"),
      value: cashInHandUgx,
      iconClass: "bg-waka-100 text-waka-700",
      valueClass: "text-waka-700",
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
  ] as const;

  return (
    <div className="grid grid-cols-3 divide-x divide-stone-200 rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm">
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
