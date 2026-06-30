/**
 * Cloud sale-line financial hydration — never silently default missing COGS to zero.
 */

import type { Sale, SaleLine } from "../types";
import { lineCostUgx, lineProfitUgx, normalizeUnitCostUgx } from "./costPrecision";
import { allocateCartDiscountUgx } from "./saleFinancialEngine";

export type LineFinancialDataStatus = "complete" | "repaired" | "legacy" | "needs_repair";

export type SaleLineHydrationResult = {
  line: SaleLine;
  status: LineFinancialDataStatus;
  issues: string[];
};

export type FinancialHydrationLogEntry = {
  at: string;
  saleId?: string;
  lineId?: string;
  productId: string;
  status: LineFinancialDataStatus;
  issues: string[];
};

const hydrationLog: FinancialHydrationLogEntry[] = [];
const MAX_HYDRATION_LOG = 200;

export function readFinancialHydrationLog(): FinancialHydrationLogEntry[] {
  return [...hydrationLog];
}

export function clearFinancialHydrationLog(): void {
  hydrationLog.length = 0;
}

function pushHydrationLog(entry: FinancialHydrationLogEntry): void {
  hydrationLog.unshift(entry);
  if (hydrationLog.length > MAX_HYDRATION_LOG) hydrationLog.length = MAX_HYDRATION_LOG;
}

function hasCompleteSnapshot(meta: {
  cogsUgx?: number;
  grossProfitUgx?: number;
  netRevenueUgx?: number;
}): boolean {
  return (
    Number.isFinite(meta.cogsUgx) &&
    Number.isFinite(meta.grossProfitUgx) &&
    Number.isFinite(meta.netRevenueUgx)
  );
}

function isLegacyZeroCostPattern(line: SaleLine): boolean {
  const unitCost = normalizeUnitCostUgx(line.unitCostUgx);
  const profit = Number.isFinite(line.estimatedProfitUgx) ? Math.round(line.estimatedProfitUgx) : 0;
  return (
    unitCost <= 0 &&
    !Number.isFinite(line.cogsUgx) &&
    line.lineTotalUgx > 0 &&
    profit >= line.lineTotalUgx - 1
  );
}

/** Safe reconstruction from unit cost × quantity and known line revenue. */
function tryReconstructFromUnitCost(
  line: SaleLine,
  preCartRevenueUgx: number,
  cartDiscountUgx: number,
): SaleLine | null {
  const unitCost = normalizeUnitCostUgx(line.unitCostUgx);
  const qty = Math.max(0, Number(line.quantity) || 0);
  if (unitCost <= 0 || qty <= 0 || preCartRevenueUgx <= 0) return null;

  const cogsUgx = lineCostUgx(unitCost, qty);
  const netRevenueUgx = Math.max(0, preCartRevenueUgx - cartDiscountUgx);
  const grossProfitUgx = lineProfitUgx(netRevenueUgx, cogsUgx);
  return {
    ...line,
    cogsUgx,
    cartDiscountUgx,
    netRevenueUgx,
    grossProfitUgx,
    estimatedProfitUgx: grossProfitUgx,
    financialDataStatus: "repaired",
  };
}

/** Reconstruct from stored estimated profit when COGS can be derived. */
function tryReconstructFromEstimatedProfit(line: SaleLine, netRevenueUgx: number): SaleLine | null {
  if (!Number.isFinite(line.estimatedProfitUgx)) return null;
  if (line.estimatedProfitUgx <= 0 && !Number.isFinite(line.cogsUgx) && normalizeUnitCostUgx(line.unitCostUgx) <= 0) {
    return null;
  }
  const grossProfitUgx = Math.round(line.estimatedProfitUgx);
  const cogsUgx = Math.max(0, Math.round(netRevenueUgx - grossProfitUgx));
  if (cogsUgx <= 0 && grossProfitUgx >= netRevenueUgx) return null;
  return {
    ...line,
    cogsUgx,
    netRevenueUgx,
    grossProfitUgx,
    estimatedProfitUgx: grossProfitUgx,
    financialDataStatus: "repaired",
  };
}

export type SaleLineCloudHydrationContext = {
  saleId?: string;
  lineIndex?: number;
  lineSubtotalUgx?: number;
  cartDiscountUgx?: number;
};

/**
 * Validate and hydrate a sale line pulled from cloud.
 * Never defaults unitCostUgx to 0 for profit calculation when metadata is absent.
 */
