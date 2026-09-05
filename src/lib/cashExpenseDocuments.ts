/**
 * Office A4/PDF document for the cash-expenses page.
 * Rows and totals are read-only projections of the existing today-list rules.
 */

import type { CashExpense, Language } from "../types";
import { sumDrawerExpenseAmounts } from "./cashExpenses";
import { formatDateFilterViewingLabel } from "./dateFilterLabels";
import { formatDateTimeKampala } from "./datesUg";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import { ugxLabel, type ReportDocumentModel, type ReportDocumentSection } from "./reportDocumentModel";
import {
  buildReportDocumentPdfBlob,
  downloadReportPdfBlob,
  printReportDocumentModel,
  shareReportPdfBlob,
} from "./reportDocumentPrint";

export type CashExpenseDocumentScope = "all_shop" | "own";

export type CashExpenseListDocumentInput = {
  lang: Language;
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  dayKey: string;
  expenses: CashExpense[];
  /** Caller-supplied visibility scope. Not inferred here. */
  scope: CashExpenseDocumentScope;
  generatedAtIso?: string;
};

export function cashExpenseScopeLabel(lang: Language, scope: CashExpenseDocumentScope): string {
  return scope === "all_shop" ? t(lang, "cashExpenseDocScopeAll") : t(lang, "cashExpenseDocScopeMine");
}

export function cashExpenseStatusLabel(lang: Language, expense: CashExpense): string {
  const status = expense.approvalStatus ?? "approved";
  if (status === "pending") return t(lang, "expenseStatusPending");
  if (status === "rejected") return t(lang, "expenseStatusRejected");
  return t(lang, "cashExpenseDocApproved");
}

export function cashExpenseActorLabel(expense: CashExpense): string {
  return expense.createdByLabel?.trim() || expense.createdByUserId;
}

export function cashExpenseTimeLabel(iso: string): string {
  const stamp = formatDateTimeKampala(iso);
  return `${stamp.dateKey} ${stamp.time}`;
}

export function cashExpensePeriodLabel(lang: Language, dayKey: string): string {
  return formatDateFilterViewingLabel(lang, { kind: "day", dateKey: dayKey });
}

export function buildCashExpenseListDocument(input: CashExpenseListDocumentInput): ReportDocumentModel {
  const drawerTotal = sumDrawerExpenseAmounts(input.expenses);
  const empty = input.expenses.length === 0;
  const tableRecords = input.expenses.map((expense) => [
    cashExpenseTimeLabel(expense.createdAt),
    expense.category,
    expense.description?.trim() || "—",
    cashExpenseActorLabel(expense),
    cashExpenseStatusLabel(input.lang, expense),
    ugxLabel(Math.max(0, expense.amountUgx)),
  ]);

  const sections: ReportDocumentSection[] = [
    {
      rows: [
        { label: t(input.lang, "cashExpenseDocCount"), value: String(input.expenses.length) },
        { label: t(input.lang, "cashExpenseDocScope"), value: cashExpenseScopeLabel(input.lang, input.scope) },
        { label: t(input.lang, "cashExpenseDocTotal"), value: ugxLabel(drawerTotal), bold: true },
      ],
    },
    {
      title: t(input.lang, "cashExpensesListToday"),
      rows: empty ? [{ label: t(input.lang, "cashExpenseDocEmpty"), value: "" }] : [],
      table: empty
        ? undefined
        : {
            columns: [
              { header: t(input.lang, "cashExpenseDocTime"), width: 0.18 },
              { header: t(input.lang, "cashExpenseCategory"), width: 0.16 },
              { header: t(input.lang, "cashExpenseDescription"), width: 0.22 },
              { header: t(input.lang, "cashExpenseRecordedBy"), width: 0.16 },
              { header: t(input.lang, "cashExpenseDocStatus"), width: 0.12 },
              { header: t(input.lang, "cashExpenseAmount"), width: 0.16, align: "right" },
            ],
            records: tableRecords,
          },
    },
  ];

  return {
    kind: "cash_expenses",
    lang: input.lang,
    shopName: input.shopName.trim() || "Waka POS",
    shopAddress: input.shopAddress?.trim() || null,
    shopPhone: input.shopPhone?.trim() || null,
    title: t(input.lang, "cashExpensesTitle"),
    periodLabel: cashExpensePeriodLabel(input.lang, input.dayKey),
    status: "operational",
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    empty: false,
    emptyMessage: t(input.lang, "cashExpenseDocEmpty"),
    sections,
  };
}

function expenseFilename(input: CashExpenseListDocumentInput): string {
  return `${sanitizePdfStem(`waka-cash-expenses-${input.dayKey}`)}.pdf`;
}

export function buildCashExpenseListPdfBlob(input: CashExpenseListDocumentInput): Blob {
  return buildReportDocumentPdfBlob(buildCashExpenseListDocument(input));
}

export async function printCashExpenseList(input: CashExpenseListDocumentInput): Promise<boolean> {
  const model = buildCashExpenseListDocument(input);
  return printReportDocumentModel("cash_expenses", expenseFilename(input), model, {
    title: model.title,
    shareDialogTitle: model.title,
  });
}

export async function downloadCashExpenseListPdf(input: CashExpenseListDocumentInput): Promise<boolean> {
  return downloadReportPdfBlob(expenseFilename(input), buildCashExpenseListPdfBlob(input));
}

export async function shareCashExpenseListPdf(input: CashExpenseListDocumentInput): Promise<boolean> {
  const model = buildCashExpenseListDocument(input);
  return shareReportPdfBlob(expenseFilename(input), buildReportDocumentPdfBlob(model), model.title);
}
