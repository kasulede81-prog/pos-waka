import type { Language } from "../types";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import { downloadTextFile } from "./monthlyBusinessReport";
import type { CashPositionReconciliation, CashPositionReport } from "./cashPosition";
import {
  statusFromAuthority,
  ugxLabel,
  type ReportDocumentModel,
} from "./reportDocumentModel";
import { renderReportDocumentPdf } from "./reportDocumentPdf";
import { downloadReportPdfBlob, printReportPdfBlob, shareReportPdfBlob } from "./reportDocumentPrint";

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
  if (report.ledgerClosed) {
    lines.push(t(lang, "dailyReportOperationalDetails"));
  }
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
  if (report.cashPosition.openingFloatUgx > 0) {
    lines.push(`  ${t(lang, "cashPositionOpeningFloat")}: UGX ${report.cashPosition.openingFloatUgx.toLocaleString()}`);
  }
  lines.push(`  ${t(lang, "cashPositionCashSales")}: UGX ${report.cashPosition.cashSalesUgx.toLocaleString()}`);
  lines.push(
    `  ${t(lang, "cashPositionDebtCollected")}: UGX ${report.cashPosition.debtCollectedUgx.toLocaleString()}`,
  );
  if (report.cashPosition.adjustmentInflowsUgx > 0) {
    lines.push(`  ${t(lang, "cashPositionCashAdded")}: UGX ${report.cashPosition.adjustmentInflowsUgx.toLocaleString()}`);
  }
  if (report.cashPosition.adjustmentOutflowsUgx > 0) {
    lines.push(
      `  ${t(lang, "cashPositionCashRemoved")}: UGX ${report.cashPosition.adjustmentOutflowsUgx.toLocaleString()}`,
    );
  }
  lines.push(`  ${t(lang, "cashPositionSupplierPayments")}: UGX ${report.cashPosition.supplierPaymentsUgx.toLocaleString()}`);
  lines.push(`  ${t(lang, "cashPositionExpenses")}: UGX ${report.cashPosition.expensesUgx.toLocaleString()}`);
  lines.push(`  ${t(lang, "cashPositionRefunds")}: UGX ${report.cashPosition.refundsUgx.toLocaleString()}`);
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
  rows.push(["cash", "opening_float_ugx", report.cashPosition.openingFloatUgx].map(esc).join(","));
  rows.push(["cash", "debt_collected_ugx", report.cashPosition.debtCollectedUgx].map(esc).join(","));
  rows.push(["cash", "adjustment_inflows_ugx", report.cashPosition.adjustmentInflowsUgx].map(esc).join(","));
  rows.push(["cash", "adjustment_outflows_ugx", report.cashPosition.adjustmentOutflowsUgx].map(esc).join(","));
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

