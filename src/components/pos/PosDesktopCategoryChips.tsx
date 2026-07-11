import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { CATEGORY_FILTER_ALL } from "../../lib/productCategories";
import type { PosShelfCard } from "../../lib/posShelfOrder";

type Props = {
  lang: Language;
  shelves: PosShelfCard[];
  selectedKey: string;
  onSelect: (key: string) => void;
  canAddProduct?: boolean;
};

const VISIBLE_DESKTOP = 10;

/** Horizontal shelf/category chips for enterprise desktop POS. */
export function PosDesktopCategoryChips({ lang, shelves, selectedKey, onSelect, canAddProduct }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const sorted = useMemo(
    () => [...shelves].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [shelves],
  );

  const visible = sorted.slice(0, VISIBLE_DESKTOP);
  const overflow = sorted.slice(VISIBLE_DESKTOP);

  const chipClass = (active: boolean) =>
    clsx(
      "pos-ds-category-chip inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-black transition-colors",
      active
        ? "border-waka-500 bg-waka-600 text-white shadow-sm"
        : "border-border bg-card text-foreground active:bg-muted",
    );

  return (
    <div className="flex min-h-[2.25rem] items-center gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
      <button type="button" onClick={() => onSelect(CATEGORY_FILTER_ALL)} className={chipClass(selectedKey === CATEGORY_FILTER_ALL)}>
        {t(lang, "posCategoryAll")}
      </button>

      {visible.map((shelf) => (
        <button
          key={shelf.key}
          type="button"
          onClick={() => onSelect(shelf.key)}
          className={chipClass(selectedKey === shelf.key)}
        >
          {shelf.icon ? <span aria-hidden>{shelf.icon}</span> : null}
          {shelf.label}
        </button>
      ))}

      {overflow.length > 0 ? (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={chipClass(moreOpen || overflow.some((s) => s.key === selectedKey))}
            aria-expanded={moreOpen}
          >
            {t(lang, "posDesktopCategoryMore")}
            <ChevronDown className={clsx("h-3.5 w-3.5 transition", moreOpen && "rotate-180")} aria-hidden />
          </button>
          {moreOpen ? (
            <div className="absolute left-0 top-[calc(100%+0.25rem)] z-30 max-h-64 min-w-[10rem] overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {overflow.map((shelf) => (
                <button
                  key={shelf.key}
                  type="button"
                  onClick={() => {
                    onSelect(shelf.key);
                    setMoreOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold",
                    selectedKey === shelf.key ? "bg-waka-50 text-waka-900" : "text-foreground active:bg-muted",
                  )}
                >
                  {shelf.icon ? <span aria-hidden>{shelf.icon}</span> : null}
                  {shelf.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {canAddProduct ? (
        <Link
          to="/stock"
          className="ml-auto inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-waka-300 bg-waka-50 px-3 py-1 text-xs font-black text-waka-900 active:bg-waka-100"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t(lang, "posDesktopAddProduct")}
        </Link>
      ) : null}
    </div>
  );
}
