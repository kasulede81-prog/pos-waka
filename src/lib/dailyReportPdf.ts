import { jsPDF } from "jspdf";
import type { CashExpense, DebtPayment, Language, Product, ReturnRecord, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials } from "./financialMetrics";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { isCompletedSale } from "./saleStatus";
import { t } from "./i18n";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob } from "./documentPrint";
import type { ProductRank } from "./localReporting";

export type DailyReportPdfInput = {
  lang: Language;
  dateKey: string;
  shopName: string;
  sales: Sale[];
  products: Product[];
  returnRecords: ReturnRecord[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  topProducts: ProductRank[];
  /** When false, profit line is omitted (Free tier). */
  includeProfit?: boolean;
};

function paymentMethodBreakdown(sales: Sale[], day: string): Array<{ label: string; count: number; ugx: number }> {
  const scoped = sales.filter((s) => isCompletedSale(s) && dateKeyKampala(s.createdAt) === day);
  const map = new Map<string, { count: number; ugx: number }>();
  for (const s of scoped) {
    const m = (s as Sale & { paymentMethod?: string }).paymentMethod ?? (s.debtUgx > 0 ? "credit" : "cash");
    const label = String(m);
    const cur = map.get(label) ?? { count: 0, ugx: 0 };
    map.set(label, { count: cur.count + 1, ugx: cur.ugx + s.totalUgx });
  }
  return [...map.entries()].map(([label, v]) => ({ label, ...v }));
}

function voidLineCount(sales: Sale[], day: string): number {
  let n = 0;
  for (const s of sales) {
    if (dateKeyKampala(s.createdAt) !== day) continue;
    for (const ln of s.lines) {
      if (ln.voided) n += 1;
    }
  }
  return n;
}

export function buildDailyReportPdfBlob(input: DailyReportPdfInput): Blob {
  const {
    lang,
    dateKey,
    shopName,
    sales,
    products,
    returnRecords,
    debtPayments,
    cashExpenses,
    topProducts,
    includeProfit = true,
  } = input;
  const dayReturns = returnRecords.filter((r) => dateKeyKampala(r.createdAt) === dateKey);
  const fin = getCompletedFinancials(sales, returnRecords, products, { day: dateKey });
  const drawer = getDrawerCashForDayInput({
    sales,
    returns: returnRecords,
    products,
    debtPayments,
    cashExpenses,
    day: dateKey,
  });
  const refundsUgx = dayReturns.reduce((a, r) => a + r.refundAmountUgx, 0);
  const expensesUgx = drawer.expenseUgx;
  const payments = paymentMethodBreakdown(sales, dateKey);
  const voids = voidLineCount(sales, dateKey);

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "dailyReportPdfTitle"), { size: 13, bold: true });
  pdfLine(layout, doc, dateKey);
  pdfGap(layout, 6);
  pdfLine(layout, doc, `${t(lang, "totalSales")}: UGX ${fin.revenueUgx.toLocaleString()}`, { bold: true });
  if (includeProfit) {
    pdfLine(layout, doc, `${t(lang, "estimatedProfit")}: UGX ${fin.profitUgx.toLocaleString()}`);
  }
  pdfLine(layout, doc, `${t(lang, "cashInHand")}: UGX ${fin.cashCollectedUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "ownerCardExpectedCash")}: UGX ${drawer.expectedDrawerCashUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "creditLabel")}: UGX ${fin.debtIssuedUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "dayCloseRefunds")}: UGX ${refundsUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "closeDayExpensesToday")}: UGX ${expensesUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "salesCount")}: ${fin.transactionCount}`);
  pdfLine(layout, doc, `${t(lang, "dailyReportVoids")}: ${voids}`);
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "dailyReportPaymentMethods"), { bold: true });
  for (const p of payments) {
    pdfLine(layout, doc, `  ${p.label}: ${p.count} · UGX ${p.ugx.toLocaleString()}`, { size: 9 });
  }
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "dailyReportTopProducts"), { bold: true });
  for (const p of topProducts.slice(0, 12)) {
    pdfLine(layout, doc, `  ${p.name} — ${p.quantity} — UGX ${p.revenueUgx.toLocaleString()}`, { size: 9 });
  }
  return doc.output("blob");
}

export async function downloadDailyReportPdf(input: DailyReportPdfInput): Promise<boolean> {
  const blob = buildDailyReportPdfBlob(input);
  const name = sanitizePdfStem(`waka-daily-report-${input.dateKey}`) + ".pdf";
  return downloadPdfBlob(name, blob);
}
