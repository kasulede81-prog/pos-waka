import { useState } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../lib/sellingEngine";
import { normalizedCategoryKey } from "../../lib/productCategories";

type RowAction =
  | "edit"
  | "add10"
  | "add1"
  | "sold1"
  | "damaged1"
  | "home1"
  | "duplicate"
  | "remove"
  | "sell";

type Props = {
  lang: Language;
  product: Product;
  locked: boolean;
  canAdd: boolean;
  canAdjust: boolean;
  canRemove: boolean;
  canSell: boolean;
  onAction: (action: RowAction) => void;
};

export function StockProductCard({
  lang,
  product: p,
  locked,
  canAdd,
  canAdjust,
  canRemove,
  canSell,
  onAction,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const low = isLowStock(p);
  const shelf = normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized");

  const moreActions: { id: RowAction; labelKey: string; show: boolean }[] = [
    { id: "add10", labelKey: "stockActionAdd10", show: canAdjust },
    { id: "sold1", labelKey: "stockActionSold1", show: canAdjust },
    { id: "damaged1", labelKey: "stockActionDamaged1", show: canAdjust },
    { id: "home1", labelKey: "stockActionHome1", show: canAdjust },
    { id: "duplicate", labelKey: "stockActionDuplicate", show: canAdd },
    { id: "remove", labelKey: "stockActionRemove", show: canRemove },
    { id: "sell", labelKey: "stockActionOpenSell", show: canSell },
  ];

  const visibleMore = moreActions.filter((a) => a.show);

  return (
    <li
      className={`rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ${locked ? "opacity-55" : ""}`}
    >
      <button
        type="button"
        disabled={locked || !canAdd}
        onClick={() => onAction("edit")}
        className="flex w-full items-start gap-3 text-left disabled:cursor-default"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-black leading-snug text-slate-900">{p.name}</p>
            {locked ? (
              <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                {t(lang, "productLockedBadge")}
              </span>
            ) : null}
            {low && !locked ? (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase text-rose-800">
                {t(lang, "cardLowStock")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {shelf} · {formatProductPriceLabel(p)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="text-right">
            <p className="text-sm font-black text-slate-800">{formatStockLabel(p)}</p>
          </div>
          {canAdd && !locked ? <ChevronRight className="h-5 w-5 text-slate-400" aria-hidden /> : null}
        </div>
      </button>

      {!locked ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {canAdd ? (
            <button
              type="button"
              onClick={() => onAction("edit")}
              className="min-h-[40px] flex-1 rounded-xl border-2 border-waka-200 bg-waka-50 px-3 py-2 text-sm font-black text-waka-900 active:bg-waka-100 sm:flex-none sm:px-4"
            >
              {t(lang, "stockActionEditDetails")}
            </button>
          ) : null}
          {canAdjust ? (
            <button
              type="button"
              onClick={() => onAction("add1")}
              className="min-h-[40px] rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 active:bg-slate-50"
            >
              +1
            </button>
          ) : null}
          {visibleMore.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex min-h-[40px] min-w-[44px] items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-slate-700 active:bg-slate-50"
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden />
                <span className="sr-only">{t(lang, "stockMoreActions")}</span>
              </button>
              {menuOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-label={t(lang, "cancel")}
                    onClick={() => setMenuOpen(false)}
                  />
                  <ul
                    role="menu"
                    className="absolute right-0 top-[calc(100%+0.35rem)] z-20 min-w-[11rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    {visibleMore.map((a) => (
                      <li key={a.id} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-4 py-2.5 text-left text-sm font-bold text-slate-800 hover:bg-slate-50"
                          onClick={() => {
                            setMenuOpen(false);
                            onAction(a.id);
                          }}
                        >
                          {t(lang, a.labelKey)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
