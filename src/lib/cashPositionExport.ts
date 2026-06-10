import { jsPDF } from "jspdf";
import type { Language } from "../types";
import { t } from "./i18n";
import { createPdfLayout, ensurePdfSpace, pdfGap, pdfLine, sanitizePdfStem } from "./pdfLayout";
import { downloadPdfBlob } from "./documentPrint";
import { downloadTextFile } from "./monthlyBusinessReport";
import type { CashPositionReconciliation, CashPositionReport } from "./cashPosition";

function paymentLabel(lang: Language, key: string): string {
  const map: Record<string, string> = {
    cash: t(lang, "cashPositionPayCash"),
    mobile_money: t(lang, "cashPositionPayMobile"),
    card: t(lang, "cashPositionPayCard"),
    bank_transfer: t(lang, "cashPositionPayBank"),
    credit: t(lang, "cashPositionPayCredit"),
  };
  return map[key] ?? key;
}

function varianceLabel(lang: Language, kind: CashPositionReconciliation["varianceKind"]): string {
  if (kind === "balanced") return t(lang, "cashPositionBalanced");
  if (kind === "shortage") return t(lang, "cashPositionShortage");
  return t(lang, "cashPositionExcess");
}

function appendCashPositionSections(
  lang: Language,
  report: CashPositionReport,
  reconciliation: CashPositionReconciliation | null | undefined,
  lines: string[],
): void {
  lines.push(`${t(lang, "cashPositionTotalSales")}: UGX ${report.summary.totalSalesUgx.toLocaleString()}`);
  lines.push(`${t(lang, "cashPositionTransactions")}: ${report.summary.transactionCount}`);
  lines.push(`${t(lang, "cashPositionItemsSold")}: ${report.summary.itemsSold.toLocaleString()}`);
  lines.push("");
  lines.push(t(lang, "cashPositionSectionPayments"));
  for (const row of report.paymentMethods) {
    lines.push(
      `  ${paymentLabel(lang, row.key)}: UGX ${row.amountUgx.toLocaleString()} (${row.percent}%) · ${row.transactionCount}`,
    );
  }
  if (report.paymentAdjustmentUgx !== 0) {
    lines.push(
      `  ${t(lang, "cashPositionPaymentAdjustment")}: UGX ${report.paymentAdjustmentUgx.toLocaleString()}`,
    );
  }
  lines.push(`  ${t(lang, "cashPositionGrandTotal")}: UGX ${report.summary.totalSalesUgx.toLocaleString()}`);
  lines.push("");
  lines.push(t(lang, "cashPositionSectionCash"));
  lines.push(`  ${t(lang, "cashPositionCashSales")}: UGX ${report.cashPosition.cashSalesUgx.toLocaleString()}`);
  lines.push(
    `  ${t(lang, "cashPositionDebtCollected")}: UGX ${report.cashPosition.debtCollectedUgx.toLocaleString()}`,
  );
  lines.push(`  ${t(lang, "cashPositionRefunds")}: UGX ${report.cashPosition.refundsUgx.toLocaleString()}`);
  lines.push(`  ${t(lang, "cashPositionExpenses")}: UGX ${report.cashPosition.expensesUgx.toLocaleString()}`);
  lines.push(
    `  ${t(lang, "cashPositionSupplierPayments")}: UGX ${report.cashPosition.supplierPaymentsUgx.toLocaleString()}`,
  );
  lines.push(
    `  ${t(lang, "cashPositionExpectedCash")}: UGX ${report.cashPosition.expectedCashUgx.toLocaleString()}`,
  );
  if (reconciliation) {
    lines.push("");
    lines.push(t(lang, "cashPositionSectionReconcile"));
    lines.push(`  ${t(lang, "cashPositionPhysicalCount")}: UGX ${reconciliation.physicalCountUgx.toLocaleString()}`);
    lines.push(
      `  ${t(lang, "cashPositionExpectedLabel")}: UGX ${report.cashPosition.expectedCashUgx.toLocaleString()}`,
    );
    lines.push(`  ${t(lang, "cashPositionActualLabel")}: UGX ${reconciliation.physicalCountUgx.toLocaleString()}`);
    lines.push(
      `  ${t(lang, "cashPositionVariance")}: ${reconciliation.varianceUgx >= 0 ? "+" : ""}UGX ${reconciliation.varianceUgx.toLocaleString()} · ${varianceLabel(lang, reconciliation.varianceKind)}`,
    );
  }
  lines.push("");
  lines.push(t(lang, "cashPositionSectionCategories"));
  for (const row of report.categories) {
    lines.push(`  ${row.categoryLabel}: UGX ${row.amountUgx.toLocaleString()} (${row.percent}%)`);
  }
  lines.push("");
  lines.push(t(lang, "cashPositionSectionCashiers"));
  for (const row of report.cashiers) {
    lines.push(
      `  ${row.name}: UGX ${row.salesUgx.toLocaleString()} · ${row.transactionCount} ${t(lang, "cashPositionTransactions").toLowerCase()}`,
    );
  }
}

