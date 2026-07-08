/** Live cost preview + sanity warnings for product pack/cost entry (read-only guards). */

import {
  formatUgxDisplay,
  inventoryLineValueAtCostUgx,
  marginPercentOnSell,
  normalizeUnitCostUgx,
  profitPerUnitUgx,
  unitCostFromPackTotal,
} from "./costPrecision";

export { unitCostFromPackTotal as unitCostFromPack } from "./costPrecision";
export { unitCostFromInvoiceTotal } from "./costPrecision";
export { profitPerUnitUgx, marginPercentOnSell, markupPercentOnCost } from "./costPrecision";

export type CostValidationPreview = {
  packCostUgx: number | null;
  piecesPerPack: number | null;
  unitCostUgx: number | null;
  sellPriceUgx: number | null;
  profitPerUnitUgx: number | null;
  marginPct: number | null;
};

export type CostValidationWarning = "low_unit_cost" | "high_margin";

export type ProductCostWarningKind =
  | CostValidationWarning
  | "zero_cost"
  | "zero_price"
  | "sell_below_cost"
  | "extreme_margin";

export type ProductCostWarning = {
  kind: ProductCostWarningKind;
  /** i18n key when pharmacy-specific; retail uses costPreviewWarning* keys */
  messageKey?: string;
};

const LOW_COST_RATIO = 0.1;
const HIGH_MARGIN_RATIO = 0.8;
const EXTREME_MARKUP_RATIO = 5;

export function computeCostValidationPreview(input: {
  packCostUgx?: number;
  piecesPerPack?: number;
  unitCostUgx?: number;
  sellPriceUgx?: number;
}): CostValidationPreview {
  const packCost = input.packCostUgx != null && input.packCostUgx > 0 ? input.packCostUgx : null;
  const pieces = input.piecesPerPack != null && input.piecesPerPack > 0 ? input.piecesPerPack : null;
  const sell = input.sellPriceUgx != null && input.sellPriceUgx > 0 ? input.sellPriceUgx : null;

  let unitCost: number | null = null;
  if (packCost != null && pieces != null) {
    unitCost = unitCostFromPackTotal(packCost, pieces);
  } else if (input.unitCostUgx != null && input.unitCostUgx >= 0) {
    unitCost = normalizeUnitCostUgx(input.unitCostUgx);
  }

  const profit =
    sell != null && unitCost != null ? profitPerUnitUgx(sell, unitCost) : null;
  const marginPct =
    sell != null && unitCost != null ? marginPercentOnSell(sell, unitCost) : null;

  return {
    packCostUgx: packCost,
    piecesPerPack: pieces,
    unitCostUgx: unitCost,
    sellPriceUgx: sell,
    profitPerUnitUgx: profit,
    marginPct,
  };
}

export function getCostValidationWarnings(preview: CostValidationPreview): CostValidationWarning[] {
  return getProductCostWarnings({
    unitCostUgx: preview.unitCostUgx ?? 0,
    sellPriceUgx: preview.sellPriceUgx ?? 0,
    pharmacyMode: false,
  })
    .map((w) => w.kind)
    .filter((k): k is CostValidationWarning => k === "low_unit_cost" || k === "high_margin");
}

/** Unified cost/price warnings — retail + optional pharmacy extensions. */
export function getProductCostWarnings(input: {
  unitCostUgx: number;
  sellPriceUgx: number;
  pharmacyMode?: boolean;
}): ProductCostWarning[] {
  const cost = normalizeUnitCostUgx(input.unitCostUgx);
  const sell = Math.max(0, Math.floor(input.sellPriceUgx));
  const out: ProductCostWarning[] = [];

  if (input.pharmacyMode) {
    if (cost <= 0) out.push({ kind: "zero_cost", messageKey: "pharmacyWarnZeroCost" });
    if (sell <= 0) out.push({ kind: "zero_price", messageKey: "pharmacyWarnZeroPrice" });
    if (cost > 0 && sell > 0 && sell < cost) {
      out.push({ kind: "sell_below_cost", messageKey: "pharmacyWarnSellBelowCost" });
    }
    if (cost > 0 && sell > cost * EXTREME_MARKUP_RATIO) {
      out.push({ kind: "extreme_margin", messageKey: "pharmacyWarnExtremeMargin" });
    }
  }

  if (sell <= 0 || cost < 0) return out;

  if (cost < sell * LOW_COST_RATIO) {
    out.push({ kind: "low_unit_cost" });
  }
  const marginOnSell = (sell - cost) / sell;
  if (marginOnSell > HIGH_MARGIN_RATIO) {
    out.push({ kind: "high_margin" });
  }

  return out;
}

export function productCostWarningsFromPreview(
  preview: CostValidationPreview,
  pharmacyMode = false,
): ProductCostWarning[] {
  return getProductCostWarnings({
    unitCostUgx: preview.unitCostUgx ?? 0,
    sellPriceUgx: preview.sellPriceUgx ?? 0,
    pharmacyMode,
  });
}

export type FinanceDiagnosticRow = {
  productId: string;
  name: string;
  stockOnHand: number;
  unitCostUgx: number;
  sellPriceUgx: number;
  stockValueUgx: number;
  marginPct: number | null;
  severity: FinanceDiagnosticSeverity;
  flags: FinanceDiagnosticFlag[];
};

export type FinanceDiagnosticSeverity = "critical" | "warning" | "normal";

export type FinanceDiagnosticFlag =
  | "margin_over_80"
  | "margin_over_90"
  | "cost_zero"
  | "sell_zero"
  | "unit_cost_under_10pct"
  | "negative_margin";