export function buildCashPositionDocument(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): ReportDocumentModel {
  const live = Boolean(report.ledgerClosed);
  return {
    kind: "cash_position",
    lang,
    shopName: report.shopName,
    title: t(lang, "cashPositionTitle"),
    periodLabel: report.dayKey,
    status: statusFromAuthority(report.ledgerClosed ? "closed_snapshot" : "live", !report.dayKey.includes("…")),
    generatedAtIso: report.generatedAt,
    empty: report.summary.transactionCount === 0 && report.summary.totalSalesUgx === 0,
    sections: [
      {
        title: report.ledgerClosed ? t(lang, "reportDocClosedHeadlines") : undefined,
        rows: [
          { label: t(lang, "cashPositionTotalSales"), value: ugxLabel(report.summary.totalSalesUgx), bold: true },
          { label: t(lang, "cashPositionTransactions"), value: String(report.summary.transactionCount) },
          { label: t(lang, "cashPositionCashSales"), value: ugxLabel(report.cashPosition.cashSalesUgx) },
          { label: t(lang, "cashPositionDebtCollected"), value: ugxLabel(report.cashPosition.debtCollectedUgx) },
          { label: t(lang, "cashPositionRefunds"), value: ugxLabel(report.cashPosition.refundsUgx) },
          { label: t(lang, "cashPositionExpenses"), value: ugxLabel(report.cashPosition.expensesUgx) },
          { label: t(lang, "cashPositionSupplierPayments"), value: ugxLabel(report.cashPosition.supplierPaymentsUgx) },
          { label: t(lang, "cashPositionExpectedCash"), value: ugxLabel(report.cashPosition.expectedCashUgx), bold: true },
          ...(reconciliation
            ? [
                { label: t(lang, "cashPositionPhysicalCount"), value: ugxLabel(reconciliation.physicalCountUgx) },
                {
                  label: t(lang, "cashPositionVariance"),
                  value: `${reconciliation.varianceUgx >= 0 ? "+" : ""}${ugxLabel(Math.abs(reconciliation.varianceUgx))} · ${varianceLabel(lang, reconciliation.varianceKind)}`,
                },
              ]
            : []),
        ],
      },
      {
        title: t(lang, "cashPositionSectionPayments"),
        live,
        rows: [
          { label: t(lang, "cashPositionItemsSold"), value: report.summary.itemsSold.toLocaleString() },
          ...report.paymentMethods.map((row) => ({
            label: paymentLabel(lang, row.key),
            value: `${ugxLabel(row.amountUgx)} (${row.percent}%) · ${row.transactionCount}`,
          })),
          ...(report.paymentAdjustmentUgx !== 0
            ? [{ label: t(lang, "cashPositionPaymentAdjustment"), value: ugxLabel(report.paymentAdjustmentUgx) }]
            : []),
          { label: t(lang, "cashPositionGrandTotal"), value: ugxLabel(report.summary.totalSalesUgx), bold: true },
        ],
      },
      {
        title: t(lang, "cashPositionSectionCategories"),
        live,
        rows: report.categories.map((row) => ({
          label: row.categoryLabel,
          value: `${ugxLabel(row.amountUgx)} (${row.percent}%)`,
        })),
      },
      {
        title: t(lang, "cashPositionSectionCashiers"),
        live,
        rows: report.cashiers.map((row) => ({
          label: row.name,
          value: `${ugxLabel(row.salesUgx)} · ${row.transactionCount}`,
        })),
      },
    ],
  };
}

export function buildCashPositionPdfBlob(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Blob {
  return renderReportDocumentPdf(buildCashPositionDocument(lang, report, reconciliation));
}

function cashPositionPdfFilename(dayKey: string): string {
  return sanitizePdfStem(`cash-position-${dayKey}`) + ".pdf";
}

export async function downloadCashPositionPdf(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Promise<boolean> {
  const blob = buildCashPositionPdfBlob(lang, report, reconciliation);
  return downloadReportPdfBlob(cashPositionPdfFilename(report.dayKey), blob);
}

export async function printCashPositionReport(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Promise<boolean> {
  const blob = buildCashPositionPdfBlob(lang, report, reconciliation);
  return printReportPdfBlob("cash_position", cashPositionPdfFilename(report.dayKey), blob, {
    title: t(lang, "cashPositionTitle"),
    shareDialogTitle: "Print or share cash position",
  });
}

export async function shareCashPositionPdf(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): Promise<boolean> {
  const blob = buildCashPositionPdfBlob(lang, report, reconciliation);
  return shareReportPdfBlob(cashPositionPdfFilename(report.dayKey), blob, "Print or share cash position");
}

export function cashPositionReportPlainText(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): string {
  return cashPositionToPlainText(lang, report, reconciliation);
}

export function openCashPositionEmail(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): boolean {
  const subject = encodeURIComponent(`${report.shopName} — ${t(lang, "cashPositionTitle")} (${report.dayKey})`);
  const body = encodeURIComponent(cashPositionToPlainText(lang, report, reconciliation));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
  return true;
}

export function openCashPositionWhatsApp(
  lang: Language,
  report: CashPositionReport,
  reconciliation?: CashPositionReconciliation | null,
): boolean {
  const text = cashPositionToPlainText(lang, report, reconciliation).slice(0, 3500);
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  return true;
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
