import { jsPDF } from "jspdf";
import type { Language } from "../types";
import { t } from "./i18n";
import { createPdfLayout, ensurePdfSpace, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob } from "./documentPrint";
import { downloadTextFile } from "./monthlyBusinessReport";
import type { PurchaseListRow, SupplierStatementEntry } from "./purchaseReporting";

export function purchasesToCsv(rows: PurchaseListRow[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["date", "supplier", "products", "quantity", "paid_ugx", "balance_ugx", "total_ugx", "purchase_id"];
  const lines = [header.map(esc).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.dayKey,
        row.purchase.supplierName,
        row.productCount,
        row.quantityReceived,
        row.purchase.amountPaidUgx,
        row.balanceRemainingUgx,
        row.purchase.totalCostUgx,
        row.purchase.id,
      ]
        .map(esc)
        .join(","),
    );
  }
  return "\uFEFF" + lines.join("\n");
}

export function buildPurchasesPdfBlob(lang: Language, shopName: string, rows: PurchaseListRow[]): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "purchasesTitle"), { size: 13, bold: true });
  pdfGap(layout, 6);
  for (const row of rows) {
    ensurePdfSpace(layout, doc, 36);
    pdfLine(
      layout,
      doc,
      `${row.dayKey} · ${row.purchase.supplierName}: UGX ${row.purchase.totalCostUgx.toLocaleString()} (paid ${row.purchase.amountPaidUgx.toLocaleString()})`,
    );
  }
  return doc.output("blob");
}

export async function downloadPurchasesCsv(rows: PurchaseListRow[], dayLabel: string): Promise<boolean> {
  return downloadTextFile(`waka-purchases-${dayLabel}.csv`, purchasesToCsv(rows), "text/csv;charset=utf-8");
}

export async function downloadPurchasesPdf(
  lang: Language,
  shopName: string,
  rows: PurchaseListRow[],
  dayLabel: string,
): Promise<boolean> {
  const blob = buildPurchasesPdfBlob(lang, shopName, rows);
  return downloadPdfBlob(`${sanitizePdfStem(`purchases-${dayLabel}`)}.pdf`, blob);
}

export function supplierStatementToCsv(supplierName: string, entries: SupplierStatementEntry[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["date", "kind", "amount_ugx", "delta_ugx", "balance_ugx", "id"].map(esc).join(",")];
  for (const e of entries) {
    lines.push(
      [e.dayKey, e.kind, e.amountUgx, e.deltaUgx, e.runningBalanceUgx, e.kind === "purchase" ? e.purchaseId : e.paymentId]
        .map(esc)
        .join(","),
    );
  }
  return "\uFEFF" + [`supplier,${esc(supplierName)}`, ...lines].join("\n");
}

export function buildSupplierStatementPdfBlob(
  lang: Language,
  shopName: string,
  supplierName: string,
  entries: SupplierStatementEntry[],
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "supplierStatementTitle"), { size: 13, bold: true });
  pdfLine(layout, doc, supplierName);
  pdfGap(layout, 6);
  for (const e of entries) {
    ensurePdfSpace(layout, doc, 28);
    const sign = e.deltaUgx >= 0 ? "+" : "";
    pdfLine(
      layout,
      doc,
      `${e.dayKey} · ${e.kind}: ${sign}UGX ${e.deltaUgx.toLocaleString()} · ${t(lang, "supplierStatementBalance")} UGX ${e.runningBalanceUgx.toLocaleString()}`,
    );
  }
  return doc.output("blob");
}

export async function downloadSupplierStatementCsv(
  supplierName: string,
  entries: SupplierStatementEntry[],
  stem: string,
): Promise<boolean> {
  return downloadTextFile(
    `waka-supplier-statement-${stem}.csv`,
    supplierStatementToCsv(supplierName, entries),
    "text/csv;charset=utf-8",
  );
}

export async function downloadSupplierStatementPdf(
  lang: Language,
  shopName: string,
  supplierName: string,
  entries: SupplierStatementEntry[],
  stem: string,
): Promise<boolean> {
  const blob = buildSupplierStatementPdfBlob(lang, shopName, supplierName, entries);
  return downloadPdfBlob(`${sanitizePdfStem(`supplier-statement-${stem}`)}.pdf`, blob);
}
