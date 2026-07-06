import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { computePharmacyPatientReports } from "../lib/pharmacyPatientReports";
import { useDeferredReportingSales } from "../hooks/useDeferredReportingSales";

export function PharmacyPatientReportsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const customers = usePosStore((s) => s.customers);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const doctors = usePosStore((s) => s.pharmacyDoctors);
  const sales = useDeferredReportingSales(false);

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const report = useMemo(
    () => computePharmacyPatientReports(customers, prescriptions, sales, doctors),
    [customers, prescriptions, sales, doctors],
  );

  if (!pharmacy) return null;

  return (
    <div className="page-content-pad space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-stone-950">{t(lang, "pharmacyPatientReportsTitle")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyPatientReportsSub")}</p>
        </div>
        <Link to="/pharmacy/patients" className="min-h-[44px] rounded-2xl border-2 px-4 text-sm font-black">
          {t(lang, "pharmacyTerm_patients")}
        </Link>
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
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
      <h2 className="text-lg font-black text-stone-950">{title}</h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <li className="flex justify-between gap-2 text-sm font-semibold">
      <span className="truncate text-stone-900">{left}</span>
      <span className="shrink-0 font-black text-teal-800">{right}</span>
    </li>
  );
}
