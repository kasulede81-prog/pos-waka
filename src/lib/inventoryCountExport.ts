import { jsPDF } from "jspdf";
import type { InventoryCountSession, Language } from "../types";
import { buildInventoryCountVarianceReport } from "./inventoryCount";
import { t } from "./i18n";
import { createPdfLayout, ensurePdfSpace, pdfGap, pdfLine } from "./pdfLayout";
import { exportCsvFile } from "./reportExportEngine";

function escCsv(v: string | number): string {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildInventoryCountVarianceCsv(lang: Language, session: InventoryCountSession): string {
  const report = buildInventoryCountVarianceReport(session);
  const header = [
    t(lang, "inventoryCountExportProduct"),
    t(lang, "inventoryCountExpected"),
    t(lang, "inventoryCountCounted"),
    t(lang, "inventoryCountVariance"),
    t(lang, "inventoryCountCostImpact"),
    t(lang, "inventoryCountRetailImpact"),
    t(lang, "inventoryCountReason"),
  ];
  const lines = [header.map(escCsv).join(",")];
  for (const ln of report.lines) {
    lines.push(
      [
        ln.productName ?? ln.productId,
        ln.expectedQtySnapshot,
        ln.countedQty ?? "",
        ln.varianceQty,
        ln.varianceCostUgx,
        ln.varianceRetailUgx,
        ln.reason,
      ]
        .map(escCsv)
        .join(","),
    );
  }
  lines.push("");
  lines.push(
    [
      t(lang, "inventoryCountTotalVariance"),
      "",
      "",
      report.totalVarianceQty,
      report.varianceCostUgx,
      report.varianceRetailUgx,
      "",
    ]
      .map(escCsv)
      .join(","),
  );
  return `\uFEFF${lines.join("\n")}`;
}

export function buildInventoryCountVariancePdfBlob(
  lang: Language,
  session: InventoryCountSession,
  shopName: string,
): Blob {
  const report = buildInventoryCountVarianceReport(session);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(
    layout,
    doc,
    `${t(lang, "inventoryCountVarianceReport")} #${session.sessionNumber}`,
    { size: 13, bold: true },
  );
  pdfGap(layout, 8);
  pdfLine(layout, doc, `${t(lang, "inventoryCountProductsCounted")}: ${report.productsCounted}`);
  pdfLine(layout, doc, `${t(lang, "inventoryCountMissingStock")}: ${report.missingQty}`);
  pdfLine(layout, doc, `${t(lang, "inventoryCountExcessStock")}: ${report.excessQty}`);
  pdfLine(layout, doc, `${t(lang, "inventoryCountTotalVariance")}: ${report.totalVarianceQty}`);
  pdfLine(layout, doc, `${t(lang, "inventoryCountCostImpact")}: UGX ${report.varianceCostUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "inventoryCountRetailImpact")}: UGX ${report.varianceRetailUgx.toLocaleString()}`);
  pdfGap(layout, 10);
  pdfLine(layout, doc, t(lang, "inventoryCountLineDetails"), { bold: true });
  for (const ln of report.lines.slice(0, 80)) {
    ensurePdfSpace(layout, doc, 28);
    pdfLine(
      layout,
      doc,
      `${ln.productName ?? ln.productId} · ${ln.expectedQtySnapshot} → ${ln.countedQty ?? "—"} (Δ ${ln.varianceQty})`,
    );
  }
  return doc.output("blob");
}

export async function downloadInventoryCountCsv(
  lang: Language,
  session: InventoryCountSession,
  filename: string,
): Promise<boolean> {
  const csv = buildInventoryCountVarianceCsv(lang, session);
  const rows = csv
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(","));
  const result = await exportCsvFile("inventory_count", filename, rows);
  return result.ok;
}

export async function downloadInventoryCountPdf(
  lang: Language,
  session: InventoryCountSession,
  shopName: string,
  filename: string,
): Promise<void> {
  const blob = buildInventoryCountVariancePdfBlob(lang, session, shopName);
  const { downloadPdfBlob } = await import("./documentPrint");
  await downloadPdfBlob(filename, blob);
}

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countSheetFilename(session: InventoryCountSession): string {
  return `count-sheet-${session.sessionNumber}.pdf`;
}

/**
 * Physical count sheet — the paper an operator carries while walking the shelves.
 * Expected quantity and a counted column that is intentionally blank when the line has
 * not been counted yet. Read-only: it prints the session snapshot and never writes a
 * counted quantity, variance, or stock movement.
 */
