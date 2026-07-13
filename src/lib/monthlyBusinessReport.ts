import { jsPDF } from "jspdf";
import type { CashExpense, Language, Product, ReturnRecord, Sale, StaffAccount } from "../types";
import { sumCashExpensesInMonth } from "./cashReconciliation";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials, revenueSalesInMonth } from "./financialMetrics";
import { inventoryValueAtCostUgx } from "./costPrecision";
import { saveExportedFile } from "./fileDownload";
import { printDocumentNativeFallback } from "./nativePrintFallback";
import { t } from "./i18n";

export type MonthlyBusinessReport = {
  monthKey: string;
  shopName: string;
  generatedAt: string;
  totalSalesUgx: number;
  transactionCount: number;
  cashUgx: number;
  debtUgx: number;
  discountsUgx: number;
  refundsUgx: number;
  /** Gross margin on sales (before cash expenses). */
  profitUgx: number;
  cashExpensesUgx: number;
  /** Gross profit minus cash expenses recorded in the month. */
  netProfitUgx: number;
  topProducts: Array<{ name: string; qty: number; revenueUgx: number }>;
  byCashier: Array<{ label: string; count: number; revenueUgx: number }>;
  inventorySummary: {
    productCount: number;
    stockValueAtCostUgx: number;
    lowStockCount: number;
  };
};

function isValidMonthKey(monthKey: string): boolean {
  return /^\d{4}-\d{2}$/.test(monthKey);
}

export function salesInMonth(sales: Sale[], monthKey: string): Sale[] {
  if (!isValidMonthKey(monthKey)) return [];
  return revenueSalesInMonth(sales, monthKey);
}

export function returnsInMonth(returns: ReturnRecord[], monthKey: string): ReturnRecord[] {
  if (!isValidMonthKey(monthKey)) return [];
  return returns.filter((r) => dateKeyKampala(r.createdAt).startsWith(monthKey));
}

export function buildMonthlyBusinessReport(params: {
  monthKey: string;
  shopName: string;
  sales: Sale[];
  returnRecords: ReturnRecord[];
  products: Product[];
  staffAccounts: StaffAccount[];
  cashExpenses?: CashExpense[];
}): MonthlyBusinessReport {
  const { monthKey, shopName, sales, returnRecords, products, staffAccounts, cashExpenses = [] } = params;
  const monthSales = salesInMonth(sales, monthKey);
  const monthReturns = returnsInMonth(returnRecords, monthKey);
  const fin = getCompletedFinancials(sales, returnRecords, products, { monthKey });
  const expensesUgx = sumCashExpensesInMonth(cashExpenses, monthKey);

  const productMap = new Map<string, { name: string; qty: number; revenueUgx: number }>();
  for (const sale of monthSales) {
    for (const line of sale.lines) {
      if (line.voided) continue;
      const cur = productMap.get(line.productId) ?? { name: line.name, qty: 0, revenueUgx: 0 };
      productMap.set(line.productId, {
        name: line.name,
        qty: cur.qty + line.quantity,
        revenueUgx: cur.revenueUgx + line.lineTotalUgx,
      });
    }
  }

  const staffName = new Map(staffAccounts.map((s) => [s.id, s.name]));
  const cashierMap = new Map<string, { label: string; count: number; revenueUgx: number }>();
  for (const sale of monthSales) {
    const uid = sale.soldByUserId ?? "unknown";
    let label = uid;
    if (uid.startsWith("staff:")) {
      label = staffName.get(uid.slice("staff:".length)) ?? t("en", "role_cashier");
    } else if (uid.startsWith("local:") || uid.startsWith("sb:")) {
      label = t("en", "role_owner");
    }
    const cur = cashierMap.get(uid) ?? { label, count: 0, revenueUgx: 0 };
    cashierMap.set(uid, { label: cur.label, count: cur.count + 1, revenueUgx: cur.revenueUgx + sale.totalUgx });
  }

  const lowStockCount = products.filter((p) => p.stockOnHand <= (p.minimumStockAlert ?? 5)).length;
  const stockValueAtCostUgx = inventoryValueAtCostUgx(products);

  return {
    monthKey,
    shopName,
    generatedAt: new Date().toISOString(),
    totalSalesUgx: fin.revenueUgx,
    transactionCount: fin.transactionCount,
    cashUgx: fin.cashCollectedUgx,
    debtUgx: fin.debtIssuedUgx,
    discountsUgx: fin.discountsUgx,
    refundsUgx: monthReturns.reduce((a, r) => a + Math.max(0, r.refundAmountUgx), 0),
    profitUgx: fin.profitUgx,
    cashExpensesUgx: expensesUgx,
    netProfitUgx: fin.profitUgx - expensesUgx,
    topProducts: [...productMap.values()].sort((a, b) => b.revenueUgx - a.revenueUgx).slice(0, 15),
    byCashier: [...cashierMap.values()].sort((a, b) => b.revenueUgx - a.revenueUgx),
    inventorySummary: {
      productCount: products.length,
      stockValueAtCostUgx,
      lowStockCount,
    },
  };
}

