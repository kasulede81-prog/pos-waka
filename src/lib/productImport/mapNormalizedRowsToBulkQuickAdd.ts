import { resolveCatalogSectionInput, type CatalogPickerItem } from "../catalogHierarchy";
import { isImportCostProvided } from "./createNormalizedRow";
import type { BulkQuickAddProductRow, NormalizedProductImportRow } from "./types";

export type MapImportRowsOptions = {
  pickerItems?: readonly CatalogPickerItem[];
  generalCategoryLabel?: string;
};

/**
 * Maps review-approved normalized rows to `bulkQuickAddProducts` input.
 * Omits cost when missing so `buildQuickAddProductDraft` applies the 72% fallback.
 */
export function mapNormalizedRowsToBulkQuickAdd(
  rows: readonly NormalizedProductImportRow[],
  options: MapImportRowsOptions = {},
): BulkQuickAddProductRow[] {
  const pickerItems = options.pickerItems ?? [];
  const general = (options.generalCategoryLabel ?? "General").trim() || "General";

  return rows
    .filter((r) => r.enabled)
    .map((row) => {
      const sectionQuery = (row.categoryInput || row.category).trim();
      const resolved = resolveCatalogSectionInput(pickerItems, sectionQuery);
      let category = row.category.trim();
      if (resolved.status === "resolved") category = resolved.category;
      else if (resolved.status === "unresolved") category = resolved.category;
      else if (resolved.status === "empty") category = general;
      if (!category) category = general;

      const payload: BulkQuickAddProductRow = {
        name: row.name.trim(),
        priceUgx: Math.floor(Number(row.sellingPriceUgx) || 0),
        stockQty: Math.max(0, Number(row.stockQty) || 0),
        category,
        inferName: row.name.trim(),
        baseUnit: (row.baseUnit || "piece").trim() || "piece",
        sellingMode: row.sellingMode,
      };

      if (row.buyingUnit !== undefined) payload.buyingUnit = row.buyingUnit;
      if (row.conversionRate != null && Number(row.conversionRate) > 1) {
        payload.conversionRate = Number(row.conversionRate);
      }
      if (row.buyingPackCostUgx != null && Number(row.buyingPackCostUgx) > 0) {
        payload.buyingPackCostUgx = Math.floor(Number(row.buyingPackCostUgx));
      }
      if (isImportCostProvided(row)) {
        payload.costPricePerUnitUgx = Number(row.costPricePerUnitUgx);
      }

      return payload;
    });
}
