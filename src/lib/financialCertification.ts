/**
 * Financial Certification — single source of truth parity across all modules.
 * Every release must pass financialCertification.test.ts.
 */

import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { computeCanonicalRevenueUgx } from "./canonicalRevenue";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { getCompletedFinancials, revenueSales } from "./financialMetrics";
import { buildMonthlyBusinessReport } from "./monthlyBusinessReport";
import { localGetDailySalesSummary, localGetInventoryInsights } from "./localReporting";
import { sumSalesFinancials, sumSaleLinesFinancials, resolveSaleLineFinancialsWithSale } from "./saleFinancialEngine";
import { roundTripSaleLineThroughCloud } from "./saleLineCloudCodec";
import { buildReceiptDisplayData } from "./receiptPrint";
import { formatReceiptLineCalculation } from "./saleQuantityLabel";
import { buildReceiptLineQuantityDisplay } from "./saleQuantityLabel";

export type CertifiedFinancialTotals = {
  revenueUgx: number;
  cogsUgx: number;
  grossProfitUgx: number;
  inventoryValueUgx: number;
  totalStockQuantity: number;
};

export type ModuleFinancialReadings = {
  engine: CertifiedFinancialTotals;
  homeProfit: { revenueUgx: number; cogsUgx: number; grossProfitUgx: number };
  financialMetrics: { revenueUgx: number; grossProfitUgx: number };
  dailyReport: { revenueUgx: number; grossProfitUgx: number };
  monthlyReport: { revenueUgx: number; grossProfitUgx: number };
  inventoryInsights: { inventoryValueUgx: number };
  receiptTotalUgx: number;
};

export type FinancialParityMismatch = {
  field: string;
  expected: number;
  actual: number;
  module: string;
};

const STOCK_QTY_EPS = 0.0001;

/** Canonical totals from the financial engine. */
export function computeCertifiedFinancialTotals(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
): CertifiedFinancialTotals {
  const scoped = revenueSales(sales);
  const engineTotals = sumSalesFinancials(scoped);
  const revenueUgx = computeCanonicalRevenueUgx(scoped, returns);
  const inventoryValueUgx = inventoryValueAtCostUgx(products);
  let totalStockQuantity = 0;
  for (const p of products) totalStockQuantity += Math.max(0, p.stockOnHand);

  return {
    revenueUgx,
    cogsUgx: engineTotals.cogsUgx,
    grossProfitUgx: engineTotals.grossProfitUgx,
    inventoryValueUgx,
    totalStockQuantity: Math.round(totalStockQuantity * 10000) / 10000,
  };
}

/** Read financial values from every reporting surface. */
export function readAllModuleFinancials(
  sales: Sale[],
  returns: ReturnRecord[],
  products: Product[],
  opts?: { day?: string; monthKey?: string },
): ModuleFinancialReadings {
  const day = opts?.day ?? sales[0]?.createdAt?.slice(0, 10) ?? "2026-06-11";
  const monthKey = opts?.monthKey ?? day.slice(0, 7);
  const productById = new Map(products.map((p) => [p.id, p]));
  const scoped = revenueSales(sales);

  const engine = computeCertifiedFinancialTotals(sales, returns, products);
  const home = computeTodayProfitBreakdown(scoped, productById, returns);
  const fin = getCompletedFinancials(sales, returns, products, { day });
  const daily = localGetDailySalesSummary(sales, products, returns, day);
  const monthly = buildMonthlyBusinessReport({
    monthKey,
    shopName: "Test Shop",
    sales,
    returnRecords: returns,
    products,
    staffAccounts: [],
    cashExpenses: [],
  });
  const inventory = localGetInventoryInsights(products);

  let receiptTotalUgx = 0;
  for (const sale of scoped) {
    const display = buildReceiptDisplayData({
      shopName: "Test",
      cashier: "Cashier",
      receiptNumber: "001",
      sale,
      productById,
    });
    receiptTotalUgx += display.totalUgx;
  }

  return {
    engine,
    homeProfit: { revenueUgx: home.salesUgx, cogsUgx: home.costUgx, grossProfitUgx: home.profitUgx },
    financialMetrics: { revenueUgx: fin.revenueUgx, grossProfitUgx: fin.profitUgx },
    dailyReport: { revenueUgx: daily.totalRevenueUgx, grossProfitUgx: daily.estimatedProfitUgx },
    monthlyReport: { revenueUgx: monthly.totalSalesUgx, grossProfitUgx: monthly.profitUgx },
    inventoryInsights: { inventoryValueUgx: inventory.stockValueAtCostUgx },
    receiptTotalUgx: Math.max(0, receiptTotalUgx),
  };
}

