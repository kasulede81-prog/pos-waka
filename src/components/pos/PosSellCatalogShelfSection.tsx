import { Link } from "react-router-dom";
import clsx from "clsx";
import { Plus } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import { shelfMasonryGridClass } from "../../lib/posShelfLayout";
import { PosShelfTile } from "./PosShelfTile";

type Props = {
  lang: Language;
  shelves: PosShelfDisplayCard[];
  selectedKey: string;
  onShelfTap: (key: string) => void;
  desktop?: boolean;
  canAddShelf?: boolean;
  children?: React.ReactNode;
};

/** Mobile-style shelf catalog grid (icon, name, count) — used on mobile sell and enterprise desktop. */
export function PosSellCatalogShelfSection({
  lang,
  shelves,
  selectedKey,
  onShelfTap,
  desktop = false,
  canAddShelf = false,
  children,
}: Props) {
  return (
    <section className={clsx("space-y-2", desktop && "min-h-0 flex-1 overflow-y-auto overscroll-y-contain")}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
          {t(lang, "posSellCategoryHeading")}
        </p>
        <p className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-600">
          {shelves.length}
        </p>
      </div>
      <div className={shelfMasonryGridClass(!desktop)}>
        {shelves.map((shelf) => (
          <PosShelfTile
            key={shelf.key}
            shelf={shelf}
            lang={lang}
            mode="sell"
            selected={selectedKey === shelf.key}
            countLabel={t(lang, "posShelfProductCount").replace("{{count}}", String(shelf.count))}
            onClick={() => onShelfTap(shelf.key)}
          />
        ))}
        {canAddShelf ? (
          <Link
            to="/settings/shelves"
            className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/80 p-2 text-center shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50/50 active:scale-[0.98] motion-reduce:active:scale-100"
            style={{ gridColumn: "span 1", gridRow: "span 1" }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200/80 text-stone-500">
              <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            </span>
            <span className="mt-1.5 line-clamp-2 w-full text-center text-[10px] font-black leading-tight text-stone-600">
              {t(lang, "posAddShelf")}
            </span>
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
