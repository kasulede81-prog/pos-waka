import { jsPDF } from "jspdf";
import type { Customer, Language } from "../types";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadCsvText, downloadPdfBlob } from "./documentPrint";
import { t } from "./i18n";

export type WholesaleReceivablesRow = { name: string; debt: number };

export function wholesaleReceivablesRows(customers: Customer[]): WholesaleReceivablesRow[] {
  return customers
    .map((c) => ({ name: c.name, debt: c.debtBalanceUgx }))
    .filter((r) => r.debt > 0)
    .sort((a, b) => b.debt - a.debt);
}

export function wholesaleReceivablesCsv(rows: WholesaleReceivablesRow[]): string {
  const lines = ["customer,debt_ugx"];
  for (const r of rows) {
    lines.push(`"${r.name.replace(/"/g, '""')}",${r.debt}`);
  }
  return lines.join("\n");
}

export function buildWholesaleReceivablesPdfBlob(lang: Language, rows: WholesaleReceivablesRow[], totalUgx: number): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "wholesaleReceivablesExportTitle"), { size: 14, bold: true });
  pdfLine(layout, doc, `${t(lang, "wholesaleReportsReceivables")}: UGX ${totalUgx.toLocaleString()}`, { bold: true });
  pdfGap(layout, 6);
  for (const r of rows.slice(0, 60)) {
    pdfLine(layout, doc, `${r.name} — UGX ${r.debt.toLocaleString()}`, { size: 10 });
  }
  return doc.output("blob");
}

export function buildWholesaleDebtorListPdfBlob(lang: Language, rows: WholesaleReceivablesRow[]): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "wholesaleDebtorListExportTitle"), { size: 14, bold: true });
  for (const r of rows) {
    pdfLine(layout, doc, `${r.name} · ${r.debt.toLocaleString()} UGX`, { size: 10 });
  }
  return doc.output("blob");
}

export async function downloadWholesaleReceivablesPdf(
  lang: Language,
  rows: WholesaleReceivablesRow[],
  totalUgx: number,
): Promise<boolean> {
  return downloadPdfBlob(
    sanitizePdfStem("waka-wholesale-receivables") + ".pdf",
    buildWholesaleReceivablesPdfBlob(lang, rows, totalUgx),
  );
}

export async function downloadWholesaleReceivablesCsv(rows: WholesaleReceivablesRow[]): Promise<boolean> {
  return downloadCsvText("waka-wholesale-receivables.csv", wholesaleReceivablesCsv(rows));
}

export async function downloadWholesaleDebtorListPdf(lang: Language, rows: WholesaleReceivablesRow[]): Promise<boolean> {
  return downloadPdfBlob(
    sanitizePdfStem("waka-wholesale-debtors") + ".pdf",
    buildWholesaleDebtorListPdfBlob(lang, rows),
  );
}
