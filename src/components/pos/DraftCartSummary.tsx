import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats } from "../../lib/draftCart";

type Props = {
  lang: Language;
  stats: DraftCartStats;
  compact?: boolean;
  /** Single-line stats bar for mobile checkout dock. */
  dock?: boolean;
  /** Desktop sidebar — tighter summary bar. */
  sidebarCompact?: boolean;
  payableUgx?: number;
  cartDiscountUgx?: number;
};

export function DraftCartSummary({ lang, stats, compact, dock, sidebarCompact, payableUgx, cartDiscountUgx = 0 }: Props) {
  const unitShown =
    Number.isInteger(stats.unitCount) ? String(stats.unitCount) : stats.unitCount.toFixed(2).replace(/\.?0+$/, "");
  const showPayable = payableUgx != null && cartDiscountUgx > 0;
  const totalLabel = showPayable ? t(lang, "payableTotalLabel") : t(lang, "totalLabel");
  const totalValue = showPayable ? payableUgx : stats.totalUgx;

  if (dock) {
    return (
      <div
        className={clsx(
          "flex items-center justify-between gap-2 rounded-lg border border-waka-200 bg-waka-50/90 font-bold text-muted-foreground",
          sidebarCompact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
        )}
      >
        <span>
          {stats.productCount} {t(lang, "posCartProductsShort").toLowerCase()} · {unitShown}{" "}
          {t(lang, "posCartUnitsShort").toLowerCase()}
        </span>
        <span className="shrink-0 font-black text-waka-700">
          {totalLabel}: UGX {totalValue.toLocaleString()}
        </span>
      </div>
    );
  }

  if (compact) {
    return (
      <p className="text-xs font-bold text-muted-foreground">
        {t(lang, "posCartProducts").replace("{{count}}", String(stats.productCount))}
        {" · "}
        {t(lang, "posCartUnits").replace("{{count}}", unitShown)}
        {showPayable ? (
          <>
            {" · "}
            {t(lang, "payableTotalLabel")}: UGX {payableUgx.toLocaleString()}
          </>
        ) : null}
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-waka-200 bg-waka-50/80 p-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "posCartProductsShort")}</p>
          <p className="text-2xl font-black tabular-nums text-foreground">{stats.productCount}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "posCartUnitsShort")}</p>
          <p className="text-2xl font-black tabular-nums text-foreground">{unitShown}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{totalLabel}</p>
          <p className="text-lg font-black tabular-nums text-waka-700">UGX {totalValue.toLocaleString()}</p>
        </div>
      </div>
      {showPayable ? (
        <p className="mt-2 text-center text-xs font-semibold text-muted-foreground">
          {t(lang, "cartDiscountOriginal")}: UGX {stats.totalUgx.toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