export type FinanceDiagnosticFilter =
  | "all"
  | "margin_over_80"
  | "margin_over_90"
  | "cost_zero"
  | "sell_zero"
  | "unit_cost_under_10pct"
  | "negative_margin"
  | "suspicious_cost"
  | "high_margin"
  | "missing_cost"
  | "missing_sell";

export type FinanceHealthSummary = {
  suspiciousCost: number;
  highMargin: number;
  negativeMargin: number;
  missingCost: number;
  missingSell: number;
};

const MARGIN_WARN = 80;
const MARGIN_CRITICAL = 90;

export function classifyFinanceDiagnosticRow(row: Omit<FinanceDiagnosticRow, "severity" | "flags">): {
  severity: FinanceDiagnosticSeverity;
  flags: FinanceDiagnosticFlag[];
} {
  const flags: FinanceDiagnosticFlag[] = [];
  const { unitCostUgx, sellPriceUgx, marginPct } = row;

  if (sellPriceUgx <= 0) flags.push("sell_zero");
  if (unitCostUgx <= 0 && sellPriceUgx > 0) flags.push("cost_zero");

  if (marginPct != null) {
    if (marginPct < 0) flags.push("negative_margin");
    if (marginPct > MARGIN_WARN) flags.push("margin_over_80");
    if (marginPct > MARGIN_CRITICAL) flags.push("margin_over_90");
  }

  if (sellPriceUgx > 0 && unitCostUgx > 0 && unitCostUgx < sellPriceUgx * LOW_COST_RATIO) {
    flags.push("unit_cost_under_10pct");
  }

  let severity: FinanceDiagnosticSeverity = "normal";
  if (
    flags.includes("negative_margin") ||
    flags.includes("cost_zero") ||
    flags.includes("unit_cost_under_10pct")
  ) {
    severity = "critical";
  } else if (
    flags.includes("margin_over_80") ||
    flags.includes("margin_over_90") ||
    flags.includes("sell_zero")
  ) {
    severity = "warning";
  }

  return { severity, flags };
}

export function buildFinanceDiagnosticRows(
  products: {
    id: string;
    name: string;
    stockOnHand: number;
    costPricePerUnitUgx: number;
    sellingPricePerUnitUgx: number;
    buyingPackCostUgx?: number | null;
    conversionRate?: number | null;
  }[],
): FinanceDiagnosticRow[] {
  return products.map((p) => {
    const stock = Math.max(0, Number(p.stockOnHand) || 0);
    const cost = normalizeUnitCostUgx(p.costPricePerUnitUgx);
    const sell = Math.max(0, Math.floor(p.sellingPricePerUnitUgx));
    const marginPct = sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null;
    const base = {
      productId: p.id,
      name: p.name,
      stockOnHand: stock,
      unitCostUgx: formatUgxDisplay(cost),
      sellPriceUgx: sell,
      stockValueUgx: inventoryLineValueAtCostUgx(p),
      marginPct,
    };
    const { severity, flags } = classifyFinanceDiagnosticRow(base);
    return { ...base, severity, flags };
  });
}

export function summarizeFinanceHealth(rows: FinanceDiagnosticRow[]): FinanceHealthSummary {
  return {
    suspiciousCost: rows.filter(
      (r) => r.flags.includes("unit_cost_under_10pct") || r.flags.includes("cost_zero"),
    ).length,
    highMargin: rows.filter((r) => r.flags.includes("margin_over_80")).length,
    negativeMargin: rows.filter((r) => r.flags.includes("negative_margin")).length,
    missingCost: rows.filter((r) => r.sellPriceUgx > 0 && r.unitCostUgx <= 0).length,
    missingSell: rows.filter((r) => r.sellPriceUgx <= 0 && r.stockOnHand > 0).length,
  };
}

export function filterFinanceDiagnosticRows(
  rows: FinanceDiagnosticRow[],
  filter: FinanceDiagnosticFilter,
): FinanceDiagnosticRow[] {
  if (filter === "all") return rows;
  return rows.filter((row) => {
    switch (filter) {
      case "margin_over_80":
        return row.flags.includes("margin_over_80");
      case "margin_over_90":
        return row.flags.includes("margin_over_90");
      case "cost_zero":
        return row.flags.includes("cost_zero");
      case "sell_zero":
        return row.flags.includes("sell_zero");
      case "unit_cost_under_10pct":
        return row.flags.includes("unit_cost_under_10pct");
      case "negative_margin":
        return row.flags.includes("negative_margin");
      case "suspicious_cost":
        return row.flags.includes("unit_cost_under_10pct") || row.flags.includes("cost_zero");
      case "high_margin":
        return row.flags.includes("margin_over_80");
      case "missing_cost":
        return row.sellPriceUgx > 0 && row.unitCostUgx <= 0;
      case "missing_sell":
        return row.sellPriceUgx <= 0 && row.stockOnHand > 0;
      default:
        return true;
    }
  });
}

export function sortFinanceDiagnosticRows(
  rows: FinanceDiagnosticRow[],
  sort: "lowest_cost" | "highest_margin",
): FinanceDiagnosticRow[] {
  const copy = [...rows];
  if (sort === "lowest_cost") {
    copy.sort((a, b) => a.unitCostUgx - b.unitCostUgx || a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => {
      const ma = a.marginPct ?? -1;
      const mb = b.marginPct ?? -1;
      return mb - ma || a.name.localeCompare(b.name);
    });
  }
  return copy;
}
