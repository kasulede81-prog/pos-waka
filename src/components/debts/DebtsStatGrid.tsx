import clsx from "clsx";
import { AlertTriangle, Clock, HandCoins, TrendingDown, Users, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatShortUgx } from "../../lib/debtsPageView";

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

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
  warn,
  valueClass,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={clsx(
        "flex min-h-[76px] flex-col justify-between rounded-2xl border p-2.5 shadow-sm",
        highlight
          ? "border-waka-300 bg-gradient-to-br from-waka-50 to-waka-50/80"
          : warn
            ? "border-rose-200/90 bg-white"
            : "border-stone-200/90 bg-white",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            highlight
              ? "bg-waka-600 text-white"
              : warn
                ? "bg-rose-100 text-rose-700"
                : "bg-stone-100 text-stone-600",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="line-clamp-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-stone-500">
          {label}
        </span>
      </div>
      <p className={clsx("text-base font-black leading-tight tabular-nums sm:text-lg", valueClass ?? "text-stone-950")}>
        {value}
      </p>
    </div>
  );
}

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
      <StatCard
        icon={Wallet}
        label={t(lang, "debtsStatOutstanding")}
        value={formatShortUgx(outstandingUgx)}
        highlight
        valueClass="text-waka-700"
      />
      <StatCard icon={Users} label={t(lang, "debtsStatCustomersOwing")} value={String(customersOwing)} />
      <StatCard
        icon={TrendingDown}
        label={collected}
        value={formatShortUgx(collectedUgx)}
        valueClass="text-teal-800"
      />
      <StatCard icon={HandCoins} label={creditSales} value={formatShortUgx(creditSalesUgx)} />
      <StatCard
        icon={AlertTriangle}
        label={t(lang, "debtsStatOverdue")}
        value={String(overdueCount)}
        warn={overdueCount > 0}
        valueClass={overdueCount > 0 ? "text-rose-700" : undefined}
      />
      <StatCard
        icon={Clock}
        label={t(lang, "debtsStatAvgCollection")}
        value={avgCollectionDays != null ? tTemplate(lang, "debtsStatAvgDays", { days: String(avgCollectionDays) }) : "—"}
      />
    </div>
  );
}
