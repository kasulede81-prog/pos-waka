/**
 * Office A4/PDF documents for the debts page.
 * Balances and activity are read-only projections of existing customer UI data.
 */

import type { Customer, Language } from "../types";
import type { CreditActivityEntry, CreditActivityIndex } from "./customerDebtActivity";
import type { DateFilterValue } from "./dateFilters";
import { formatDateFilterViewingLabel } from "./dateFilterLabels";
import { formatDateTimeKampala } from "./datesUg";
import {
  deriveCustomerDebtMeta,
  sumAuthoritativeCustomerDebt,
  type DebtListSort,
  type DebtsQuickFilter,
} from "./debtsPageView";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import {
  ugxLabel,
  type ReportDocumentModel,
  type ReportDocumentSection,
} from "./reportDocumentModel";
import {
  downloadReportPdfBlob,
  printReportDocumentModel,
  shareReportPdfBlob,
  buildReportDocumentPdfBlob,
} from "./reportDocumentPrint";

export type CustomerDebtListDocumentInput = {
  lang: Language;
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  title: string;
  dateFilter: DateFilterValue;
  searchQuery: string;
  quickFilter: DebtsQuickFilter;
  sortBy: DebtListSort;
  customers: Customer[];
  creditIndex: CreditActivityIndex;
  generatedAtIso?: string;
};

export type CustomerStatementDocumentInput = {
  lang: Language;
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  dateFilter: DateFilterValue;
  customer: Customer;
  timeline: CreditActivityEntry[];
  generatedAtIso?: string;
};

export function customerDebtStatusLabel(
  lang: Language,
  customer: Customer,
  index: CreditActivityIndex,
): string {
  if (customer.debtBalanceUgx <= 0) return t(lang, "debtsStatusCleared");
  const meta = deriveCustomerDebtMeta(customer, index);
  if (meta.isOverdue) return t(lang, "debtsStatusOverdue");
  if (meta.isDueSoon) return t(lang, "debtsStatusDueSoon");
  return t(lang, "debtBalanceShort");
}

export function customerContactLabel(lang: Language, customer: Pick<Customer, "phone">): string {
  const phone = customer.phone?.trim();
  return phone || t(lang, "debtNoPhone");
}

export function activityReferenceLabel(entry: CreditActivityEntry): string {
  if (entry.receiptSeq == null) return "—";
  return `#${String(entry.receiptSeq).padStart(3, "0")}`;
}

export function activityKindLabel(lang: Language, entry: CreditActivityEntry): string {
  return entry.kind === "credit_sale" ? t(lang, "creditSaleActivity") : t(lang, "debtPaymentActivity");
}

export function activityAmountLabel(entry: CreditActivityEntry): string {
  const sign = entry.kind === "debt_payment" ? "−" : "+";
  return `${sign}${ugxLabel(entry.amountUgx)}`;
}

export function activityDateLabel(iso: string): string {
  const stamp = formatDateTimeKampala(iso);
  return `${stamp.dateKey} ${stamp.time}`;
}

function quickFilterLabel(lang: Language, filter: DebtsQuickFilter): string {
  if (filter === "outstanding") return t(lang, "debtsFilterOutstanding");
  if (filter === "overdue") return t(lang, "debtsFilterOverdue");
  if (filter === "paid_today") return t(lang, "debtsFilterPaidToday");
  if (filter === "this_week") return t(lang, "debtsFilterThisWeek");
  return t(lang, "debtsFilterAll");
}

function sortLabel(lang: Language, sortBy: DebtListSort): string {
  if (sortBy === "balance_asc") return t(lang, "debtsSortBalanceAsc");
  if (sortBy === "name_az") return t(lang, "debtsSortName");
  return t(lang, "debtsSortBalanceDesc");
}

export function customerDebtListPeriodLabel(input: CustomerDebtListDocumentInput): string {
  const parts = [
    formatDateFilterViewingLabel(input.lang, input.dateFilter),
    quickFilterLabel(input.lang, input.quickFilter),
    sortLabel(input.lang, input.sortBy),
  ];
  const search = input.searchQuery.trim();
  if (search) parts.push(`${t(input.lang, "debtsActionSearch")}: ${search}`);
  return parts.join(" · ");
}

export function customerStatementPeriodLabel(input: Pick<CustomerStatementDocumentInput, "lang" | "dateFilter">): string {
  return formatDateFilterViewingLabel(input.lang, input.dateFilter);
}

function shopFields(input: {
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
}): Pick<ReportDocumentModel, "shopName" | "shopAddress" | "shopPhone"> {
  return {
    shopName: input.shopName.trim() || "Waka POS",
    shopAddress: input.shopAddress?.trim() || null,
    shopPhone: input.shopPhone?.trim() || null,
  };
}

