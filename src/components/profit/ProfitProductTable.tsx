import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ProfitProductView } from "../../lib/profitPageView";
import { formatShortUgx } from "../../lib/profitPageView";

type Props = {
  lang: Language;
  products: ProfitProductView[];
  onOpen: (product: ProfitProductView) => void;
};

export function ProfitProductTable({ lang, products, onOpen }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-sm">
      <table className="w-full text-left">
        <thead className="bg-muted/60">
          <tr className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2">
              {t(lang, "profitTopProducts")}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {t(lang, "profitStatRevenue")}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {t(lang, "profitStatCost")}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {t(lang, "profitStatGrossProfit")}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {t(lang, "profitStatMargin")}
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const loss = p.profitUgx < 0;
            return (
              <tr key={`${p.productId}-${p.name}`} className="border-t border-border/70 hover:bg-muted/40">
                <td className="max-w-[18rem] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpen(p)}
                    className="block w-full truncate text-left text-sm font-black text-foreground underline-offset-2 hover:underline"
                  >
                    {p.name}
                  </button>
                  <span className="block truncate text-[10px] font-semibold text-muted-foreground">{p.shelfLabel}</span>
                </td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-foreground">
                  {formatShortUgx(p.salesUgx)}
                </td>
                <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-muted-foreground">
                  {formatShortUgx(p.costUgx)}
                </td>
                <td
                  className={clsx(
                    "px-3 py-2 text-right text-sm font-black tabular-nums",
                    loss ? "text-rose-700" : "text-teal-800",
                  )}
                >
                  {formatShortUgx(p.profitUgx)}
                </td>
                <td
                  className={clsx(
                    "px-3 py-2 text-right text-sm font-bold tabular-nums",
                    loss ? "text-rose-700" : "text-teal-800",
                  )}
                >
                  {p.marginPct.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