export function hydrateSaleLineFinancialsFromCloud(
  line: SaleLine,
  ctx: SaleLineCloudHydrationContext = {},
): SaleLineHydrationResult {
  const issues: string[] = [];
  let working: SaleLine = { ...line };

  if (working.financialDataStatus === "legacy") {
    return { line: working, status: "legacy", issues: ["legacy_flagged"] };
  }

  if (
    hasCompleteSnapshot({
      cogsUgx: working.cogsUgx,
      grossProfitUgx: working.grossProfitUgx,
      netRevenueUgx: working.netRevenueUgx,
    })
  ) {
    working.financialDataStatus = "complete";
    return { line: working, status: "complete", issues: [] };
  }

  if (isLegacyZeroCostPattern(working)) {
    working = {
      ...working,
      financialDataStatus: "legacy",
      estimatedProfitUgx: 0,
      grossProfitUgx: 0,
      cogsUgx: undefined,
      netRevenueUgx: working.lineTotalUgx,
    };
    issues.push("legacy_zero_cost");
    pushHydrationLog({
      at: new Date().toISOString(),
      saleId: ctx.saleId,
      lineId: working.id,
      productId: working.productId,
      status: "legacy",
      issues,
    });
    return { line: working, status: "legacy", issues };
  }

  const preCart = Math.max(0, Math.floor(working.lineTotalUgx));
  const lineSubtotal = ctx.lineSubtotalUgx ?? preCart;
  const cartDiscount =
    ctx.cartDiscountUgx != null && lineSubtotal > 0
      ? Math.round((ctx.cartDiscountUgx * preCart) / lineSubtotal)
      : 0;
  const netRevenueUgx = Math.max(0, preCart - cartDiscount);

  if (Number.isFinite(working.cogsUgx) && working.cogsUgx! >= 0) {
    const cogsUgx = Math.round(working.cogsUgx!);
    const grossProfitUgx = lineProfitUgx(netRevenueUgx, cogsUgx);
    working = {
      ...working,
      cogsUgx,
      cartDiscountUgx: cartDiscount,
      netRevenueUgx,
      grossProfitUgx,
      estimatedProfitUgx: grossProfitUgx,
      financialDataStatus: "repaired",
    };
    issues.push("repaired_from_cogs");
    pushHydrationLog({
      at: new Date().toISOString(),
      saleId: ctx.saleId,
      lineId: working.id,
      productId: working.productId,
      status: "repaired",
      issues,
    });
    return { line: working, status: "repaired", issues };
  }

  const unitCost = normalizeUnitCostUgx(working.unitCostUgx);
  if (unitCost > 0) {
    const reconstructed = tryReconstructFromUnitCost(working, preCart, cartDiscount);
    if (reconstructed) {
      issues.push("repaired_from_unit_cost");
      pushHydrationLog({
        at: new Date().toISOString(),
        saleId: ctx.saleId,
        lineId: reconstructed.id,
        productId: reconstructed.productId,
        status: "repaired",
        issues,
      });
      return { line: reconstructed, status: "repaired", issues };
    }
  }

  const fromProfit = tryReconstructFromEstimatedProfit(working, netRevenueUgx);
  if (fromProfit && fromProfit.cogsUgx! > 0) {
    issues.push("repaired_from_estimated_profit");
    pushHydrationLog({
      at: new Date().toISOString(),
      saleId: ctx.saleId,
      lineId: fromProfit.id,
      productId: fromProfit.productId,
      status: "repaired",
      issues,
    });
    return { line: fromProfit, status: "repaired", issues };
  }

  working = {
    ...working,
    unitCostUgx: unitCost > 0 ? unitCost : working.unitCostUgx,
    financialDataStatus: "needs_repair",
    estimatedProfitUgx: 0,
    grossProfitUgx: 0,
    cogsUgx: undefined,
    netRevenueUgx,
    cartDiscountUgx: cartDiscount,
  };
  issues.push("missing_financial_snapshot");
  pushHydrationLog({
    at: new Date().toISOString(),
    saleId: ctx.saleId,
    lineId: working.id,
    productId: working.productId,
    status: "needs_repair",
    issues,
  });
  return { line: working, status: "needs_repair", issues };
}

/** Hydrate all lines on a sale and set sale-level repair flags. */
export function hydrateSaleFinancialsFromCloud(sale: Sale): Sale {
  const active = sale.lines.filter((l) => !l.voided);
  const lineSubtotalUgx = active.reduce((a, l) => a + l.lineTotalUgx, 0);
  const heldTotal = Math.max(0, Math.floor(sale.totalUgx ?? 0));
  const cartDiscountUgx = Math.max(0, Math.min(lineSubtotalUgx, lineSubtotalUgx - heldTotal));

  let needsRepair = false;
  let legacy = false;
  const lines = sale.lines.map((line, idx) => {
    const result = hydrateSaleLineFinancialsFromCloud(line, {
      saleId: sale.id,
      lineIndex: idx,
      lineSubtotalUgx,
      cartDiscountUgx,
    });
    if (result.status === "needs_repair") needsRepair = true;
    if (result.status === "legacy") legacy = true;
    return result.line;
  });

  return {
    ...sale,
    lines,
    financialRepairRequired: needsRepair || sale.financialRepairRequired,
    legacyFinancialData: legacy || sale.legacyFinancialData,
  };
}

/** Allocate cart discount across lines when rebuilding from sale header only. */
export function allocateCartDiscountForLines(lines: SaleLine[], cartDiscountUgx: number): SaleLine[] {
  if (cartDiscountUgx <= 0) return lines;
  const totals = lines.map((l) => l.lineTotalUgx);
  const shares = allocateCartDiscountUgx(totals, cartDiscountUgx);
  return lines.map((line, i) => ({
    ...line,
    cartDiscountUgx: shares[i] ?? 0,
    netRevenueUgx: Math.max(0, line.lineTotalUgx - (shares[i] ?? 0)),
  }));
}

export function lineContributesToProfit(line: SaleLine): boolean {
  return line.financialDataStatus !== "needs_repair" && line.financialDataStatus !== "legacy";
}
