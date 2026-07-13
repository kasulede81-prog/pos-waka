import { jsPDF } from "jspdf";
import type { Language } from "../types";
import { t } from "./i18n";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob, sharePdfBlob } from "./documentPrint";
import { printDocumentNativeFallback } from "./nativePrintFallback";
import { exportCsvFile } from "./reportExportEngine";
import { formatXReportCsv, type XReportSnapshot } from "./xReport";

export function buildXReportPdfBlob(lang: Language, snapshot: XReportSnapshot): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, snapshot.shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "xReportTitle"), { size: 13, bold: true });
  pdfLine(layout, doc, `${t(lang, "xReportDate")}: ${snapshot.dateKey}`);
  pdfLine(layout, doc, `${t(lang, "xReportGenerated")}: ${new Date(snapshot.generatedAt).toLocaleString("en-UG", { timeZone: "Africa/Kampala" })}`);
  pdfGap(layout, 8);
  pdfLine(layout, doc, `${t(lang, "totalSales")}: UGX ${snapshot.totalSalesUgx.toLocaleString()}`, { bold: true });
  pdfLine(layout, doc, `${t(lang, "closeSalesCount")}: ${snapshot.transactionCount}`);
  pdfLine(layout, doc, `${t(lang, "closeDayExpectedTitle")}: UGX ${snapshot.expectedDrawerCashUgx.toLocaleString()}`);
  pdfGap(layout, 6);
  pdfLine(layout, doc, `${t(lang, "xReportCash")}: UGX ${snapshot.payments.cashUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "xReportMoMo")}: UGX ${snapshot.payments.mobileMoneyUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "xReportCard")}: UGX ${snapshot.payments.cardUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "xReportCredit")}: UGX ${snapshot.payments.creditUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "closeDayExpensesToday")}: UGX ${snapshot.expensesUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "xReportRefunds")}: UGX ${snapshot.refundsUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "xReportVoids")}: UGX ${snapshot.voidsUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "xReportDiscounts")}: UGX ${snapshot.discountsUgx.toLocaleString()}`);
  if (snapshot.tableOpenCount > 0) {
    pdfGap(layout, 6);
    pdfLine(layout, doc, `${t(lang, "xReportOpenTables")}: ${snapshot.tableOpenCount} · UGX ${snapshot.tablePendingUgx.toLocaleString()}`);
  }
  pdfGap(layout, 8);
  pdfLine(layout, doc, t(lang, "xReportStaffSection"), { bold: true });
  for (const row of snapshot.staffRows.slice(0, 10)) {
    pdfLine(layout, doc, `${row.label}: UGX ${row.salesUgx.toLocaleString()} (${row.saleCount})`);
  }
  return doc.output("blob");
}

function xReportPdfFilename(dateKey: string): string {
  return sanitizePdfStem(`waka-x-report-${dateKey}`) + ".pdf";
}

export async function downloadXReportPdf(lang: Language, snapshot: XReportSnapshot): Promise<boolean> {
  const blob = buildXReportPdfBlob(lang, snapshot);
  return downloadPdfBlob(xReportPdfFilename(snapshot.dateKey), blob);
}

export async function shareXReportPdf(lang: Language, snapshot: XReportSnapshot): Promise<boolean> {
  const blob = buildXReportPdfBlob(lang, snapshot);
  return sharePdfBlob(xReportPdfFilename(snapshot.dateKey), blob);
}

export async function printXReport(lang: Language, snapshot: XReportSnapshot): Promise<boolean> {
  return printDocumentNativeFallback({
    pdfFilename: xReportPdfFilename(snapshot.dateKey),
    buildPdfBlob: () => buildXReportPdfBlob(lang, snapshot),
    htmlBody: `<article><h2>${snapshot.shopName}</h2><h3>${t(lang, "xReportTitle")}</h3><p>${snapshot.dateKey}</p></article>`,
    paper: "a4",
    title: "X Report",
    shareDialogTitle: "Print or share X report",
  });
}

export async function downloadXReportCsv(snapshot: XReportSnapshot): Promise<boolean> {
  const csv = formatXReportCsv(snapshot);
  const rows = csv.split("\n").map((line) => line.split(","));
  const result = await exportCsvFile("x_report", `x-report-${snapshot.dateKey}.csv`, rows);
  return result.ok;
}
