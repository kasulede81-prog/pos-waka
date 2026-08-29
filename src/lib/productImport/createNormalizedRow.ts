import type { NormalizedProductImportRow, ProductImportSource } from "./types";

export function newImportClientId(): string {
  return crypto.randomUUID();
}

export function createNormalizedProductImportRow(
  partial: Partial<NormalizedProductImportRow> & Pick<NormalizedProductImportRow, "name" | "sellingPriceUgx">,
  source: ProductImportSource = "manual",
): NormalizedProductImportRow {
  return {
    clientId: partial.clientId ?? newImportClientId(),
    source: partial.source ?? source,
    enabled: partial.enabled ?? true,
    name: partial.name,
    categoryInput: partial.categoryInput ?? partial.category ?? "",
    category: partial.category ?? "",
    baseUnit: (partial.baseUnit ?? "piece").trim() || "piece",
    sellingMode: partial.sellingMode,
    buyingUnit: partial.buyingUnit,
    conversionRate: partial.conversionRate,
    stockQty: Math.max(0, Number(partial.stockQty) || 0),
    sellingPriceUgx: Math.max(0, Math.floor(Number(partial.sellingPriceUgx) || 0)),
    costPricePerUnitUgx: partial.costPricePerUnitUgx,
    buyingPackCostUgx: partial.buyingPackCostUgx,
    sourceRowNumber: partial.sourceRowNumber,
  };
}

export function isImportCostProvided(row: Pick<NormalizedProductImportRow, "costPricePerUnitUgx">): boolean {
  return row.costPricePerUnitUgx != null && Number.isFinite(Number(row.costPricePerUnitUgx));
}