export function cashPositionToPlainText(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): string {
  const lines: string[] = [];
  lines.push(`${report.shopName} — ${t(lang, "cashPositionTitle")}`);
  lines.push(`${t(lang, "cashPositionToday")}: ${report.dayKey}`);
  lines.push("");
  appendCashPositionSections(lang, report, reconciliation, lines);
  return lines.join("\n");
}

export function cashPositionToCsv(
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows: string[] = [];
  rows.push(["section", "label", "value"].map(esc).join(","));
  rows.push(["summary", "day", report.dayKey].map(esc).join(","));
  rows.push(["summary", "total_sales_ugx", report.summary.totalSalesUgx].map(esc).join(","));
  rows.push(["summary", "transactions", report.summary.transactionCount].map(esc).join(","));
  rows.push(["summary", "items_sold", report.summary.itemsSold].map(esc).join(","));
  rows.push(["cash", "cash_sales_ugx", report.cashPosition.cashSalesUgx].map(esc).join(","));
  rows.push(["cash", "debt_collected_ugx", report.cashPosition.debtCollectedUgx].map(esc).join(","));
  rows.push(["cash", "refunds_ugx", report.cashPosition.refundsUgx].map(esc).join(","));
  rows.push(["cash", "expenses_ugx", report.cashPosition.expensesUgx].map(esc).join(","));
  rows.push(["cash", "supplier_payments_ugx", report.cashPosition.supplierPaymentsUgx].map(esc).join(","));
  rows.push(["cash", "expected_cash_ugx", report.cashPosition.expectedCashUgx].map(esc).join(","));
  if (report.paymentAdjustmentUgx !== 0) {
    rows.push(["payment", "adjustment", report.paymentAdjustmentUgx].map(esc).join(","));
  }
  for (const p of report.paymentMethods) {
    rows.push(["payment", p.key, `${p.amountUgx}|${p.percent}|${p.transactionCount}`].map(esc).join(","));
  }
  for (const c of report.categories) {
    rows.push(["category", c.categoryLabel, `${c.amountUgx}|${c.percent}`].map(esc).join(","));
  }
  for (const c of report.cashiers) {
    rows.push(["cashier", c.cashierId, `${c.name}|${c.salesUgx}|${c.transactionCount}|${c.kind}`].map(esc).join(","));
  }
  if (reconciliation) {
    rows.push(["reconcile", "physical_count_ugx", reconciliation.physicalCountUgx].map(esc).join(","));
    rows.push(["reconcile", "variance_ugx", reconciliation.varianceUgx].map(esc).join(","));
    rows.push(["reconcile", "variance_kind", reconciliation.varianceKind].map(esc).join(","));
  }
  return "\uFEFF" + rows.join("\n");
}

