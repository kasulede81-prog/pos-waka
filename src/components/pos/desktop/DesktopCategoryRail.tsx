import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { CATEGORY_FILTER_ALL } from "../../../lib/productCategories";
import type { PosShelfCard } from "../../../lib/posShelfOrder";
import { DesktopPosButton } from "./DesktopPosButton";

type Props = {
  lang: Language;
  shelves: PosShelfCard[];
  selectedKey: string;
  onSelect: (key: string) => void;
  className?: string;
};

/** Vertical category rail for Electron desktop POS — touch-first shelf picker. */
export function DesktopCategoryRail({ lang, shelves, selectedKey, onSelect, className }: Props) {
  const sorted = [...shelves].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  return (
    <nav
      className={clsx("desktop-pos-category-rail flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-y-contain p-1.5", className)}
      aria-label={t(lang, "posSellLandingShelves")}
    >
      <DesktopPosButton
        size="md"
        variant="default"
        selected={selectedKey === CATEGORY_FILTER_ALL}
        className="w-full justify-start px-3 text-left"
        onClick={() => onSelect(CATEGORY_FILTER_ALL)}
      >
        {t(lang, "posCategoryAll")}
      </DesktopPosButton>
      {sorted.map((shelf) => (
        <DesktopPosButton
          key={shelf.key}
          size="md"
          variant="default"
          selected={selectedKey === shelf.key}
          className="w-full justify-start gap-2 px-3 text-left"
          onClick={() => onSelect(shelf.key)}
        >
          {shelf.icon ? <span className="shrink-0 text-base" aria-hidden>{shelf.icon}</span> : null}
          <span className="truncate">{shelf.label}</span>
        </DesktopPosButton>
      ))}
    </nav>
  );
}
