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
