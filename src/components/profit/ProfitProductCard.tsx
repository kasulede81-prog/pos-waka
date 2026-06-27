import { MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ProfitProductView } from "../../lib/profitPageView";
import { formatShortUgx, productInitials } from "../../lib/profitPageView";

type Props = {
  lang: Language;
  product: ProfitProductView;
  onOpen: (product: ProfitProductView) => void;
};

export function ProfitProductCard({ lang, product, onOpen }: Props) {
  const loss = product.profitUgx < 0;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-2.5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xs font-black text-stone-700">
          {productInitials(product.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-stone-950">{product.name}</p>
              <p className="truncate text-[10px] font-semibold text-stone-500">{product.shelfLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(product)}
              className="flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-600 active:bg-stone-50"
              aria-label={t(lang, "salesHistoryMoreActions")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-bold">
            <span className="text-stone-500">{t(lang, "profitPageSoldFor")}</span>
            <span className="text-right tabular-nums text-stone-800">{formatShortUgx(product.salesUgx)}</span>
            <span className="text-stone-500">{t(lang, "profitStatNetProfit")}</span>
            <span className={clsx("text-right tabular-nums", loss ? "text-rose-700" : "text-teal-800")}>
              {formatShortUgx(product.profitUgx)}
            </span>
            <span className="text-stone-500">{t(lang, "profitStatMargin")}</span>
            <span className={clsx("text-right tabular-nums", loss ? "text-rose-700" : "text-teal-800")}>
              {product.marginPct.toFixed(1)}%
            </span>
            <span className="text-stone-500">{t(lang, "profitPageQtySold")}</span>
            <span className="text-right tabular-nums text-stone-800">{product.qty.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