export function buildInventoryCountSheetPdfBlob(
  lang: Language,
  session: InventoryCountSession,
  shopName: string,
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, `${t(lang, "inventoryCountTitle")} #${session.sessionNumber}`, { size: 13, bold: true });
  pdfGap(layout, 8);
  pdfLine(layout, doc, `${t(lang, "inventoryCountExportProduct")}  |  ${t(lang, "inventoryCountExpected")}  |  ${t(lang, "inventoryCountCounted")}`, {
    bold: true,
  });
  for (const ln of session.lines) {
    ensurePdfSpace(layout, doc, 24);
    const counted = ln.countedQty == null ? "" : String(ln.countedQty);
    pdfLine(layout, doc, `${ln.productName ?? ln.productId}  |  ${ln.expectedQtySnapshot}  |  ${counted}`);
  }
  return doc.output("blob");
}

function countSheetHtml(lang: Language, session: InventoryCountSession, shopName: string): string {
  const rows = session.lines
    .map((ln) => {
      const counted = ln.countedQty == null ? "" : String(ln.countedQty);
      return `<li>${escHtml(ln.productName ?? ln.productId)} — ${t(lang, "inventoryCountExpected")}: ${ln.expectedQtySnapshot} · ${t(lang, "inventoryCountCounted")}: ${escHtml(counted)}</li>`;
    })
    .join("");
  return `<article><h1>${escHtml(shopName)}</h1><h2>${escHtml(t(lang, "inventoryCountTitle"))} #${session.sessionNumber}</h2><ul>${rows || "<li>—</li>"}</ul></article>`;
}

function varianceHtml(lang: Language, session: InventoryCountSession, shopName: string): string {
  const report = buildInventoryCountVarianceReport(session);
  const rows = report.lines
    .slice(0, 80)
    .map(
      (ln) =>
        `<li>${escHtml(ln.productName ?? ln.productId)} · ${ln.expectedQtySnapshot} → ${ln.countedQty ?? "—"} (Δ ${ln.varianceQty})</li>`,
    )
    .join("");
  return `<article><h1>${escHtml(shopName)}</h1><h2>${escHtml(t(lang, "inventoryCountVarianceReport"))} #${session.sessionNumber}</h2>
<p>${escHtml(t(lang, "inventoryCountProductsCounted"))}: ${report.productsCounted}<br/>
${escHtml(t(lang, "inventoryCountMissingStock"))}: ${report.missingQty}<br/>
${escHtml(t(lang, "inventoryCountExcessStock"))}: ${report.excessQty}<br/>
${escHtml(t(lang, "inventoryCountTotalVariance"))}: ${report.totalVarianceQty}<br/>
${escHtml(t(lang, "inventoryCountCostImpact"))}: UGX ${report.varianceCostUgx.toLocaleString()}<br/>
${escHtml(t(lang, "inventoryCountRetailImpact"))}: UGX ${report.varianceRetailUgx.toLocaleString()}</p>
<h3>${escHtml(t(lang, "inventoryCountLineDetails"))}</h3><ul>${rows || "<li>—</li>"}</ul></article>`;
}

/** Native: share a PDF. Web/desktop: isolated browser print. Returns false when neither worked. */
export async function printInventoryCountSheet(
  lang: Language,
  session: InventoryCountSession,
  shopName: string,
): Promise<boolean> {
  const { printDocumentNativeFallback } = await import("./nativePrintFallback");
  return printDocumentNativeFallback({
    pdfFilename: countSheetFilename(session),
    buildPdfBlob: () => buildInventoryCountSheetPdfBlob(lang, session, shopName),
    htmlBody: countSheetHtml(lang, session, shopName),
    paper: "a4",
    title: t(lang, "inventoryCountTitle"),
  });
}

export async function printInventoryCountVarianceReport(
  lang: Language,
  session: InventoryCountSession,
  shopName: string,
): Promise<boolean> {
  const { printDocumentNativeFallback } = await import("./nativePrintFallback");
  return printDocumentNativeFallback({
    pdfFilename: `count-variance-${session.sessionNumber}.pdf`,
    buildPdfBlob: () => buildInventoryCountVariancePdfBlob(lang, session, shopName),
    htmlBody: varianceHtml(lang, session, shopName),
    paper: "a4",
    title: t(lang, "inventoryCountVarianceReport"),
  });
}
