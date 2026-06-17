import type { ReactNode } from "react";
import { Clock, ShoppingCart, Wallet } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats } from "../../lib/draftCart";
import { HistoryHeroCard } from "../shared/HistoryHeroCard";

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

export function PosSellHeroCard({
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
  const unitShown =
    Number.isInteger(cartStats.unitCount)
      ? String(cartStats.unitCount)
      : cartStats.unitCount.toFixed(2).replace(/\.?0+$/, "");
  const showPayable = cartHasItems && cartDiscountUgx > 0;
  const cartTotalLabel = showPayable ? t(lang, "payableTotalLabel") : t(lang, "totalLabel");
  const cartTotalValue = showPayable ? payableUgx : cartStats.totalUgx;

  return (
    <HistoryHeroCard
      lang={lang}
      footer={actionFooter}
      metrics={[
        {
          label: cartHasItems ? t(lang, "posCartProductsShort") : sellLabel,
          icon: ShoppingCart,
          value: cartHasItems ? String(cartStats.productCount) : String(todaySaleCount),
          hint: cartHasItems
            ? `${unitShown} ${t(lang, "posCartUnitsShort").toLowerCase()}`
            : t(lang, "salesHistoryTodaySales"),
        },
        {
          label: cartHasItems ? cartTotalLabel : t(lang, "salesHistoryTodaySales"),
          icon: Wallet,
          value: cartHasItems ? `UGX ${cartTotalValue.toLocaleString()}` : `UGX ${todaySalesUgx.toLocaleString()}`,
          hint: cartHasItems
            ? `${cartStats.productCount} ${t(lang, "posCartProductsShort").toLowerCase()}`
            : `${todaySaleCount} ${t(lang, "salesCount").toLowerCase()}`,
        },
        {
          label: t(lang, "pendingSalesLink"),
          icon: Clock,
          value: String(pendingCount),
          hint: pendingCount > 0 ? t(lang, "pendingSalesLink") : "—",
        },
      ]}
    />
  );
}
