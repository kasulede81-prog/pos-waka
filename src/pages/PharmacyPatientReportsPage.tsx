import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { computePharmacyPatientReports } from "../lib/pharmacyPatientReports";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";
import { printTextListDocument } from "../lib/nativePrintFallback";
import { buildListDocumentHtml, buildListDocumentPdfBlob } from "../lib/listDocumentPdf";
import { downloadPdfBlob } from "../lib/documentPrint";
import { sanitizePdfStem } from "../lib/pdfLayout";
import { dateKeyKampala } from "../lib/datesUg";
import { useToast } from "../context/ToastProvider";

export function PharmacyPatientReportsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const customers = usePosStore((s) => s.customers);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const doctors = usePosStore((s) => s.pharmacyDoctors);
  const sales = useDeferredReportingSales(false);
  const toast = useToast();

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const report = useMemo(
    () => computePharmacyPatientReports(customers, prescriptions, sales, doctors),
    [customers, prescriptions, sales, doctors],
  );

  if (!pharmacy) return null;

  /**
   * Report document built from the rows already displayed. Read-only: it reads the
   * computed report and never touches patient records or pharmacy transactions.
   */
  const buildPatientReportDoc = () => ({
    title: t(lang, "pharmacyPatientReportsTitle"),
    subtitle: preferences.shopDisplayName?.trim() || undefined,
    lines: [
      t(lang, "pharmacyReportMostDispensed"),
      ...report.mostDispensedPatients.map((r) => `${r.name}  —  ${r.dispenseCount}`),
      "",
      t(lang, "pharmacyReportRefillCompliance"),
      ...report.refillCompliance.map((r) => `${r.name}  —  ${r.due} due · ${r.missed} missed`),
      "",
      t(lang, "pharmacyReportChronicPatients"),
      ...report.chronicMedicinePatients.map((r) => `${r.name}  —  ${r.activeChronic}`),
      "",
      t(lang, "pharmacyReportDoctorReferrals"),
      ...report.doctorReferrals.map((r) => `${r.doctorName}  —  ${r.rxCount}`),
      "",
      t(lang, "pharmacyReportPatientGrowth"),
      ...report.patientGrowth.map((r) => `${r.month}  —  ${r.count}`),
      "",
      t(lang, "pharmacyReportAgeDistribution"),
      ...report.ageDistribution.map((r) => `${r.bucket}  —  ${r.count}`),
    ],
  });

  const printPatientReport = () => {
    const doc = buildPatientReportDoc();
    void printTextListDocument({
      pdfFilename: `${sanitizePdfStem(`waka-pharmacy-patients-${dateKeyKampala(new Date())}`)}.pdf`,
      title: doc.title,
      subtitle: doc.subtitle,
      lines: doc.lines,
      htmlBody: buildListDocumentHtml(doc),
      paper: "a4",
    }).then((ok) => {
      if (!ok) toast.error(t(lang, "receiptPrintBlocked"));
    });
  };

  const downloadPatientReportPdf = () => {
    const doc = buildPatientReportDoc();
    void downloadPdfBlob(
      `${sanitizePdfStem(`waka-pharmacy-patients-${dateKeyKampala(new Date())}`)}.pdf`,
      buildListDocumentPdfBlob(doc),
    ).then((ok) => {
      if (!ok) toast.error(t(lang, "receiptPdfFailed"));
    });
  };

  return (
    <EnterprisePageContainer>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-foreground">{t(lang, "pharmacyPatientReportsTitle")}</h1>
          <p className="mt-1 text-base font-medium text-muted-foreground">{t(lang, "pharmacyPatientReportsSub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={printPatientReport}
            className="min-h-[44px] rounded-2xl bg-teal-600 px-4 text-sm font-black text-white touch-manipulation"
          >
            {t(lang, "receiptPrint")}
          </button>
          <button
            type="button"
            onClick={downloadPatientReportPdf}
            className="min-h-[44px] rounded-2xl border-2 px-4 text-sm font-black touch-manipulation"
          >
            {t(lang, "receiptDownload")}
          </button>
          <Link to="/pharmacy/patients" className="min-h-[44px] rounded-2xl border-2 px-4 text-sm font-black">
            {t(lang, "pharmacyTerm_patients")}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportSection title={t(lang, "pharmacyReportMostDispensed")}>
          {report.mostDispensedPatients.map((r) => (
            <Row key={r.patientId} left={r.name} right={String(r.dispenseCount)} />
          ))}
        </ReportSection>
        <ReportSection title={t(lang, "pharmacyReportRefillCompliance")}>
          {report.refillCompliance.map((r) => (
            <Row key={r.patientId} left={r.name} right={`${r.due} due · ${r.missed} missed`} />
          ))}
        </ReportSection>
        <ReportSection title={t(lang, "pharmacyReportChronicPatients")}>
          {report.chronicMedicinePatients.map((r) => (
            <Row key={r.patientId} left={r.name} right={String(r.activeChronic)} />
          ))}
        </ReportSection>
        <ReportSection title={t(lang, "pharmacyReportDoctorReferrals")}>
          {report.doctorReferrals.map((r) => (
            <Row key={r.doctorName} left={r.doctorName} right={String(r.rxCount)} />
          ))}
        </ReportSection>
        <ReportSection title={t(lang, "pharmacyReportPatientGrowth")}>
          {report.patientGrowth.map((r) => (
            <Row key={r.month} left={r.month} right={String(r.count)} />
          ))}
        </ReportSection>
        <ReportSection title={t(lang, "pharmacyReportAgeDistribution")}>
          {report.ageDistribution.map((r) => (
            <Row key={r.bucket} left={r.bucket} right={String(r.count)} />
          ))}
        </ReportSection>
      </div>
    </EnterprisePageContainer>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-4 shadow-waka-sm">
      <h2 className="text-lg font-black text-foreground">{title}</h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <li className="flex justify-between gap-2 text-sm font-semibold">
      <span className="truncate text-foreground">{left}</span>
      <span className="shrink-0 font-black text-teal-800">{right}</span>
    </li>
  );
}
