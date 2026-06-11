import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats } from "../../lib/draftCart";

type Props = {
  lang: Language;
  stats: DraftCartStats;
  compact?: boolean;
  payableUgx?: number;
  cartDiscountUgx?: number;
};

export function DraftCartSummary({ lang, stats, compact, payableUgx, cartDiscountUgx = 0 }: Props) {
  const unitShown =
    Number.isInteger(stats.unitCount) ? String(stats.unitCount) : stats.unitCount.toFixed(2).replace(/\.?0+$/, "");
  const showPayable = payableUgx != null && cartDiscountUgx > 0;
  const totalLabel = showPayable ? t(lang, "payableTotalLabel") : t(lang, "totalLabel");
  const totalValue = showPayable ? payableUgx : stats.totalUgx;

  if (compact) {
    return (
      <p className="text-xs font-bold text-stone-600">
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
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posCartProductsShort")}</p>
          <p className="text-2xl font-black tabular-nums text-slate-900">{stats.productCount}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posCartUnitsShort")}</p>
          <p className="text-2xl font-black tabular-nums text-slate-900">{unitShown}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{totalLabel}</p>
          <p className="text-lg font-black tabular-nums text-waka-700">UGX {totalValue.toLocaleString()}</p>
        </div>
      </div>
      {showPayable ? (
        <p className="mt-2 text-center text-xs font-semibold text-slate-500">
          {t(lang, "cartDiscountOriginal")}: UGX {stats.totalUgx.toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
