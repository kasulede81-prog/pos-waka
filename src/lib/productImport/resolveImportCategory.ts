import type { CatalogPickerItem } from "../catalogHierarchy";
import { resolveCatalogSectionInput } from "../catalogHierarchy";
import type { NormalizedProductImportRow } from "./types";

export type ImportCategoryContext = {
  pickerItems: readonly CatalogPickerItem[];
  /** When true and destinations exist, empty section is a blocking error (wizard Next rule). */
  requireCategoryWhenDestinationsExist?: boolean;
};

export function applyCategoryResolutionToRow(
  row: NormalizedProductImportRow,
  pickerItems: readonly CatalogPickerItem[],
): NormalizedProductImportRow {
  const resolved = resolveCatalogSectionInput(pickerItems, row.categoryInput || row.category);
  if (resolved.status === "resolved") {
    return { ...row, category: resolved.category };
  }
  if (resolved.status === "unresolved") {
    return { ...row, category: resolved.category };
  }
  if (resolved.status === "empty") {
    return { ...row, category: "" };
  }
  return { ...row, category: "" };
}

export function destinationsExist(pickerItems: readonly CatalogPickerItem[]): boolean {
  return pickerItems.length > 0;
}
