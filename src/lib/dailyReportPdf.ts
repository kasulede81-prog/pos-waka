import type {
  CashExpense,
  CashDrawerAdjustment,
  DayCloseSummary,
  DebtPayment,
  Language,
  Product,
  ReturnRecord,
  Sale,
  ShiftRecord,
  SupplierPayment,
} from "../types";
import { dateKeyKampala } from "./datesUg";
import { getCompletedFinancials } from "./financialMetrics";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { isCompletedSale } from "./saleStatus";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import type { ProductRank } from "./localReporting";
import { resolveReportAuthority } from "./closedDayAuthority";
import {
  statusFromAuthority,
  ugxLabel,
  type ReportDocumentModel,
  type ReportDocumentSection,
} from "./reportDocumentModel";
import { renderReportDocumentPdf } from "./reportDocumentPdf";
import { downloadReportPdfBlob, printReportPdfBlob, shareReportPdfBlob } from "./reportDocumentPrint";

export type DailyReportPdfInput = {
  lang: Language;
  dateKey: string;
  shopName: string;
  sales: Sale[];
  products: Product[];
  returnRecords: ReturnRecord[];
  debtPayments: DebtPayment[];
  cashExpenses: CashExpense[];
  supplierPayments?: SupplierPayment[];
  cashDrawerAdjustments?: CashDrawerAdjustment[];
  shifts?: ShiftRecord[];
  topProducts: ProductRank[];
  /** When false, profit line is omitted (Free tier). */
  includeProfit?: boolean;
  dayCloses?: DayCloseSummary[];
  organizationName?: string | null;
};

function paymentMethodBreakdown(sales: Sale[], day: string): Array<{ label: string; count: number; ugx: number }> {
  const scoped = sales.filter((s) => isCompletedSale(s) && dateKeyKampala(s.createdAt) === day);
  const map = new Map<string, { count: number; ugx: number }>();
  for (const s of scoped) {
    const m = (s as Sale & { paymentMethod?: string }).paymentMethod ?? (s.debtUgx > 0 ? "credit" : "cash");
    const label = String(m);
    const cur = map.get(label) ?? { count: 0, ugx: 0 };
    map.set(label, { count: cur.count + 1, ugx: cur.ugx + s.totalUgx });
  }
  return [...map.entries()].map(([label, v]) => ({ label, ...v }));
}

function voidLineCount(sales: Sale[], day: string): number {
  let n = 0;
  for (const s of sales) {
    if (dateKeyKampala(s.createdAt) !== day) continue;
    for (const ln of s.lines) {
      if (ln.voided) n += 1;
    }
  }
  return n;
}

