import { unitCostFromPackTotal } from "../costPrecision";
import type { NormalizedProductImportRow, ProductImportPackMode } from "./types";

/**
 * Wizard-parity pack conversions for import rows.
 * Mirrors `buildProductFromSimpleWizard` stock/cost math — not a second engine.
 */
export function sellUnitsFromOpeningPacks(openingPacks: number, packSize: number): number {
  const packs = Math.max(0, Number(openingPacks) || 0);
  const size = Math.max(0, Number(packSize) || 0);
  if (!Number.isFinite(packs) || !Number.isFinite(size)) return Number.NaN;
  return packs * size;
}

export function unitCostFromImportPackCost(
  costPerPackUgx: number,
  packSize: number,
): number {
  return unitCostFromPackTotal(costPerPackUgx, packSize);
}

/**
 * Recompute sell-unit stock and unit cost from pack fields (wizard semantics).
 * Call after any edit to opening packs, pack size, or cost per pack.
 */
export function syncPackedImportDerivedFields(
  row: NormalizedProductImportRow,
): NormalizedProductImportRow {
  if (row.packMode !== "packed") return row;

  const packSize = Number(row.conversionRate);
  const openingPacks =
    row.openingPacks != null && Number.isFinite(Number(row.openingPacks))
      ? Number(row.openingPacks)
      : 0;

  let stockQty = row.stockQty;
  if (Number.isFinite(packSize) && packSize > 0 && Number.isFinite(openingPacks)) {
    stockQty = sellUnitsFromOpeningPacks(openingPacks, packSize);
  }

  const packCostRaw = row.buyingPackCostUgx;
  let costPricePerUnitUgx: number | null | undefined = row.costPricePerUnitUgx;
  let buyingPackCostUgx: number | null | undefined = packCostRaw;

  if (packCostRaw == null || packCostRaw === undefined) {
    costPricePerUnitUgx = null;
    buyingPackCostUgx = null;
  } else if (!Number.isFinite(Number(packCostRaw))) {
    costPricePerUnitUgx = Number.NaN;
  } else if (Number(packCostRaw) <= 0) {
    costPricePerUnitUgx = null;
    buyingPackCostUgx = null;
  } else if (Number.isFinite(packSize) && packSize > 0) {
    const packCost = Math.floor(Number(packCostRaw));
    buyingPackCostUgx = packCost;
    costPricePerUnitUgx = unitCostFromImportPackCost(packCost, packSize);
  }

  return {
    ...row,
    openingPacks,
    stockQty,
    buyingPackCostUgx,
    costPricePerUnitUgx,
  };
}

export function isPackedImportRow(
  row: Pick<NormalizedProductImportRow, "packMode">,
): boolean {
  return row.packMode === "packed";
}

export function defaultPackMode(): ProductImportPackMode {
  return "none";
}
