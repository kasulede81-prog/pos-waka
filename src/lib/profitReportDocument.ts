import type { DayCloseSummary, Language, Product, ReturnRecord, Sale } from "../types";
import type { DateFilterBounds } from "./dateFilters";
import { overlayPeriodFinancials, resolvePeriodReportAuthority } from "./closedDayAuthority";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import { statusFromAuthority, ugxLabel, type ReportDocumentModel } from "./reportDocumentModel";
import { renderReportDocumentPdf } from "./reportDocumentPdf";
import { downloadReportPdfBlob, printReportPdfBlob } from "./reportDocumentPrint";

export type ProfitReportDocumentInput = {
  lang: Language;
  shopName: string;
  periodLabel: string;
  bounds: DateFilterBounds;
  sales: Sale[];
  returnRecords: ReturnRecord[];
  products: Product[];
  dayCloses?: DayCloseSummary[];
  profitUgx: number;
  revenueUgx: number;
  costUgx: number;
  marginPct: number;
  costIncomplete?: boolean;
  groups: Array<{ categoryLabel: string; profitUgx: number; products: Array<{ name: string; profitUgx: number }> }>;
};

export function buildProfitReportDocument(input: ProfitReportDocumentInput): ReportDocumentModel {
  const overlaid = overlayPeriodFinancials({
    live: {
      revenueUgx: input.revenueUgx,
      profitUgx: input.profitUgx,
      transactionCount: input.sales.length,
      debtIssuedUgx: 0,
    },
    dayCloses: input.dayCloses ?? [],
    bounds: input.bounds,
    sales: input.sales,
    returns: input.returnRecords,
    products: input.products,
  });
  const authority = resolvePeriodReportAuthority(input.dayCloses, input.bounds);
  const closed = authority !== "live";
  const marginPct =
    overlaid.revenueUgx > 0 ? (overlaid.profitUgx / overlaid.revenueUgx) * 100 : 0;
  const grossLabel = input.costIncomplete
    ? t(input.lang, "profitGrossProfitEstimated")
    : t(input.lang, "profitStatGrossProfit");
  return {
    kind: "profit",
    lang: input.lang,
    shopName: input.shopName,
    title: t(input.lang, "profitPageTitle"),
    periodLabel: input.periodLabel,
    status: statusFromAuthority(authority, input.bounds.isSingleDay),
    generatedAtIso: new Date().toISOString(),
    empty: overlaid.transactionCount === 0 && overlaid.revenueUgx === 0,
    sections: [
      {
        title: closed ? t(input.lang, "reportDocClosedHeadlines") : undefined,
        rows: [
          { label: grossLabel, value: ugxLabel(overlaid.profitUgx), bold: true },
          { label: t(input.lang, "profitStatRevenue"), value: ugxLabel(overlaid.revenueUgx) },
          { label: t(input.lang, "profitStatCost"), value: ugxLabel(input.costUgx) },
          { label: t(input.lang, "profitStatMargin"), value: `${marginPct.toFixed(1)}%` },
          ...(input.costIncomplete
            ? [{ label: t(input.lang, "profitExportCostIncomplete"), value: t(input.lang, "profitGrossProfitEstimated") }]
            : []),
        ],
      },
      {
        title: closed
          ? `${t(input.lang, "profitStatBestShelf")} — ${t(input.lang, "reportDocLiveBreakdown")}`
          : t(input.lang, "profitStatBestShelf"),
        live: closed,
        rows: [
          ...(closed
            ? [{ label: t(input.lang, "reportDocLiveBreakdownHint"), value: "" }]
            : []),
          ...input.groups.flatMap((g) => [
            { label: g.categoryLabel, value: ugxLabel(g.profitUgx), bold: true },
            ...g.products.slice(0, 40).map((p) => ({ label: `  ${p.name}`, value: ugxLabel(p.profitUgx) })),
          ]),
        ],
      },
    ],
  };
}

export function buildProfitReportPdfBlob(input: ProfitReportDocumentInput): Blob {
  return renderReportDocumentPdf(buildProfitReportDocument(input));
}

export async function printProfitReportPdf(input: ProfitReportDocumentInput): Promise<boolean> {
  const filename = sanitizePdfStem(`waka-profit-${input.periodLabel}`) + ".pdf";
  const blob = buildProfitReportPdfBlob(input);
  return printReportPdfBlob("profit", filename, blob, {
    title: t(input.lang, "profitPageTitle"),
    shareDialogTitle: t(input.lang, "profitPageTitle"),
  });
}

export async function downloadProfitReportPdf(input: ProfitReportDocumentInput): Promise<boolean> {
  const filename = sanitizePdfStem(`waka-profit-${input.periodLabel}`) + ".pdf";
  return downloadReportPdfBlob(filename, buildProfitReportPdfBlob(input));
}
