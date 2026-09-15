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
    <article className="rounded-2xl border border-border/90 bg-card p-2.5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-black text-muted-foreground">
          {productInitials(product.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-foreground">{product.name}</p>
              <p className="truncate text-[10px] font-semibold text-muted-foreground">{product.shelfLabel}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(product)}
              className="flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground active:bg-muted"
              aria-label={t(lang, "salesHistoryMoreActions")}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] font-bold">
            <span className="text-muted-foreground">{t(lang, "profitPageSoldFor")}</span>
            <span className="text-right tabular-nums text-foreground">{formatShortUgx(product.salesUgx)}</span>
            <span className="text-muted-foreground">{t(lang, "profitStatNetProfit")}</span>
            <span className={clsx("text-right tabular-nums", loss ? "text-rose-700" : "text-teal-800")}>
              {formatShortUgx(product.profitUgx)}
            </span>
            <span className="text-muted-foreground">{t(lang, "profitStatMargin")}</span>
            <span className={clsx("text-right tabular-nums", loss ? "text-rose-700" : "text-teal-800")}>
              {product.marginPct.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">{t(lang, "profitPageQtySold")}</span>
            <span className="text-right tabular-nums text-foreground">{product.qty.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