export function buildCustomerDebtListDocument(input: CustomerDebtListDocumentInput): ReportDocumentModel {
  const outstandingTotal = sumAuthoritativeCustomerDebt(input.customers);
  const empty = input.customers.length === 0;
  const tableRecords = input.customers.map((customer) => [
    customer.name,
    customerContactLabel(input.lang, customer),
    customerDebtStatusLabel(input.lang, customer, input.creditIndex),
    ugxLabel(Math.max(0, customer.debtBalanceUgx ?? 0)),
  ]);

  const sections: ReportDocumentSection[] = [
    {
      rows: [
        { label: t(input.lang, "customerDebtDocSelectedCount"), value: String(input.customers.length) },
        { label: t(input.lang, "customerDebtDocTotal"), value: ugxLabel(outstandingTotal), bold: true },
      ],
    },
    {
      title: t(input.lang, "customers"),
      rows: empty ? [{ label: t(input.lang, "customerDebtDocEmpty"), value: "" }] : [],
      table: empty
        ? undefined
        : {
            columns: [
              { header: t(input.lang, "customers"), width: 0.34 },
              { header: t(input.lang, "customerDebtDocContact"), width: 0.24 },
              { header: t(input.lang, "customerDebtDocStatus"), width: 0.18 },
              { header: t(input.lang, "customerDebtDocBalance"), width: 0.24, align: "right" },
            ],
            records: tableRecords,
          },
    },
  ];

  return {
    kind: "customer_debt",
    lang: input.lang,
    ...shopFields(input),
    title: input.title.trim() || t(input.lang, "customerDebtDocTitle"),
    periodLabel: customerDebtListPeriodLabel(input),
    status: "operational",
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    empty: false,
    emptyMessage: t(input.lang, "customerDebtDocEmpty"),
    sections,
  };
}

export function buildCustomerStatementDocument(input: CustomerStatementDocumentInput): ReportDocumentModel {
  const historyEmpty = input.timeline.length === 0;
  const tableRecords = input.timeline.map((entry) => [
    activityDateLabel(entry.at),
    activityKindLabel(input.lang, entry),
    activityReferenceLabel(entry),
    activityAmountLabel(entry),
  ]);

  const sections: ReportDocumentSection[] = [
    {
      title: input.customer.name,
      rows: [
        { label: t(input.lang, "customerDebtDocContact"), value: customerContactLabel(input.lang, input.customer) },
        {
          label: t(input.lang, "creditActivityBalance"),
          value: ugxLabel(Math.max(0, input.customer.debtBalanceUgx ?? 0)),
          bold: true,
        },
      ],
    },
    {
      title: t(input.lang, "creditActivityTitle"),
      rows: historyEmpty ? [{ label: t(input.lang, "creditActivityEmpty"), value: "" }] : [],
      table: historyEmpty
        ? undefined
        : {
            columns: [
              { header: t(input.lang, "customerStatementDocDate"), width: 0.28 },
              { header: t(input.lang, "customerStatementDocActivity"), width: 0.28 },
              { header: t(input.lang, "customerStatementDocRef"), width: 0.16 },
              { header: t(input.lang, "customerStatementDocAmount"), width: 0.28, align: "right" },
            ],
            records: tableRecords,
          },
    },
  ];

  return {
    kind: "customer_statement",
    lang: input.lang,
    ...shopFields(input),
    title: t(input.lang, "customerStatementDocTitle"),
    periodLabel: customerStatementPeriodLabel(input),
    status: "operational",
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    empty: false,
    emptyMessage: t(input.lang, "creditActivityEmpty"),
    sections,
  };
}

function debtListFilename(input: CustomerDebtListDocumentInput): string {
  return `${sanitizePdfStem(`waka-customer-debt-${customerDebtListPeriodLabel(input)}`)}.pdf`;
}

function statementFilename(input: CustomerStatementDocumentInput): string {
  return `${sanitizePdfStem(`waka-customer-statement-${input.customer.name}`)}.pdf`;
}

export function buildCustomerDebtListPdfBlob(input: CustomerDebtListDocumentInput): Blob {
  return buildReportDocumentPdfBlob(buildCustomerDebtListDocument(input));
}

export function buildCustomerStatementPdfBlob(input: CustomerStatementDocumentInput): Blob {
  return buildReportDocumentPdfBlob(buildCustomerStatementDocument(input));
}

export async function printCustomerDebtList(input: CustomerDebtListDocumentInput): Promise<boolean> {
  const model = buildCustomerDebtListDocument(input);
  return printReportDocumentModel("customer_debt", debtListFilename(input), model, {
    title: model.title,
    shareDialogTitle: model.title,
  });
}

export async function downloadCustomerDebtListPdf(input: CustomerDebtListDocumentInput): Promise<boolean> {
  return downloadReportPdfBlob(debtListFilename(input), buildCustomerDebtListPdfBlob(input));
}

export async function shareCustomerDebtListPdf(input: CustomerDebtListDocumentInput): Promise<boolean> {
  const model = buildCustomerDebtListDocument(input);
  return shareReportPdfBlob(debtListFilename(input), buildReportDocumentPdfBlob(model), model.title);
}

export async function printCustomerStatement(input: CustomerStatementDocumentInput): Promise<boolean> {
  const model = buildCustomerStatementDocument(input);
  return printReportDocumentModel("customer_statement", statementFilename(input), model, {
    title: model.title,
    shareDialogTitle: model.title,
  });
}

export async function downloadCustomerStatementPdf(input: CustomerStatementDocumentInput): Promise<boolean> {
  return downloadReportPdfBlob(statementFilename(input), buildCustomerStatementPdfBlob(input));
}

export async function shareCustomerStatementPdf(input: CustomerStatementDocumentInput): Promise<boolean> {
  const model = buildCustomerStatementDocument(input);
  return shareReportPdfBlob(statementFilename(input), buildReportDocumentPdfBlob(model), model.title);
}
