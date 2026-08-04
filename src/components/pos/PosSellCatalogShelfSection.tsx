import { useRef } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import { shelfMasonryGridClass } from "../../lib/posShelfLayout";
import { shelfGridTemplateColumns } from "../../lib/posShelfGridColumns";
import { formatShelfProductCountLabel } from "../../lib/posShelfDisplayLabel";
import { useShelfGridColumns } from "../../hooks/useShelfGridColumns";
import { PosShelfTile } from "./PosShelfTile";

type Props = {
  lang: Language;
  shelves: PosShelfDisplayCard[];
  onShelfTap: (key: string) => void;
  /** @deprecated Parent scroll pane handles overflow — kept for call-site compatibility. */
  desktop?: boolean;
};

/** Shared shelf catalog grid — container-aware columns (Phase 32.3). */
export function PosSellCatalogShelfSection({ lang, shelves, onShelfTap }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columnCount = useShelfGridColumns(gridRef);

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
      <div
        ref={gridRef}
        className={shelfMasonryGridClass(true)}
        style={{ gridTemplateColumns: shelfGridTemplateColumns(columnCount) }}
        data-shelf-columns={columnCount}
      >
        {shelves.map((shelf) => (
          <PosShelfTile
            key={shelf.key}
            shelf={shelf}
            lang={lang}
            mode="sell"
            sellFocus
            colorTone="soft"
            emptyShelf={shelf.count === 0}
            countLabel={
              shelf.count === 0
                ? t(lang, "shelfEmptyRestockLabel")
                : formatShelfProductCountLabel(lang, shelf.count)
            }
            onClick={() => onShelfTap(shelf.key)}
          />
        ))}
      </div>
    </section>
  );
}
