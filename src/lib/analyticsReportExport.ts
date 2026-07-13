/**
 * Structured analytics report rows for CSV/XLSX export (presentation only).
 */

import type { Language } from "../types";
import type { ShopReportBundle } from "../hooks/useShopReporting";
import { t } from "./i18n";

export type AnalyticsExportInput = {
  lang: Language;
  title: string;
  periodLabel: string;
  report: ShopReportBundle;
  expensesUgx: number;
  purchasesInPeriodUgx: number;
  canProfit: boolean;
};

export function buildAnalyticsReportRows(input: AnalyticsExportInput): Array<Array<string | number>> {
  const { lang, title, periodLabel, report, expensesUgx, purchasesInPeriodUgx, canProfit } = input;
  const rows: Array<Array<string | number>> = [
    [t(lang, "exportReportHeading"), title],
    [t(lang, "reportsPeriod"), periodLabel],
    [],
    [t(lang, "baExportMetric"), t(lang, "baExportValue")],
    [t(lang, "receiptsRangeRevenue"), report.revenue],
    [t(lang, "salesCount"), report.count],
    [t(lang, "cashInHand"), report.cash],
    [t(lang, "reportsDebtOutstanding"), report.debtOutstanding],
    [t(lang, "baExpensesInPeriod"), expensesUgx],
    [t(lang, "baPurchasesInPeriod"), purchasesInPeriodUgx],
  ];
  if (canProfit) {
    rows.push([t(lang, "profitStatGrossProfit"), report.profit]);
  }
  rows.push([], [t(lang, "topProducts"), t(lang, "receiptsRangeRevenue")]);
  for (const p of report.topProducts.slice(0, 50)) {
    rows.push([p.name, p.revenueUgx]);
  }
  return rows;
}

export function buildCommandCenterExportRows(input: {
  lang: Language;
  shopName: string;
  periodLabel: string;
  score: number;
  revenueUgx: number;
  profitUgx: number;
  transactions: number;
  expectedCashUgx: number;
}): Array<Array<string | number>> {
  const { lang, shopName, periodLabel, score, revenueUgx, profitUgx, transactions, expectedCashUgx } = input;
  return [
    [t(lang, "ownerDashboardTitle"), shopName],
    [t(lang, "dateFilterViewing"), periodLabel],
    [],
    [t(lang, "cmdCenterExecutiveTitle"), score],
    [t(lang, "receiptsRangeRevenue"), revenueUgx],
    [t(lang, "profitStatGrossProfit"), profitUgx],
    [t(lang, "salesCount"), transactions],
    [t(lang, "ownerCardExpectedCash"), expectedCashUgx],
  ];
}

export function buildProfitExportRows(input: {
  lang: Language;
  periodLabel: string;
  profitUgx: number;
  revenueUgx: number;
  costUgx: number;
  marginPct: number;
  groups: Array<{ categoryLabel: string; profitUgx: number; products: Array<{ name: string; profitUgx: number }> }>;
}): Array<Array<string | number>> {
  const { lang, periodLabel, profitUgx, revenueUgx, costUgx, marginPct, groups } = input;
  const rows: Array<Array<string | number>> = [
    [t(lang, "profitPageTitle"), periodLabel],
    [],
    [t(lang, "profitStatGrossProfit"), profitUgx],
    [t(lang, "profitStatRevenue"), revenueUgx],
    [t(lang, "profitStatCost"), costUgx],
    [t(lang, "profitStatMargin"), `${marginPct.toFixed(1)}%`],
    [],
    [t(lang, "profitStatBestShelf"), t(lang, "profitStatGrossProfit")],
  ];
  for (const g of groups) {
    rows.push([g.categoryLabel, g.profitUgx]);
    for (const p of g.products.slice(0, 100)) {
      rows.push([`  ${p.name}`, p.profitUgx]);
    }
  }
  return rows;
}
