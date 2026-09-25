/**
 * Regulator-facing controlled-drug register as an A4 report document (printing audit, P0.1).
 *
 * The page used to build raw HTML and hand it to `printHtmlDocument`, which returns
 * `false` on Android/iOS and prints nothing — so a compliance officer could believe a
 * register had been produced when it had not. This routes through the shared report
 * pipeline instead: native shares the generated PDF, web/desktop print the same PDF.
 *
 * Rows are read-only projections of `computeComplianceReports`; nothing here writes.
 */
import type { Language, PharmacyControlledRegisterEntry } from "../types";
import type { PharmacyComplianceReportBundle } from "./pharmacyComplianceReports";
import { formatDateFilterViewingLabel } from "./dateFilterLabels";
import { t } from "./i18n";
import { sanitizePdfStem } from "./pdfLayout";
import { type ReportDocumentModel, type ReportDocumentSection } from "./reportDocumentModel";
import { printReportDocumentModel, shareReportPdfBlob, buildReportDocumentPdfBlob, downloadReportPdfBlob } from "./reportDocumentPrint";

export type PharmacyComplianceReportScope = "daily_controlled" | "full_bundle";

export type PharmacyComplianceReportInput = {
  lang: Language;
  shopName: string;
  shopAddress?: string | null;
  shopPhone?: string | null;
  bundle: PharmacyComplianceReportBundle;
  scope: PharmacyComplianceReportScope;
  dayKey: string;
  generatedAtIso?: string;
};

function registerRows(entries: PharmacyControlledRegisterEntry[]): string[][] {
  return entries.map((e) => [
    e.at.slice(0, 16).replace("T", " "),
    e.productName,
    e.controlledSchedule ?? e.regulatoryCategory ?? "—",
    e.patientName ?? "—",
    String(e.quantity),
    e.pharmacistName ?? "—",
  ]);
}

function registerColumns(lang: Language) {
  return [
    { header: t(lang, "pharmacyRxDate"), width: 0.18 },
    { header: t(lang, "pharmacyTerm_medicine"), width: 0.28 },
    { header: t(lang, "pharmacyComplianceSchedule"), width: 0.14 },
    { header: t(lang, "pharmacyPatientProfileSection"), width: 0.18 },
    { header: "Qty", width: 0.08, align: "right" as const },
    { header: t(lang, "pharmacyComplianceColPharmacist"), width: 0.14 },
  ];
}

function registerSection(
  lang: Language,
  title: string,
  entries: PharmacyControlledRegisterEntry[],
): ReportDocumentSection {
  const empty = entries.length === 0;
  return {
    title,
    rows: empty ? [{ label: t(lang, "pharmacyComplianceRegisterEmpty"), value: "" }] : [],
    table: empty ? undefined : { columns: registerColumns(lang), records: registerRows(entries) },
  };
}

export function buildPharmacyComplianceDocument(input: PharmacyComplianceReportInput): ReportDocumentModel {
  const { lang, bundle } = input;
  const sections: ReportDocumentSection[] =
    input.scope === "daily_controlled"
      ? [registerSection(lang, t(lang, "pharmacyComplianceReportDaily"), bundle.dailyControlled)]
      : [
          registerSection(lang, t(lang, "pharmacyComplianceReportDaily"), bundle.dailyControlled),
          registerSection(lang, t(lang, "pharmacyComplianceReportDispensing"), bundle.dispensingRegister),
          registerSection(lang, t(lang, "pharmacyComplianceReportReturns"), bundle.returns),
          registerSection(lang, t(lang, "pharmacyComplianceReportDestroyed"), bundle.destroyed),
          registerSection(lang, t(lang, "pharmacyComplianceReportOverrides"), bundle.overrides),
          registerSection(lang, t(lang, "pharmacyComplianceReportWitness"), bundle.witnessLog),
          {
            title: t(lang, "pharmacyComplianceReportStock"),
            rows: bundle.controlledStockHints.length
              ? bundle.controlledStockHints.map((h) => ({ label: h.productName, value: String(h.dispensedQty) }))
              : [{ label: t(lang, "pharmacyComplianceRegisterEmpty"), value: "" }],
          },
        ];

  return {
    kind: "pharmacy_compliance",
    lang,
    shopName: input.shopName.trim() || "Pharmacy",
    shopAddress: input.shopAddress?.trim() || null,
    shopPhone: input.shopPhone?.trim() || null,
    title: t(lang, "pharmacyComplianceReportsTitle"),
    periodLabel: formatDateFilterViewingLabel(lang, { kind: "day", dateKey: input.dayKey }),
    status: "operational",
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    empty: false,
    emptyMessage: t(lang, "pharmacyComplianceRegisterEmpty"),
    sections,
  };
}

export function complianceReportFilename(input: PharmacyComplianceReportInput): string {
  const scope = input.scope === "daily_controlled" ? "daily-controlled" : "full-bundle";
  return `${sanitizePdfStem(`waka-controlled-register-${scope}-${input.dayKey}`)}.pdf`;
}

export async function printPharmacyComplianceReport(input: PharmacyComplianceReportInput): Promise<boolean> {
  const model = buildPharmacyComplianceDocument(input);
  return printReportDocumentModel("pharmacy_compliance", complianceReportFilename(input), model, {
    title: model.title,
    shareDialogTitle: model.title,
  });
}

export async function downloadPharmacyComplianceReport(input: PharmacyComplianceReportInput): Promise<boolean> {
  const model = buildPharmacyComplianceDocument(input);
  return downloadReportPdfBlob(complianceReportFilename(input), buildReportDocumentPdfBlob(model));
}

export async function sharePharmacyComplianceReport(input: PharmacyComplianceReportInput): Promise<boolean> {
  const model = buildPharmacyComplianceDocument(input);
  return shareReportPdfBlob(complianceReportFilename(input), buildReportDocumentPdfBlob(model), model.title);
}
