import { jsPDF } from "jspdf";
import type { Language } from "../types";
import type { HospitalityReportSummary as Summary } from "./hospitalityReports";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob } from "./documentPrint";
import { t } from "./i18n";

export function buildHospitalityWaiterPdfBlob(lang: Language, report: Summary): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityWaiterExportTitle"), { size: 14, bold: true });
  for (const w of report.waiters) {
    pdfLine(
      layout,
      doc,
      `${w.label} — ${w.billCount} bills — UGX ${w.revenueUgx.toLocaleString()} (avg ${w.avgBillUgx.toLocaleString()})`,
      { size: 9 },
    );
  }
  return doc.output("blob");
}

export function buildHospitalityKitchenPdfBlob(lang: Language, report: Summary): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityKitchenExportTitle"), { size: 14, bold: true });
  pdfLine(layout, doc, `${t(lang, "hospitalityReportsMix")}:`, { bold: true });
  for (const row of report.categoryMix) {
    pdfLine(layout, doc, `  ${row.kind}: ${row.quantity} · UGX ${row.revenueUgx.toLocaleString()}`, { size: 9 });
  }
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "hospitalityReportsPeak"), { bold: true });
  for (const h of report.peakHours.slice(0, 12)) {
    pdfLine(layout, doc, `  ${h.label}: ${h.billCount} bills · UGX ${h.revenueUgx.toLocaleString()}`, { size: 9 });
  }
  return doc.output("blob");
}

export function buildHospitalityTableRevenuePdfBlob(lang: Language, report: Summary): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "hospitalityTableExportTitle"), { size: 14, bold: true });
  for (const row of report.tables) {
    pdfLine(layout, doc, `${row.label} — ${row.billCount} · UGX ${row.revenueUgx.toLocaleString()}`, { size: 10 });
  }
  return doc.output("blob");
}

export async function downloadHospitalityWaiterPdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-waiters") + ".pdf", buildHospitalityWaiterPdfBlob(lang, report));
}

export async function downloadHospitalityKitchenPdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-kitchen") + ".pdf", buildHospitalityKitchenPdfBlob(lang, report));
}

export async function downloadHospitalityTablePdf(lang: Language, report: Summary): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-hospitality-tables") + ".pdf", buildHospitalityTableRevenuePdfBlob(lang, report));
}
