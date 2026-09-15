import { jsPDF } from "jspdf";
import type { Language, Product } from "../types";
import { computePharmacyExpiryReport } from "./pharmacyReports";
import { computeMedicineMarginRows, sortMedicineMarginRows } from "./pharmacyCostIntegrity";
import { formatMedicineFullLabel } from "./pharmacyMedicine";
import { createPdfLayout, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadCsvText, downloadPdfBlob } from "./documentPrint";
import { t } from "./i18n";

export function pharmacyExpiryCsv(products: Product[]): string {
  const report = computePharmacyExpiryReport(products);
  const lines = ["product,expiry_date,status,qty,value_ugx"];
  for (const row of [...report.expiring, ...report.expired]) {
    const status = report.expired.some((e) => e.productId === row.productId) ? "expired" : "expiring";
    lines.push(
      `"${row.name.replace(/"/g, '""')}",${row.expiryDate},${status},${row.stockOnHand},${row.stockValueUgx}`,
    );
  }
  return lines.join("\n");
}

export function buildPharmacyExpiryPdfBlob(lang: Language, products: Product[]): Blob {
  const report = computePharmacyExpiryReport(products);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "pharmacyExpiryExportTitle"), { size: 14, bold: true });
  pdfLine(layout, doc, `${t(lang, "pharmacyReportsExpiringValue")}: UGX ${report.expiringValueUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "pharmacyReportsExpiredValue")}: UGX ${report.expiredValueUgx.toLocaleString()}`);
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "pharmacyReportsExpiring"), { bold: true });
  for (const row of report.expiring.slice(0, 40)) {
    pdfLine(layout, doc, `${row.name} · ${row.expiryDate} · UGX ${row.stockValueUgx.toLocaleString()}`, { size: 9 });
  }
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "pharmacyReportsExpired"), { bold: true });
  for (const row of report.expired.slice(0, 40)) {
    pdfLine(layout, doc, `${row.name} · ${row.expiryDate} · UGX ${row.stockValueUgx.toLocaleString()}`, { size: 9 });
  }
  return doc.output("blob");
}

export function pharmacyMarginCsv(products: Product[]): string {
  const rows = sortMedicineMarginRows(computeMedicineMarginRows(products), "highest_margin");
  const lines = [
    "product,cost_per_tablet_ugx,sell_per_tablet_ugx,margin_pct,margin_ugx,inventory_value_ugx,stock_tablets,stock_strips,stock_boxes",
  ];
  for (const r of rows) {
    lines.push(
      `"${r.name.replace(/"/g, '""')}",${r.costPerUnitUgx},${r.sellingPricePerUnitUgx},${r.marginPercent ?? ""},${r.marginUgx},${r.inventoryValueUgx},${r.stockTablets},${r.stockStrips ?? ""},${r.stockBoxes ?? ""}`,
    );
  }
  return lines.join("\n");
}

export function buildPharmacyMarginPdfBlob(lang: Language, products: Product[]): Blob {
  const rows = sortMedicineMarginRows(computeMedicineMarginRows(products), "highest_margin");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, t(lang, "pharmacyMarginReportTitle"), { size: 14, bold: true });
  for (const row of rows.slice(0, 50)) {
    const product = products.find((p) => p.id === row.productId);
    const label = product ? formatMedicineFullLabel(product) : row.name;
    pdfLine(
      layout,
      doc,
      `${label} — ${row.marginPercent ?? "—"}% · UGX ${row.inventoryValueUgx.toLocaleString()}`,
      { size: 9 },
    );
  }
  return doc.output("blob");
}

export async function downloadPharmacyExpiryPdf(lang: Language, products: Product[]): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-pharmacy-expiry") + ".pdf", buildPharmacyExpiryPdfBlob(lang, products));
}

export async function downloadPharmacyExpiryCsv(products: Product[]): Promise<boolean> {
  return downloadCsvText("waka-pharmacy-expiry.csv", pharmacyExpiryCsv(products));
}

export async function downloadPharmacyMarginPdf(lang: Language, products: Product[]): Promise<boolean> {
  return downloadPdfBlob(sanitizePdfStem("waka-pharmacy-margins") + ".pdf", buildPharmacyMarginPdfBlob(lang, products));
}

export async function downloadPharmacyMarginCsv(products: Product[]): Promise<boolean> {
  return downloadCsvText("waka-pharmacy-margins.csv", pharmacyMarginCsv(products));
}
