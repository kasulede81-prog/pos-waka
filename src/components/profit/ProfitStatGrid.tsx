import clsx from "clsx";
import { Award, Package, ShoppingCart, Star, TrendingUp, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatShortUgx } from "../../lib/profitPageView";

type Props = {
  lang: Language;
  netProfitUgx: number;
  revenueUgx: number;
  costUgx: number;
  marginPct: number;
  bestShelf: string | null;
  bestProduct: string | null;
};

function StatCard({
  icon: Icon,
  label,
  value,
  highlight,
  valueClass,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  highlight?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={clsx(
        "flex min-h-[76px] flex-col justify-between rounded-2xl border p-2.5 shadow-sm",
        highlight ? "border-waka-300 bg-gradient-to-br from-waka-50 to-waka-50/80" : "border-stone-200/90 bg-white",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            highlight ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-600",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="line-clamp-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-stone-500">
          {label}
        </span>
      </div>
      <p className={clsx("truncate text-base font-black leading-tight tabular-nums sm:text-lg", valueClass ?? "text-stone-950")}>
        {value}
      </p>
    </div>
  );
}

export function ProfitStatGrid({
  lang,
  netProfitUgx,
  revenueUgx,
  costUgx,
  marginPct,
  bestShelf,
  bestProduct,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
      <StatCard
        icon={TrendingUp}
        label={t(lang, "profitStatNetProfit")}
        value={formatShortUgx(netProfitUgx)}
        highlight
        valueClass={netProfitUgx >= 0 ? "text-waka-700" : "text-rose-700"}
      />
      <StatCard icon={ShoppingCart} label={t(lang, "profitStatRevenue")} value={formatShortUgx(revenueUgx)} />
      <StatCard icon={Package} label={t(lang, "profitStatCost")} value={formatShortUgx(costUgx)} valueClass="text-stone-800" />
      <StatCard
        icon={Wallet}
        label={t(lang, "profitStatMargin")}
        value={`${marginPct.toFixed(1)}%`}
        valueClass={marginPct >= 0 ? "text-teal-800" : "text-rose-700"}
      />
      <StatCard icon={Award} label={t(lang, "profitStatBestShelf")} value={bestShelf ?? "—"} valueClass="text-sm sm:text-base" />
      <StatCard icon={Star} label={t(lang, "profitStatBestProduct")} value={bestProduct ?? "—"} valueClass="text-sm sm:text-base" />
    </div>
  );
}
