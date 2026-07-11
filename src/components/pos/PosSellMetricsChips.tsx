import type { ReactNode } from "react";
import { Clock, ShoppingCart, Wallet } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats } from "../../lib/draftCart";

type Props = {
  lang: Language;
  sellLabel: string;
  cartStats: DraftCartStats;
  cartHasItems: boolean;
  payableUgx: number;
  cartDiscountUgx: number;
  todaySaleCount: number;
  todaySalesUgx: number;
  pendingCount: number;
  actionFooter?: ReactNode;
};

export function PosSellMetricsChips({
  lang,
  sellLabel,
  cartStats,
  cartHasItems,
  payableUgx,
  cartDiscountUgx,
  todaySaleCount,
  todaySalesUgx,
  pendingCount,
  actionFooter,
}: Props) {
  const showPayable = cartHasItems && cartDiscountUgx > 0;
  const cartTotalLabel = showPayable ? t(lang, "payableTotalLabel") : t(lang, "totalLabel");
  const cartTotalValue = showPayable ? payableUgx : cartStats.totalUgx;

  const chips = cartHasItems
    ? [
        {
          icon: ShoppingCart,
          label: `${cartStats.productCount} ${t(lang, "posCartProductsShort").toLowerCase()}`,
          value: cartTotalLabel,
          accent: "text-waka-800",
        },
        {
          icon: Wallet,
          label: cartTotalLabel,
          value: `UGX ${cartTotalValue.toLocaleString()}`,
          accent: "text-emerald-800",
        },
        {
          icon: Clock,
          label: t(lang, "pendingSalesLink"),
          value: String(pendingCount),
          accent: pendingCount > 0 ? "text-amber-800" : "text-muted-foreground",
        },
      ]
    : [
        {
          icon: ShoppingCart,
          label: sellLabel,
          value: String(todaySaleCount),
          accent: "text-waka-800",
        },
        {
          icon: Wallet,
          label: t(lang, "salesHistoryTodaySales"),
          value: `UGX ${todaySalesUgx.toLocaleString()}`,
          accent: "text-emerald-800",
        },
        {
          icon: Clock,
          label: t(lang, "pendingSalesLink"),
          value: String(pendingCount),
          accent: pendingCount > 0 ? "text-amber-800" : "text-muted-foreground",
        },
      ];

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
        {chips.map((chip, i) => {
          const Icon = chip.icon;
          return (
            <div
              key={i}
              className="flex min-w-[5.5rem] shrink-0 items-center gap-1.5 rounded-xl border border-border/90 bg-card px-2.5 py-1.5 shadow-sm"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className={clsx("h-3.5 w-3.5", chip.accent)} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{chip.label}</p>
                <p className={clsx("truncate text-xs font-black leading-tight", chip.accent)}>{chip.value}</p>
              </div>
            </div>
          );
        })}
      </div>
      {actionFooter ? <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5">{actionFooter}</div> : null}
    </div>
  );
}
