import { jsPDF } from "jspdf";
import type { DayCloseDocumentSnapshot, DayCloseSummary, Language } from "../types";
import { t } from "./i18n";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob, printHtmlDocumentWithDesktop, sharePdfBlob } from "./documentPrint";
import { isNativePrintPlatform } from "./nativeReceiptPrint";

export function buildDayCloseSnapshot(params: {
  closedByUserId: string | null;
  closedByLabel: string;
  row: Omit<DayCloseSummary, "documentSnapshot">;
  drawer: {
    cashFromSalesUgx: number;
    debtCollectedUgx: number;
    refundsUgx: number;
    expenseUgx: number;
  };
  transactionCount: number;
}): DayCloseDocumentSnapshot {
  const { row, drawer, closedByUserId, closedByLabel, transactionCount } = params;
  return {
    documentVersion: 1,
    generatedAt: row.createdAt,
    closedByUserId,
    closedByLabel,
    expectedCashUgx: row.expectedCashUgx,
    countedCashUgx: row.countedCashUgx,
    varianceUgx: row.differenceUgx,
    totalSalesUgx: row.totalSalesUgx,
    profitEstimateUgx: row.profitEstimateUgx,
    totalDebtUgx: row.totalDebtUgx,
    cashFromSalesUgx: drawer.cashFromSalesUgx,
    debtCollectedUgx: drawer.debtCollectedUgx,
    refundsUgx: drawer.refundsUgx,
    expenseUgx: drawer.expenseUgx,
    transactionCount,
  };
}

export function buildDayClosePdfBlob(lang: Language, close: DayCloseSummary, shopName: string): Blob {
  const snap = close.documentSnapshot;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "dayCloseReportTitle"), { size: 13, bold: true });
  pdfLine(layout, doc, `${t(lang, "closeDay")}: ${close.dateKey}`);
  pdfLine(layout, doc, `Generated: ${new Date(close.createdAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })}`);
  if (snap) pdfLine(layout, doc, `${t(lang, "dayCloseClosedBy")}: ${snap.closedByLabel}`);
  pdfGap(layout, 8);
  pdfLine(layout, doc, `${t(lang, "closeDayExpectedTitle")}: UGX ${close.expectedCashUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `${t(lang, "closeCountedCash")}: UGX ${close.countedCashUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `${t(lang, "closeLastDiff")}: UGX ${close.differenceUgx.toLocaleString()}`, { bold: true });
  pdfGap(layout, 6);
  pdfLine(layout, doc, `${t(lang, "totalSales")}: UGX ${close.totalSalesUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "estimatedProfit")}: UGX ${close.profitEstimateUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "creditLabel")}: UGX ${close.totalDebtUgx.toLocaleString()}`);
  if (snap) {
    pdfLine(layout, doc, `${t(lang, "closeSimpleCashSalesToday")}: UGX ${snap.cashFromSalesUgx.toLocaleString()}`);
    pdfLine(layout, doc, `${t(lang, "closeDebtCollectedToday")}: UGX ${snap.debtCollectedUgx.toLocaleString()}`);
    if (snap.expenseUgx > 0) pdfLine(layout, doc, `${t(lang, "closeDayExpensesToday")}: UGX ${snap.expenseUgx.toLocaleString()}`);
    if (snap.refundsUgx > 0) pdfLine(layout, doc, `${t(lang, "dayCloseRefunds")}: UGX ${snap.refundsUgx.toLocaleString()}`);
    pdfLine(layout, doc, `${t(lang, "salesCount")}: ${snap.transactionCount}`);
  }
  return doc.output("blob");
}

function dayCloseHtml(lang: Language, close: DayCloseSummary, shopName: string): string {
  const snap = close.documentSnapshot;
  return `<article>
    <h2>${shopName}</h2>
    <h3>${t(lang, "dayCloseReportTitle")}</h3>
    <p>${close.dateKey}</p>
    <p>Expected: UGX ${close.expectedCashUgx.toLocaleString()}<br/>
    Counted: UGX ${close.countedCashUgx.toLocaleString()}<br/>
    Variance: UGX ${close.differenceUgx.toLocaleString()}</p>
    <p>Sales: UGX ${close.totalSalesUgx.toLocaleString()} · Profit: UGX ${close.profitEstimateUgx.toLocaleString()}</p>
    ${snap ? `<p>Closed by: ${snap.closedByLabel}</p>` : ""}
  </article>`;
}

export function dayClosePdfFilename(dateKey: string): string {
  return sanitizePdfStem(`waka-day-close-${dateKey}`) + ".pdf";
}

export async function downloadDayClosePdf(lang: Language, close: DayCloseSummary, shopName: string): Promise<boolean> {
  const blob = buildDayClosePdfBlob(lang, close, shopName);
  return downloadPdfBlob(dayClosePdfFilename(close.dateKey), blob);
}

export async function shareDayClosePdf(lang: Language, close: DayCloseSummary, shopName: string): Promise<boolean> {
  const blob = buildDayClosePdfBlob(lang, close, shopName);
  return sharePdfBlob(dayClosePdfFilename(close.dateKey), blob);
}

export async function printDayCloseReport(lang: Language, close: DayCloseSummary, shopName: string): Promise<boolean> {
  if (isNativePrintPlatform()) {
    return shareDayClosePdf(lang, close, shopName);
  }
  return printHtmlDocumentWithDesktop(dayCloseHtml(lang, close, shopName), "a4", "Day close");
}
