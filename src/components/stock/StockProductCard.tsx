import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { formatProductPriceLabel } from "../../store/usePosStore";
import { formatStockLabel, isLowStock } from "../../lib/sellingEngine";
import { normalizedCategoryKey, shelfIconFor } from "../../lib/productCategories";

type RowAction = "edit" | "sell" | "restock" | "duplicate" | "remove";

type Props = {
  lang: Language;
  product: Product;
  locked: boolean;
  canAdd: boolean;
  canRemove: boolean;
  canSell: boolean;
  canRestock: boolean;
  onAction: (action: RowAction) => void;
};

export function StockProductCard({
  lang,
  product: p,
  locked,
  canAdd,
  canRemove,
  canSell,
  canRestock,
  onAction,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const low = isLowStock(p);
  const shelf = normalizedCategoryKey(p) ? p.category!.trim() : t(lang, "uncategorized");
  const shelfIcon = shelfIconFor(shelf);

  return (
    <li
      className={`rounded-[1.35rem] border border-slate-200/90 bg-white p-4 shadow-sm ${locked ? "opacity-55" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-black leading-snug text-slate-900">{p.name}</p>
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
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {shelfIcon ? <span className="mr-1">{shelfIcon}</span> : null}
          {shelf}
        </p>
        <p className="mt-2 text-sm font-black leading-snug text-slate-700">{formatStockLabel(p)}</p>
        <p className="mt-1 text-base font-black text-waka-700">{formatProductPriceLabel(p)}</p>
      </div>

      {!locked ? (
        <div className="mt-4 flex gap-2">
          {canSell ? (
            <button
              type="button"
              onClick={() => onAction("sell")}
              className="min-h-[44px] flex-1 rounded-2xl bg-waka-600 px-3 text-sm font-black text-white active:bg-waka-700"
            >
              {t(lang, "stockCardSell")}
            </button>
          ) : null}
          {canAdd ? (
            <button
              type="button"
              onClick={() => onAction("edit")}
              className="min-h-[44px] flex-1 rounded-2xl border-2 border-waka-200 bg-waka-50 px-3 text-sm font-black text-waka-900"
            >
              {t(lang, "stockCardEdit")}
            </button>
          ) : null}
          <div className="relative">
            <button
              type="button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-2xl border-2 border-slate-200 bg-white text-slate-700"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="sr-only">{t(lang, "stockMoreActions")}</span>
            </button>
            {menuOpen ? (
              <>
                <button type="button" className="fixed inset-0 z-10" aria-label={t(lang, "cancel")} onClick={() => setMenuOpen(false)} />
                <ul className="absolute right-0 top-[calc(100%+0.35rem)] z-20 min-w-[10rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {canRestock ? (
                    <li>
                      <button
                        type="button"
                        className="block w-full px-4 py-2.5 text-left text-sm font-bold text-slate-800"
                        onClick={() => {
                          setMenuOpen(false);
                          onAction("restock");
                        }}
                      >
                        {t(lang, "stockGoRestock")}
                      </button>
                    </li>
                  ) : null}
                  {canAdd ? (
                    <li>
                      <button
                        type="button"
                        className="block w-full px-4 py-2.5 text-left text-sm font-bold text-slate-800"
                        onClick={() => {
                          setMenuOpen(false);
                          onAction("duplicate");
                        }}
                      >
                        {t(lang, "stockActionDuplicate")}
                      </button>
                    </li>
                  ) : null}
                  {canRemove ? (
                    <li>
                      <button
                        type="button"
                        className="block w-full px-4 py-2.5 text-left text-sm font-bold text-rose-800"
                        onClick={() => {
                          setMenuOpen(false);
                          onAction("remove");
                        }}
                      >
                        {t(lang, "stockActionRemove")}
                      </button>
                    </li>
                  ) : null}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
