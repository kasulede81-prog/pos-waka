import type { Language } from "../types";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import { exportCsvFile } from "./reportExportEngine";
import { formatXReportCsv, type XReportSnapshot } from "./xReport";
import {
  statusFromAuthority,
  ugxLabel,
  type ReportDocumentModel,
} from "./reportDocumentModel";
import { renderReportDocumentPdf } from "./reportDocumentPdf";
import { downloadReportPdfBlob, printReportPdfBlob, shareReportPdfBlob } from "./reportDocumentPrint";

export function buildXReportDocument(lang: Language, snapshot: XReportSnapshot): ReportDocumentModel {
  return {
    kind: "x_report",
    lang,
    shopName: snapshot.shopName,
    title: t(lang, "xReportTitle"),
    periodLabel: snapshot.dateKey,
    status: statusFromAuthority(snapshot.ledgerClosed ? "closed_snapshot" : "live", true),
    generatedAtIso: snapshot.generatedAt,
    empty: snapshot.transactionCount === 0 && snapshot.totalSalesUgx === 0,
    sections: [
      {
        title: snapshot.ledgerClosed ? t(lang, "reportDocClosedHeadlines") : undefined,
        rows: [
          { label: t(lang, "totalSales"), value: ugxLabel(snapshot.totalSalesUgx), bold: true },
          { label: t(lang, "closeSalesCount"), value: String(snapshot.transactionCount) },
          { label: t(lang, "closeDayExpectedTitle"), value: ugxLabel(snapshot.expectedDrawerCashUgx) },
          { label: t(lang, "closeDayExpensesToday"), value: ugxLabel(snapshot.expensesUgx) },
          { label: t(lang, "xReportRefunds"), value: ugxLabel(snapshot.refundsUgx) },
        ],
      },
      {
        title: t(lang, "dailyReportPaymentMethods"),
        live: snapshot.ledgerClosed,
        rows: [
          { label: t(lang, "xReportCash"), value: ugxLabel(snapshot.payments.cashUgx) },
          { label: t(lang, "xReportMoMo"), value: ugxLabel(snapshot.payments.mobileMoneyUgx) },
          { label: t(lang, "xReportCard"), value: ugxLabel(snapshot.payments.cardUgx) },
          { label: t(lang, "xReportCredit"), value: ugxLabel(snapshot.payments.creditUgx) },
          { label: t(lang, "xReportVoids"), value: ugxLabel(snapshot.voidsUgx) },
          { label: t(lang, "xReportDiscounts"), value: ugxLabel(snapshot.discountsUgx) },
          ...(snapshot.tableOpenCount > 0
            ? [
                {
                  label: t(lang, "xReportOpenTables"),
                  value: `${snapshot.tableOpenCount} · ${ugxLabel(snapshot.tablePendingUgx)}`,
                },
              ]
            : []),
          ...snapshot.staffRows.slice(0, 10).map((row) => ({
            label: row.label,
            value: `${ugxLabel(row.salesUgx)} (${row.saleCount})`,
          })),
        ],
      },
    ],
  };
}

export function buildXReportPdfBlob(lang: Language, snapshot: XReportSnapshot): Blob {
  return renderReportDocumentPdf(buildXReportDocument(lang, snapshot));
}

function xReportPdfFilename(dateKey: string): string {
  return sanitizePdfStem(`waka-x-report-${dateKey}`) + ".pdf";
}

export async function downloadXReportPdf(lang: Language, snapshot: XReportSnapshot): Promise<boolean> {
  const blob = buildXReportPdfBlob(lang, snapshot);
  return downloadReportPdfBlob(xReportPdfFilename(snapshot.dateKey), blob);
}

export async function shareXReportPdf(lang: Language, snapshot: XReportSnapshot): Promise<boolean> {
  const blob = buildXReportPdfBlob(lang, snapshot);
  return shareReportPdfBlob(xReportPdfFilename(snapshot.dateKey), blob, "Print or share X report");
}

export async function printXReport(lang: Language, snapshot: XReportSnapshot): Promise<boolean> {
  const blob = buildXReportPdfBlob(lang, snapshot);
  return printReportPdfBlob("x_report", xReportPdfFilename(snapshot.dateKey), blob, {
    title: t(lang, "xReportTitle"),
    shareDialogTitle: "Print or share X report",
  });
}

export async function downloadXReportCsv(snapshot: XReportSnapshot): Promise<boolean> {
  const csv = formatXReportCsv(snapshot);
  const rows = csv.split("\n").map((line) => line.split(","));
  const result = await exportCsvFile("x_report", `x-report-${snapshot.dateKey}.csv`, rows);
  return result.ok;
}
