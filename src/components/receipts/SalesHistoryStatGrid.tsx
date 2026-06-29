import clsx from "clsx";
import { HandCoins, Package, TrendingUp, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";

type Props = {
  lang: Language;
  salesLabel: string;
  salesUgx: number;
  profitUgx: number | null;
  showProfit: boolean;
  itemsSold: number;
  totalDebtUgx: number;
  showShopDebt?: boolean;
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  accent?: "orange" | "teal" | "rose" | "stone";
}) {
  const iconBg =
    accent === "orange"
      ? "bg-orange-100 text-orange-700"
      : accent === "teal"
        ? "bg-teal-100 text-teal-700"
        : accent === "rose"
          ? "bg-rose-100 text-rose-700"
          : "bg-stone-100 text-stone-600";
  const valueClass = accent === "orange" ? "text-waka-700" : accent === "teal" ? "text-teal-800" : "text-stone-950";

  return (
    <div className="flex min-h-[76px] flex-col justify-between rounded-xl border border-stone-200/90 bg-white p-2.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", iconBg)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="line-clamp-2 text-[10px] font-bold uppercase leading-tight tracking-wide text-stone-500">
          {label}
        </span>
      </div>
      <p className={clsx("text-lg font-black leading-tight tabular-nums", valueClass)}>{value}</p>
    </div>
  );
}

export function SalesHistoryStatGrid({
  lang,
  salesLabel,
  salesUgx,
  profitUgx,
  showProfit,
  itemsSold,
  totalDebtUgx,
  showShopDebt = true,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
      <StatCard icon={Wallet} label={salesLabel} value={formatUgx(salesUgx)} accent="orange" />
      <StatCard
        icon={TrendingUp}
        label={t(lang, "salesHistoryProfits")}
        value={showProfit && profitUgx != null ? formatUgx(profitUgx) : "—"}
        accent="teal"
      />
      <StatCard icon={Package} label={t(lang, "salesHistoryItemsSold")} value={String(itemsSold)} accent="stone" />
      {showShopDebt ? (
        <StatCard
          icon={HandCoins}
          label={t(lang, "salesHistoryTotalDebts")}
          value={formatUgx(totalDebtUgx)}
          accent="rose"
        />
      ) : (
        <StatCard icon={HandCoins} label={t(lang, "salesHistoryTotalDebts")} value="—" accent="rose" />
      )}
    </div>
  );
}