export function formatMonthlyReportPlain(
  lang: Language,
  report: MonthlyBusinessReport,
  opts: { includeProfit: boolean },
): string {
  const lines: string[] = [];
  lines.push(`${report.shopName} — ${t(lang, "monthlyReportTitle")} ${report.monthKey}`);
  lines.push(`${t(lang, "monthlyReportGenerated")}: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push("");
  lines.push(`${t(lang, "totalSales")}: UGX ${report.totalSalesUgx.toLocaleString()}`);
  lines.push(`${t(lang, "monthlyReportTransactions")}: ${report.transactionCount}`);
  lines.push(`${t(lang, "cashInHand")}: UGX ${report.cashUgx.toLocaleString()}`);
  lines.push(`${t(lang, "creditLabel")}: UGX ${report.debtUgx.toLocaleString()}`);
  lines.push(`${t(lang, "monthlyReportDiscounts")}: UGX ${report.discountsUgx.toLocaleString()}`);
  lines.push(`${t(lang, "monthlyReportRefunds")}: UGX ${report.refundsUgx.toLocaleString()}`);
  if (opts.includeProfit) {
    lines.push(`${t(lang, "estimatedProfit")}: UGX ${report.profitUgx.toLocaleString()}`);
  }
  lines.push("");
  lines.push(t(lang, "monthlyReportTopProducts"));
  for (const p of report.topProducts.slice(0, 10)) {
    lines.push(`  · ${p.name} — ${p.qty} · UGX ${p.revenueUgx.toLocaleString()}`);
  }
  lines.push("");
  lines.push(t(lang, "monthlyReportByCashier"));
  for (const c of report.byCashier) {
    lines.push(`  · ${c.label} — ${c.count} · UGX ${c.revenueUgx.toLocaleString()}`);
  }
  lines.push("");
  lines.push(t(lang, "monthlyReportInventory"));
  lines.push(
    `  ${t(lang, "monthlyReportProductCount")}: ${report.inventorySummary.productCount} · ${t(lang, "monthlyReportStockValue")}: UGX ${report.inventorySummary.stockValueAtCostUgx.toLocaleString()} · ${t(lang, "monthlyReportLowStock")}: ${report.inventorySummary.lowStockCount}`,
  );
  return lines.join("\n");
}

export function monthlyReportToCsv(report: MonthlyBusinessReport, opts: { includeProfit: boolean }): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows: string[] = [];
  rows.push(["section", "label", "value"].map(esc).join(","));
  rows.push(["summary", "month", report.monthKey].map(esc).join(","));
  rows.push(["summary", "total_sales_ugx", report.totalSalesUgx].map(esc).join(","));
  rows.push(["summary", "transactions", report.transactionCount].map(esc).join(","));
  rows.push(["summary", "cash_ugx", report.cashUgx].map(esc).join(","));
  rows.push(["summary", "debt_ugx", report.debtUgx].map(esc).join(","));
  rows.push(["summary", "discounts_ugx", report.discountsUgx].map(esc).join(","));
  rows.push(["summary", "refunds_ugx", report.refundsUgx].map(esc).join(","));
  if (opts.includeProfit) {
    rows.push(["summary", "profit_ugx", report.profitUgx].map(esc).join(","));
  }
  rows.push(["summary", "products_count", report.inventorySummary.productCount].map(esc).join(","));
  rows.push(["summary", "stock_value_cost_ugx", report.inventorySummary.stockValueAtCostUgx].map(esc).join(","));
  for (const p of report.topProducts) {
    rows.push(["product", p.name, `${p.qty}|${p.revenueUgx}`].map(esc).join(","));
  }
  for (const c of report.byCashier) {
    rows.push(["cashier", c.label, `${c.count}|${c.revenueUgx}`].map(esc).join(","));
  }
  return "\uFEFF" + rows.join("\n");
}

export async function downloadTextFile(filename: string, body: string, mime: string): Promise<boolean> {
  return saveExportedFile(filename, body, mime);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMonthlyReportHtml(
  lang: Language,
  report: MonthlyBusinessReport,
  opts: { includeProfit: boolean },
): string {
  const rows = [
    [t(lang, "totalSales"), `UGX ${report.totalSalesUgx.toLocaleString()}`],
    [t(lang, "monthlyReportTransactions"), String(report.transactionCount)],
    [t(lang, "cashInHand"), `UGX ${report.cashUgx.toLocaleString()}`],
    [t(lang, "creditLabel"), `UGX ${report.debtUgx.toLocaleString()}`],
    [t(lang, "monthlyReportDiscounts"), `UGX ${report.discountsUgx.toLocaleString()}`],
    [t(lang, "monthlyReportRefunds"), `UGX ${report.refundsUgx.toLocaleString()}`],
    ...(opts.includeProfit
      ? [[t(lang, "estimatedProfit"), `UGX ${report.profitUgx.toLocaleString()}`] as [string, string]]
      : []),
  ];
  const productRows = report.topProducts
    .slice(0, 15)
    .map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>UGX ${p.revenueUgx.toLocaleString()}</td></tr>`)
    .join("");
  const cashierRows = report.byCashier
    .map((c) => `<tr><td>${escapeHtml(c.label)}</td><td>${c.count}</td><td>UGX ${c.revenueUgx.toLocaleString()}</td></tr>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.shopName)} ${report.monthKey}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;color:#111}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px}
table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
th{background:#f5f5f5}
.summary td:first-child{font-weight:700;width:45%}
@media print{body{padding:12px}}
</style></head><body>
<h1>${escapeHtml(report.shopName)}</h1>
<p><strong>${escapeHtml(t(lang, "monthlyReportTitle"))}</strong> ${escapeHtml(report.monthKey)}<br>
${escapeHtml(t(lang, "monthlyReportGenerated"))}: ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p>
<table class="summary">${rows.map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join("")}</table>
<h2>${escapeHtml(t(lang, "monthlyReportTopProducts"))}</h2>
<table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>${productRows}</tbody></table>
<h2>${escapeHtml(t(lang, "monthlyReportByCashier"))}</h2>
<table><thead><tr><th>Cashier</th><th>Sales</th><th>Revenue</th></tr></thead><tbody>${cashierRows}</tbody></table>
<h2>${escapeHtml(t(lang, "monthlyReportInventory"))}</h2>
<p>${escapeHtml(t(lang, "monthlyReportProductCount"))}: ${report.inventorySummary.productCount} · 
${escapeHtml(t(lang, "monthlyReportStockValue"))}: UGX ${report.inventorySummary.stockValueAtCostUgx.toLocaleString()} · 
${escapeHtml(t(lang, "monthlyReportLowStock"))}: ${report.inventorySummary.lowStockCount}</p>
</body></html>`;
}

export function buildMonthlyReportPdfBlob(
  lang: Language,
  report: MonthlyBusinessReport,
  opts: { includeProfit: boolean },
): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const line = (text: string, size = 11, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, 515);
    for (const ln of lines) {
      if (y > 760) {
        doc.addPage();
        y = margin;
      }
      doc.text(ln, margin, y);
      y += size + 4;
    }
  };

  line(`${report.shopName}`, 16, true);
  line(`${t(lang, "monthlyReportTitle")} ${report.monthKey}`, 13, true);
  y += 8;
  line(`${t(lang, "totalSales")}: UGX ${report.totalSalesUgx.toLocaleString()}`, 11, true);
  line(`${t(lang, "monthlyReportTransactions")}: ${report.transactionCount}`);
  line(`${t(lang, "cashInHand")}: UGX ${report.cashUgx.toLocaleString()}`);
  line(`${t(lang, "creditLabel")}: UGX ${report.debtUgx.toLocaleString()}`);
  line(`${t(lang, "monthlyReportDiscounts")}: UGX ${report.discountsUgx.toLocaleString()}`);
  line(`${t(lang, "monthlyReportRefunds")}: UGX ${report.refundsUgx.toLocaleString()}`);
  if (opts.includeProfit) {
    line(`${t(lang, "estimatedProfit")}: UGX ${report.profitUgx.toLocaleString()}`);
  }
  y += 10;
  line(t(lang, "monthlyReportTopProducts"), 12, true);
  for (const p of report.topProducts.slice(0, 12)) {
    line(`  ${p.name} — ${p.qty} sold — UGX ${p.revenueUgx.toLocaleString()}`);
  }
  y += 8;
  line(t(lang, "monthlyReportByCashier"), 12, true);
  for (const c of report.byCashier) {
    line(`  ${c.label} — ${c.count} sales — UGX ${c.revenueUgx.toLocaleString()}`);
  }
  return doc.output("blob");
}