export function buildDailyReportDocument(input: DailyReportPdfInput): ReportDocumentModel {
  const {
    lang,
    dateKey,
    shopName,
    sales,
    products,
    returnRecords,
    debtPayments,
    cashExpenses,
    supplierPayments = [],
    cashDrawerAdjustments = [],
    shifts = [],
    topProducts,
    includeProfit = true,
    dayCloses,
    organizationName,
  } = input;
  const fin = getCompletedFinancials(sales, returnRecords, products, { day: dateKey });
  const auth = resolveReportAuthority(dayCloses, dateKey);
  const frozen = auth.frozenTotals;
  const drawer = getDrawerCashForDayInput({
    sales,
    returns: returnRecords,
    products,
    debtPayments,
    cashExpenses,
    supplierPayments,
    cashDrawerAdjustments,
    shifts,
    day: dateKey,
  });
  const payments = paymentMethodBreakdown(sales, dateKey);
  const voids = voidLineCount(sales, dateKey);
  const salesUgx = frozen?.totalSalesUgx ?? fin.revenueUgx;
  const profitUgx = frozen?.profitEstimateUgx ?? fin.profitUgx;
  const cashInHandUgx = frozen?.cashFromSalesUgx ?? fin.cashCollectedUgx;
  const expectedCashUgx = frozen?.expectedCashUgx ?? drawer.expectedDrawerCashUgx;
  const openingFloatUgx = frozen?.openingFloatUgx ?? drawer.openingFloatUgx;
  const adjustmentInUgx = frozen?.adjustmentInflowsUgx ?? drawer.adjustmentInflowsUgx;
  const adjustmentOutUgx = frozen?.adjustmentOutflowsUgx ?? drawer.adjustmentOutflowsUgx;
  const supplierUgx = frozen?.supplierPaymentsUgx ?? drawer.supplierPaymentsUgx;
  const debtUgx = frozen?.totalDebtUgx ?? fin.debtIssuedUgx;
  const refundLineUgx = frozen?.cashRefundsUgx ?? drawer.cashRefundsUgx;
  const expenseLineUgx = frozen?.expenseUgx ?? drawer.expenseUgx;
  const txnCount = frozen?.transactionCount ?? fin.transactionCount;

  const ledgerRows = [
    { label: t(lang, "totalSales"), value: ugxLabel(salesUgx), bold: true },
    ...(includeProfit ? [{ label: t(lang, "estimatedProfit"), value: ugxLabel(profitUgx) }] : []),
    { label: t(lang, "cashInHand"), value: ugxLabel(cashInHandUgx) },
    { label: t(lang, "ownerCardExpectedCash"), value: ugxLabel(expectedCashUgx) },
    ...(openingFloatUgx > 0 ? [{ label: t(lang, "cashDrawerOpeningFloat"), value: ugxLabel(openingFloatUgx) }] : []),
    ...(adjustmentInUgx > 0 ? [{ label: t(lang, "cashDrawerAdjustmentIn"), value: ugxLabel(adjustmentInUgx) }] : []),
    ...(adjustmentOutUgx > 0 ? [{ label: t(lang, "cashDrawerAdjustmentOut"), value: ugxLabel(adjustmentOutUgx) }] : []),
    ...(supplierUgx > 0 ? [{ label: t(lang, "closeDaySupplierPaymentsToday"), value: ugxLabel(supplierUgx) }] : []),
    { label: t(lang, "creditLabel"), value: ugxLabel(debtUgx) },
    { label: t(lang, "dayCloseRefunds"), value: ugxLabel(refundLineUgx) },
    { label: t(lang, "closeDayExpensesToday"), value: ugxLabel(expenseLineUgx) },
    { label: t(lang, "salesCount"), value: String(txnCount) },
  ];

  const liveSection: ReportDocumentSection = {
    title: t(lang, "dailyReportPaymentMethods"),
    live: auth.closed,
    rows: [
      { label: t(lang, "dailyReportVoids"), value: String(voids) },
      ...payments.map((p) => ({ label: p.label, value: `${p.count} · ${ugxLabel(p.ugx)}` })),
      ...topProducts.slice(0, 12).map((p) => ({
        label: p.name,
        value: `${p.quantity} — ${ugxLabel(p.revenueUgx)}`,
      })),
    ],
  };

  return {
    kind: "daily",
    lang,
    shopName,
    organizationName,
    title: t(lang, "dailyReportPdfTitle"),
    periodLabel: dateKey,
    status: statusFromAuthority(auth.closed ? "closed_snapshot" : "live", true),
    generatedAtIso: new Date().toISOString(),
    empty: txnCount === 0 && payments.length === 0,
    sections: [
      {
        title: auth.closed ? t(lang, "reportDocClosedHeadlines") : undefined,
        rows: ledgerRows,
      },
      liveSection,
    ],
  };
}

export function buildDailyReportPdfBlob(input: DailyReportPdfInput): Blob {
  return renderReportDocumentPdf(buildDailyReportDocument(input));
}

function dailyPdfFilename(dateKey: string): string {
  return sanitizePdfStem(`waka-daily-report-${dateKey}`) + ".pdf";
}

export async function downloadDailyReportPdf(input: DailyReportPdfInput): Promise<boolean> {
  const blob = buildDailyReportPdfBlob(input);
  return downloadReportPdfBlob(dailyPdfFilename(input.dateKey), blob);
}

export async function printDailyReportPdf(input: DailyReportPdfInput): Promise<boolean> {
  const blob = buildDailyReportPdfBlob(input);
  return printReportPdfBlob("reports", dailyPdfFilename(input.dateKey), blob, {
    title: t(input.lang, "dailyReportPdfTitle"),
    shareDialogTitle: t(input.lang, "dailyReportPdfTitle"),
  });
}

export async function shareDailyReportPdf(input: DailyReportPdfInput): Promise<boolean> {
  const blob = buildDailyReportPdfBlob(input);
  return shareReportPdfBlob(dailyPdfFilename(input.dateKey), blob, t(input.lang, "dailyReportPdfTitle"));
}
