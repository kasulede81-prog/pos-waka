/**
 * Legacy financial data detection and safe flagging — never fabricate profit.
 */

import type { Sale, SaleLine } from "../types";
import { normalizeUnitCostUgx } from "./costPrecision";

export function detectLegacyFinancialLine(line: SaleLine): boolean {
  if (line.financialDataStatus === "legacy") return true;
  const unitCost = normalizeUnitCostUgx(line.unitCostUgx);
  if (unitCost > 0) return false;
  if (Number.isFinite(line.cogsUgx) && line.cogsUgx! > 0) return false;
  if (
    Number.isFinite(line.grossProfitUgx) &&
    Number.isFinite(line.cogsUgx) &&
    Number.isFinite(line.netRevenueUgx)
  ) {
    return false;
  }
  const profit = Number.isFinite(line.estimatedProfitUgx) ? line.estimatedProfitUgx : 0;
  return line.lineTotalUgx > 0 && profit >= line.lineTotalUgx - 1;
}

export function flagLegacyFinancialLine(line: SaleLine): SaleLine {
  if (!detectLegacyFinancialLine(line)) return line;
  return {
    ...line,
    financialDataStatus: "legacy",
    estimatedProfitUgx: 0,
    grossProfitUgx: 0,
    cogsUgx: line.cogsUgx,
  };
}

export function repairLegacySaleFinancials(sale: Sale): Sale {
  const lines = sale.lines.map(flagLegacyFinancialLine);
  const legacyFinancialData =
    sale.legacyFinancialData || lines.some((l) => l.financialDataStatus === "legacy");
  const estimatedProfitUgx = lines.reduce((sum, l) => {
    if (l.financialDataStatus === "legacy" || l.financialDataStatus === "needs_repair") return sum;
    return sum + (l.grossProfitUgx ?? l.estimatedProfitUgx ?? 0);
  }, 0);
  return {
    ...sale,
    lines,
    legacyFinancialData,
    estimatedProfitUgx: Math.round(estimatedProfitUgx),
  };
}

export function repairLegacySalesBatch(sales: Sale[]): Sale[] {
  return sales.map(repairLegacySaleFinancials);
}
