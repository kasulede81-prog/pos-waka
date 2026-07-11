import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import { shelfMasonryGridClass } from "../../lib/posShelfLayout";
import { PosShelfTile } from "./PosShelfTile";

type Props = {
  lang: Language;
  shelves: PosShelfDisplayCard[];
  onShelfTap: (key: string) => void;
  /** @deprecated Parent scroll pane handles overflow — kept for call-site compatibility. */
  desktop?: boolean;
};

/** Mobile-style shelf catalog grid — used on mobile sell and full desktop sell. */
export function PosSellCatalogShelfSection({
  lang,
  shelves,
  onShelfTap,
}: Props) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
          {t(lang, "posSellCategoryHeading")}
        </p>
        <p className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
          {shelves.length}
        </p>
      </div>
      <div className={shelfMasonryGridClass(true)}>
        {shelves.map((shelf) => (
          <PosShelfTile
            key={shelf.key}
            shelf={shelf}
            lang={lang}
            mode="sell"
            sellFocus
            emptyShelf={shelf.count === 0}
            countLabel={
              shelf.count === 0
                ? t(lang, "shelfEmptyRestockLabel")
                : t(lang, "posShelfProductCount").replace("{{count}}", String(shelf.count))
            }
            onClick={() => onShelfTap(shelf.key)}
          />
        ))}
      </div>
    </section>
  );
}
