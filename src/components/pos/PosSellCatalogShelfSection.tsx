import clsx from "clsx";
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
  children?: React.ReactNode;
};

/** Mobile-style shelf catalog grid (icon, name, count) — used on mobile sell and enterprise desktop. */
export function PosSellCatalogShelfSection({
  lang,
  shelves,
  selectedKey,
  onShelfTap,
  desktop = false,
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
      </div>
      {children}
    </section>
  );
}
