import { CATEGORY_FILTER_ALL } from "./productCategories";
import type { PosShelfCard } from "./posShelfOrder";

/** Flag-off desktop rail/chips: A–Z by label. Do not use this for hierarchy children. */
export function sortDesktopCategoryShelvesAz<T extends Pick<PosShelfCard, "label">>(shelves: readonly T[]): T[] {
  return [...shelves].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/**
 * Desktop current-rank list.
 * Flag-off keeps A–Z. Flag-on keeps resolver/CatalogNode.sortOrder (preserveOrder).
 */
export function desktopCategoryShelvesForDisplay<T extends Pick<PosShelfCard, "label">>(
  shelves: readonly T[],
  preserveOrder: boolean,
): T[] {
  return preserveOrder ? [...shelves] : sortDesktopCategoryShelvesAz(shelves);
}

/** Mobile H2b + desktop H2c catalog tiles/path. Compact tablet stays on the legacy shelf path. */
export function isSellHierarchyCatalogNav(args: {
  catalogHierarchyEnabled: boolean;
  searchQueryLength: number;
  mobileSellFocus: boolean;
  isDesktopCatalogUi: boolean;
}): boolean {
  return (
    args.catalogHierarchyEnabled === true &&
    args.searchQueryLength === 0 &&
    (args.mobileSellFocus || args.isDesktopCatalogUi)
  );
}

export type DesktopCategoryRailModel = {
  shelves: PosShelfCard[];
  preserveOrder: boolean;
  showAll: boolean;
  showBack: boolean;
  /** Empty when nested — destinations are current-level children, not the open folder. */
  selectedKey: string;
};

/**
 * Flat current-level rail. Never a recursive tree.
 * Flag-off: All + A–Z legacy shelves. Flag-on: All at root, Back + resolver children when nested.
 */
export function desktopCategoryRailModel(input: {
  hierarchyEnabled: boolean;
  atRoot: boolean;
  sellCategoryKey: string;
  hierarchyFolderCards: readonly PosShelfCard[];
  legacyShelfCards: readonly PosShelfCard[];
}): DesktopCategoryRailModel {
  if (input.hierarchyEnabled !== true) {
    return {
      shelves: [...input.legacyShelfCards],
      preserveOrder: false,
      showAll: true,
      showBack: false,
      selectedKey: input.sellCategoryKey,
    };
  }
  const nested = !input.atRoot;
  return {
    shelves: [...input.hierarchyFolderCards],
    preserveOrder: true,
    showAll: !nested,
    showBack: nested,
    selectedKey: nested ? "" : CATEGORY_FILTER_ALL,
  };
}
