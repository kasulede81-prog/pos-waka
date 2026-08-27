import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { CATEGORY_FILTER_ALL } from "../../../lib/productCategories";
import type { PosShelfCard } from "../../../lib/posShelfOrder";
import { desktopCategoryShelvesForDisplay } from "../../../lib/desktopCategoryNav";
import { DesktopPosButton } from "./DesktopPosButton";

type Props = {
  lang: Language;
  shelves: PosShelfCard[];
  selectedKey: string;
  onSelect: (key: string) => void;
  className?: string;
  /** Hierarchy ON: keep resolver order. Flag-off remains A–Z. */
  preserveOrder?: boolean;
  /** Hierarchy nested: show Back instead of All. */
  showBack?: boolean;
  onBack?: () => void;
  /** Root / flag-off: show All. Nested hierarchy hides All. */
  showAll?: boolean;
};

/** Vertical category rail for Electron desktop POS — current-level siblings only, never a tree. */
export function DesktopCategoryRail({
  lang,
  shelves,
  selectedKey,
  onSelect,
  className,
  preserveOrder = false,
  showBack = false,
  onBack,
  showAll = true,
}: Props) {
  const displayed = desktopCategoryShelvesForDisplay(shelves, preserveOrder);

  return (
    <nav
      className={clsx("desktop-pos-category-rail flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-y-contain p-1.5", className)}
      aria-label={t(lang, "posSellLandingShelves")}
    >
      {showBack ? (
        <DesktopPosButton
          size="md"
          variant="default"
          className="w-full justify-start px-3 text-left"
          onClick={() => onBack?.()}
        >
          ← {t(lang, "posSellCategoryHeading")}
        </DesktopPosButton>
      ) : null}
      {showAll ? (
        <DesktopPosButton
          size="md"
          variant="default"
          selected={selectedKey === CATEGORY_FILTER_ALL}
          className="w-full justify-start px-3 text-left"
          onClick={() => onSelect(CATEGORY_FILTER_ALL)}
        >
          {t(lang, "posCategoryAll")}
        </DesktopPosButton>
      ) : null}
      {displayed.map((shelf) => (
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
