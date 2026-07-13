import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { CashExpense, CashDrawerAdjustment, DebtPayment, Language, Product, ReturnRecord, Sale, ShiftRecord, SupplierPayment } from "../types";
import { t } from "./i18n";
import { dateKeyKampala } from "./datesUg";
import { getDrawerCashForDayInput } from "./cashReconciliation";
import { getCompletedFinancials } from "./financialMetrics";
import { logShareOutcome } from "./reportExportEngine";
import type { ReportExportKind } from "./reportExportDiagnostics";

export type DailyReportExportInput = {
  sales: Sale[];
  products: Product[];
  returnRecords: ReturnRecord[];
  debtPayments?: DebtPayment[];
  cashExpenses?: CashExpense[];
  supplierPayments?: SupplierPayment[];
  cashDrawerAdjustments?: CashDrawerAdjustment[];
  shifts?: ShiftRecord[];
  /** When false, profit line is omitted (Free tier). */
  includeProfit?: boolean;
};

/** Plain-text summary for WhatsApp / SMS / print */
export function buildDailyReportText(
  lang: Language,
  dateKey: string,
  input: DailyReportExportInput,
): string;
export function buildDailyReportText(
  lang: Language,
  dateKey: string,
  sales: Sale[],
  products: Product[],
  returnRecords: ReturnRecord[],
  debtPayments?: DebtPayment[],
  cashExpenses?: CashExpense[],
): string;
export function buildDailyReportText(
  lang: Language,
  dateKey: string,
  salesOrInput: DailyReportExportInput | Sale[],
  products?: Product[],
  returnRecords?: ReturnRecord[],
  debtPayments: DebtPayment[] = [],
  cashExpenses: CashExpense[] = [],
): string {
  const input: DailyReportExportInput = Array.isArray(salesOrInput)
    ? {
        sales: salesOrInput,
        products: products ?? [],
        returnRecords: returnRecords ?? [],
        debtPayments,
        cashExpenses,
      }
    : salesOrInput;

  const dayReturns = input.returnRecords.filter((r) => dateKeyKampala(r.createdAt) === dateKey);
  const fin = getCompletedFinancials(input.sales, dayReturns, input.products, { day: dateKey });
  const drawer = getDrawerCashForDayInput({
    sales: input.sales,
    returns: input.returnRecords,
    products: input.products,
    debtPayments: input.debtPayments ?? [],
    cashExpenses: input.cashExpenses ?? [],
    supplierPayments: input.supplierPayments ?? [],
    cashDrawerAdjustments: input.cashDrawerAdjustments ?? [],
    shifts: input.shifts ?? [],
    day: dateKey,
  });
  const total = fin.revenueUgx;
  const cash = fin.cashCollectedUgx;
  const debt = fin.debtIssuedUgx;
  const profit = fin.profitUgx;
  const includeProfit = input.includeProfit !== false;
  const lines: string[] = [];
  lines.push(`${t(lang, "appName")} — ${t(lang, "exportReportHeading")} ${dateKey}`);
  lines.push(`${t(lang, "salesCount")}: ${fin.transactionCount}`);
  lines.push(`${t(lang, "totalSales")}: UGX ${total.toLocaleString()}`);
  lines.push(`${t(lang, "cashInHand")}: UGX ${cash.toLocaleString()}`);
  lines.push(`${t(lang, "ownerCardExpectedCash")}: UGX ${drawer.expectedDrawerCashUgx.toLocaleString()}`);
  lines.push(`${t(lang, "creditLabel")}: UGX ${debt.toLocaleString()}`);
  if (includeProfit) {
    lines.push(`${t(lang, "estimatedProfit")}: UGX ${profit.toLocaleString()}`);
  }
  lines.push("");
  lines.push(t(lang, "exportReportFooter"));
  return lines.join("\n");
}

function isUserShareCancel(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
  return name === "AbortError" || msg.includes("cancel") || msg.includes("dismiss");
}

export async function shareText(
  body: string,
  title: string,
  kind: ReportExportKind = "other",
): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text: body, dialogTitle: title });
      logShareOutcome(kind, true);
      return true;
    } catch (err) {
      if (isUserShareCancel(err)) {
        logShareOutcome(kind, false, "cancelled");
        return false;
      }
      logShareOutcome(kind, false, String((err as Error)?.message ?? err));
      return false;
    }
  }

  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === "function") {
    try {
      await nav.share({ title, text: body });
      logShareOutcome(kind, true);
      return true;
    } catch (err) {
      if (isUserShareCancel(err)) {
        logShareOutcome(kind, false, "cancelled");
        return false;
      }
      logShareOutcome(kind, false, String((err as Error)?.message ?? err));
      return false;
    }
  }
  logShareOutcome(kind, false, "share_unavailable");
  return false;
}
