import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { shelfIconFor } from "../../lib/productCategories";
import { UNCATEGORIZED_SENTINEL } from "../../lib/productCategories";

type ShelfFolder = {
  key: string;
  label: string;
  count: number;
};

type Props = {
  lang: Language;
  shelves: ShelfFolder[];
  selectedShelf: string | null;
  canArrangeShelves: boolean;
  onSelectShelf: (key: string) => void;
  onBack: () => void;
  shelfDetailHeader?: ReactNode;
  children?: ReactNode;
};

export function StockShelfGrid({
  lang,
  shelves,
  selectedShelf,
  canArrangeShelves,
  onSelectShelf,
  onBack,
  shelfDetailHeader,
  children,
}: Props) {
  if (selectedShelf) {
    const label =
      selectedShelf === UNCATEGORIZED_SENTINEL ? t(lang, "uncategorized") : selectedShelf;
    const icon = shelfIconFor(label) ?? "📦";
    return (
      <section className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-bold text-waka-800 active:opacity-70"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t(lang, "stockShelfBack")}
        </button>
        <div className="flex items-center gap-2.5 rounded-xl border border-stone-200/90 bg-white px-3 py-2.5 shadow-sm">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xl leading-none">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-black text-stone-950">{label}</h2>
            <p className="text-xs font-semibold text-stone-500">
              {tTemplate(lang, "stockShelfProductCount", {
                count: String(shelves.find((s) => s.key === selectedShelf)?.count ?? 0),
              })}
            </p>
          </div>
        </div>
        {shelfDetailHeader}
        {children}
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
          {t(lang, "stockTabShelves")}
        </p>
        {canArrangeShelves ? (
          <Link
            to="/settings/shelves"
            className="text-[10px] font-bold text-waka-700 underline decoration-waka-300 underline-offset-2"
          >
            {t(lang, "posArrangeShelves")}
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
        {shelves.map((shelf) => {
          const icon = shelfIconFor(shelf.label) ?? "📦";
          return (
            <button
              key={shelf.key}
              type="button"
              onClick={() => onSelectShelf(shelf.key)}
              className={clsx(
                "flex min-h-[88px] flex-col items-center justify-center rounded-xl border border-stone-200/90 bg-white p-2.5 text-center shadow-sm",
                "transition-all active:scale-[0.97] active:border-waka-300 active:shadow-md motion-reduce:active:scale-100",
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-lg leading-none">
                {icon}
              </span>
              <span className="mt-1.5 line-clamp-2 w-full text-xs font-black leading-tight text-stone-950">
                {shelf.label}
              </span>
              <span className="mt-0.5 text-[10px] font-semibold text-stone-500">
                {tTemplate(lang, "stockShelfProductCount", { count: String(shelf.count) })}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