/** Assert every module matches the certified engine totals. */
export function assertFinancialCertification(
  readings: ModuleFinancialReadings,
): { pass: boolean; mismatches: FinancialParityMismatch[] } {
  const mismatches: FinancialParityMismatch[] = [];
  const { engine } = readings;

  const checks: Array<{ module: string; field: keyof CertifiedFinancialTotals; actual: number }> = [
    { module: "homeProfit.revenue", field: "revenueUgx", actual: readings.homeProfit.revenueUgx },
    { module: "homeProfit.cogs", field: "cogsUgx", actual: readings.homeProfit.cogsUgx },
    { module: "homeProfit.profit", field: "grossProfitUgx", actual: readings.homeProfit.grossProfitUgx },
    { module: "financialMetrics.revenue", field: "revenueUgx", actual: readings.financialMetrics.revenueUgx },
    { module: "financialMetrics.profit", field: "grossProfitUgx", actual: readings.financialMetrics.grossProfitUgx },
    { module: "dailyReport.revenue", field: "revenueUgx", actual: readings.dailyReport.revenueUgx },
    { module: "dailyReport.profit", field: "grossProfitUgx", actual: readings.dailyReport.grossProfitUgx },
    { module: "monthlyReport.revenue", field: "revenueUgx", actual: readings.monthlyReport.revenueUgx },
    { module: "monthlyReport.profit", field: "grossProfitUgx", actual: readings.monthlyReport.grossProfitUgx },
    { module: "inventoryInsights", field: "inventoryValueUgx", actual: readings.inventoryInsights.inventoryValueUgx },
  ];

  for (const check of checks) {
    const expected = engine[check.field];
    if (expected !== check.actual) {
      mismatches.push({
        field: check.field,
        expected,
        actual: check.actual,
        module: check.module,
      });
    }
  }

  return { pass: mismatches.length === 0, mismatches };
}

/** Verify completed sale lines are immutable after product edits. */
export function assertHistoricalSaleImmutable(
  linesBefore: SaleLine[],
  linesAfter: SaleLine[],
): boolean {
  if (linesBefore.length !== linesAfter.length) return false;
  for (let i = 0; i < linesBefore.length; i++) {
    const a = resolveSaleLineFinancialsWithSale(linesBefore[i]!, { lines: linesBefore, totalUgx: 0 } as Sale);
    const b = resolveSaleLineFinancialsWithSale(linesAfter[i]!, { lines: linesAfter, totalUgx: 0 } as Sale);
    if (
      a.revenueUgx !== b.revenueUgx ||
      a.cogsUgx !== b.cogsUgx ||
      a.grossProfitUgx !== b.grossProfitUgx ||
      a.quantity !== b.quantity
    ) {
      return false;
    }
  }
  return true;
}

/** Verify cloud round-trip preserves all financial snapshot fields. */
export function assertCloudRoundTripPreservesFinancials(line: SaleLine): boolean {
  const restored = roundTripSaleLineThroughCloud(line);
  return (
    restored.inputMode === line.inputMode &&
    restored.quantity === line.quantity &&
    restored.lineTotalUgx === line.lineTotalUgx &&
    restored.unitCostUgx === line.unitCostUgx &&
    restored.cogsUgx === line.cogsUgx &&
    restored.cartDiscountUgx === line.cartDiscountUgx &&
    restored.netRevenueUgx === line.netRevenueUgx &&
    restored.grossProfitUgx === line.grossProfitUgx &&
    restored.estimatedProfitUgx === line.estimatedProfitUgx &&
    restored.moneyAmountUgx === line.moneyAmountUgx
  );
}

/** Sum line financials for a sale — used in receipt certification. */
export function certifiedSaleLineTotals(sale: Sale): CertifiedFinancialTotals {
  const active = sale.lines.filter((l) => !l.voided);
  const lineSubtotalUgx = active.reduce((a, l) => a + l.lineTotalUgx, 0);
  const heldTotal = Math.max(0, Math.floor(sale.totalUgx ?? 0));
  const cartDiscountUgx = Math.max(0, Math.min(lineSubtotalUgx, lineSubtotalUgx - heldTotal));
  const part = sumSaleLinesFinancials(active, { cartDiscountUgx, lineSubtotalUgx });
  return {
    revenueUgx: heldTotal,
    cogsUgx: part.cogsUgx,
    grossProfitUgx: part.grossProfitUgx,
    inventoryValueUgx: 0,
    totalStockQuantity: active.reduce((a, l) => a + l.quantity, 0),
  };
}

/** Build receipt calculation string for certification. */
export function receiptCalculationForLine(line: SaleLine, product?: Product): string {
  const { quantityLabel, showCalculation } = buildReceiptLineQuantityDisplay(line, product);
  if (showCalculation) {
    return formatReceiptLineCalculation(quantityLabel, line.unitPriceUgx, line.lineTotalUgx);
  }
  return `${quantityLabel} = UGX ${line.lineTotalUgx.toLocaleString()}`;
}

export function stockQuantityMatches(a: number, b: number): boolean {
  return Math.abs(a - b) <= STOCK_QTY_EPS;
}
