import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ProfitProductView } from "../../lib/profitPageView";
import { formatShortUgx, LOW_MARGIN_THRESHOLD_PCT } from "../../lib/profitPageView";

type Props = {
  lang: Language;
  products: ProfitProductView[];
  onProductClick: (product: ProfitProductView) => void;
};

export function ProfitLowMarginList({ lang, products, onProductClick }: Props) {
  const lowMargin = products.filter((p) => p.profitUgx >= 0 && p.marginPct < LOW_MARGIN_THRESHOLD_PCT && p.salesUgx > 0);
  const lossMaking = products.filter((p) => p.profitUgx < 0);

  if (lowMargin.length === 0 && lossMaking.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200/80 bg-amber-50/30 shadow-sm">
      <div className="border-b border-amber-100 px-3 py-2.5">
        <h3 className="text-xs font-black text-amber-950">{t(lang, "profitLowMarginTitle")}</h3>
        <p className="mt-0.5 text-[10px] font-medium text-amber-900/80">{t(lang, "profitLowMarginHint")}</p>
      </div>
      <ul className="divide-y divide-amber-100/80">
        {lowMargin.map((p) => (
          <li key={`low-${p.productId}-${p.name}`}>
            <button
              type="button"
              onClick={() => onProductClick(p)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left active:bg-amber-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">
                  <span className="mr-1">⚠</span>
                  {p.name}
                </p>
                <p className="text-[10px] font-semibold text-muted-foreground">
                  {t(lang, "profitStatMargin")} {p.marginPct.toFixed(1)}%
                </p>
              </div>
              <p className="shrink-0 text-sm font-black tabular-nums text-teal-800">{formatShortUgx(p.profitUgx)}</p>
            </button>
          </li>
        ))}
        {lossMaking.map((p) => (
          <li key={`loss-${p.productId}-${p.name}`}>
            <button
              type="button"
              onClick={() => onProductClick(p)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left active:bg-rose-50/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-rose-900">
                  <span className="mr-1">🔴</span>
                  {t(lang, "profitSellingAtLoss")}
                </p>
                <p className="truncate text-[10px] font-semibold text-muted-foreground">{p.name}</p>
              </div>
              <p className={clsx("shrink-0 text-sm font-black tabular-nums text-rose-700")}>
                {formatShortUgx(p.profitUgx)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