export function buildCashPositionPdfBlob(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const layout = createPdfLayout(doc);
  pdfLine(layout, doc, report.shopName, { size: 14, bold: true });
  pdfGap(layout, 4);
  pdfLine(layout, doc, t(lang, "cashPositionTitle"), { size: 13, bold: true });
  pdfLine(layout, doc, `${t(lang, "cashPositionToday")}: ${report.dayKey}`);
  pdfGap(layout, 6);
  pdfLine(layout, doc, `${t(lang, "cashPositionTotalSales")}: UGX ${report.summary.totalSalesUgx.toLocaleString()}`, {
    bold: true,
  });
  pdfLine(layout, doc, `${t(lang, "cashPositionTransactions")}: ${report.summary.transactionCount}`);
  pdfLine(layout, doc, `${t(lang, "cashPositionItemsSold")}: ${report.summary.itemsSold.toLocaleString()}`);
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "cashPositionSectionPayments"), { bold: true });
  for (const row of report.paymentMethods) {
    pdfLine(
      layout,
      doc,
      `${paymentLabel(lang, row.key)}: UGX ${row.amountUgx.toLocaleString()} (${row.percent}%) · ${row.transactionCount}`,
    );
  }
  if (report.paymentAdjustmentUgx !== 0) {
    pdfLine(
      layout,
      doc,
      `${t(lang, "cashPositionPaymentAdjustment")}: UGX ${report.paymentAdjustmentUgx.toLocaleString()}`,
    );
  }
  pdfLine(
    layout,
    doc,
    `${t(lang, "cashPositionGrandTotal")}: UGX ${report.summary.totalSalesUgx.toLocaleString()}`,
    { bold: true },
  );
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "cashPositionSectionCash"), { bold: true });
  pdfLine(layout, doc, `${t(lang, "cashPositionCashSales")}: UGX ${report.cashPosition.cashSalesUgx.toLocaleString()}`);
  pdfLine(
    layout,
    doc,
    `${t(lang, "cashPositionDebtCollected")}: UGX ${report.cashPosition.debtCollectedUgx.toLocaleString()}`,
  );
  pdfLine(layout, doc, `${t(lang, "cashPositionRefunds")}: UGX ${report.cashPosition.refundsUgx.toLocaleString()}`);
  pdfLine(layout, doc, `${t(lang, "cashPositionExpenses")}: UGX ${report.cashPosition.expensesUgx.toLocaleString()}`);
  pdfLine(
    layout,
    doc,
    `${t(lang, "cashPositionSupplierPayments")}: UGX ${report.cashPosition.supplierPaymentsUgx.toLocaleString()}`,
  );
  pdfLine(
    layout,
    doc,
    `${t(lang, "cashPositionExpectedCash")}: UGX ${report.cashPosition.expectedCashUgx.toLocaleString()}`,
    { bold: true },
  );
  if (reconciliation) {
    pdfGap(layout, 6);
    pdfLine(layout, doc, t(lang, "cashPositionSectionReconcile"), { bold: true });
    pdfLine(
      layout,
      doc,
      `${t(lang, "cashPositionPhysicalCount")}: UGX ${reconciliation.physicalCountUgx.toLocaleString()}`,
    );
    pdfLine(
      layout,
      doc,
      `${t(lang, "cashPositionExpectedLabel")}: UGX ${report.cashPosition.expectedCashUgx.toLocaleString()}`,
    );
    pdfLine(
      layout,
      doc,
      `${t(lang, "cashPositionActualLabel")}: UGX ${reconciliation.physicalCountUgx.toLocaleString()}`,
    );
    pdfLine(
      layout,
      doc,
      `${t(lang, "cashPositionVariance")}: ${reconciliation.varianceUgx >= 0 ? "+" : ""}UGX ${reconciliation.varianceUgx.toLocaleString()} · ${varianceLabel(lang, reconciliation.varianceKind)}`,
    );
  }
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "cashPositionSectionCategories"), { bold: true });
  for (const row of report.categories) {
    ensurePdfSpace(layout, doc, 14);
    pdfLine(layout, doc, `${row.categoryLabel}: UGX ${row.amountUgx.toLocaleString()} (${row.percent}%)`);
  }
  pdfGap(layout, 6);
  pdfLine(layout, doc, t(lang, "cashPositionSectionCashiers"), { bold: true });
  for (const row of report.cashiers) {
    ensurePdfSpace(layout, doc, 14);
    pdfLine(
      layout,
      doc,
      `${row.name}: UGX ${row.salesUgx.toLocaleString()} · ${row.transactionCount}`,
    );
  }
  return doc.output("blob");
}

export async function downloadCashPositionPdf(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Promise<boolean> {
  const blob = buildCashPositionPdfBlob(lang, report, reconciliation);
  const stem = sanitizePdfStem(`cash-position-${report.dayKey}`);
  return downloadPdfBlob(`${stem}.pdf`, blob);
}

export async function downloadCashPositionCsv(
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Promise<boolean> {
  return downloadTextFile(
    `waka-cash-position-${report.dayKey}.csv`,
    cashPositionToCsv(report, reconciliation),
    "text/csv;charset=utf-8",
  );
}

export async function downloadCashPositionExcel(
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Promise<boolean> {
  return downloadTextFile(
    `waka-cash-position-${report.dayKey}.xls`,
    cashPositionToCsv(report, reconciliation),
    "application/vnd.ms-excel;charset=utf-8",
  );
}