export async function printMonthlyReport(
  lang: Language,
  report: MonthlyBusinessReport,
  opts: { includeProfit: boolean },
): Promise<boolean> {
  const html = buildMonthlyReportHtml(lang, report, opts);
  const filename = `waka-monthly-${report.monthKey}.pdf`;
  return printDocumentNativeFallback({
    pdfFilename: filename,
    buildPdfBlob: () => buildMonthlyReportPdfBlob(lang, report, opts),
    htmlBody: html.replace(/<\/?html[^>]*>|<\/?head[^>]*>|<\/?body[^>]*>/gi, ""),
    paper: "a4",
    title: `${report.shopName} ${report.monthKey}`,
    shareDialogTitle: t(lang, "monthlyReportPrint"),
  });
}

export async function downloadMonthlyReportWord(
  lang: Language,
  report: MonthlyBusinessReport,
  opts: { includeProfit: boolean },
): Promise<boolean> {
  const html = buildMonthlyReportHtml(lang, report, opts);
  return saveExportedFile(`waka-monthly-${report.monthKey}.doc`, html, "application/msword;charset=utf-8");
}

export async function downloadMonthlyReportPdf(
  lang: Language,
  report: MonthlyBusinessReport,
  opts: { includeProfit: boolean },
): Promise<boolean> {
  try {
    const filename = `waka-monthly-${report.monthKey}.pdf`;
    const pdfBlob = buildMonthlyReportPdfBlob(lang, report, opts);
    return saveExportedFile(filename, pdfBlob, "application/pdf");
  } catch {
    return false;
  }
}
