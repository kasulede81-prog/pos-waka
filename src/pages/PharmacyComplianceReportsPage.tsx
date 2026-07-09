import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language, PharmacyControlledRegisterEntry } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { computeComplianceReports } from "../lib/pharmacyComplianceReports";

function ReportBlock({
  title,
  rows,
  lang,
}: {
  title: string;
  rows: PharmacyControlledRegisterEntry[];
  lang: Language;
}) {
  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm print:break-inside-avoid">
      <h2 className="text-lg font-black text-stone-950">{title}</h2>
      <p className="text-xs font-bold text-stone-500">{rows.length} {t(lang, "pharmacyComplianceReportEntries")}</p>
      <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto print:max-h-none">
        {rows.length === 0 ? (
          <li className="text-sm font-semibold text-stone-500">{t(lang, "pharmacyComplianceRegisterEmpty")}</li>
        ) : (
          rows.slice(0, 30).map((r) => (
            <li key={r.id} className="flex justify-between gap-2 text-sm font-semibold">
              <span className="truncate text-stone-900">
                {r.productName}
                {r.patientName ? ` · ${r.patientName}` : ""}
              </span>
              <span className="shrink-0 font-black text-violet-800">×{r.quantity}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

export function PharmacyComplianceReportsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const register = usePosStore((s) => s.pharmacyControlledRegister);
  const recordRegulatoryExport = usePosStore((s) => s.recordRegulatoryExport);

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const bundle = useMemo(() => computeComplianceReports(register), [register]);

  if (!pharmacy) return null;

  const printReport = (kind: string) => {
    recordRegulatoryExport(kind);
    window.print();
  };

  return (
    <EnterprisePageContainer className="print:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-3xl font-black text-stone-950">{t(lang, "pharmacyComplianceReportsTitle")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyComplianceReportsSub")}</p>
        </div>
        <Link
          to="/pharmacy/compliance/register"
          className="min-h-[48px] rounded-2xl border-2 px-4 text-sm font-black touch-manipulation"
        >
          {t(lang, "pharmacyComplianceRegisterTitle")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => printReport("daily_controlled")}
          className="min-h-[48px] rounded-2xl bg-violet-700 px-4 text-sm font-black text-white touch-manipulation"
        >
          {t(lang, "pharmacyComplianceReportPrintDaily")}
        </button>
        <button
          type="button"
          onClick={() => printReport("full_bundle")}
          className="min-h-[48px] rounded-2xl border-2 px-4 text-sm font-black touch-manipulation"
        >
          {t(lang, "pharmacyComplianceReportPrintAll")}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportBlock title={t(lang, "pharmacyComplianceReportDaily")} rows={bundle.dailyControlled} lang={lang} />
        <ReportBlock title={t(lang, "pharmacyComplianceReportDispensing")} rows={bundle.dispensingRegister} lang={lang} />
        <ReportBlock title={t(lang, "pharmacyComplianceReportReturns")} rows={bundle.returns} lang={lang} />
        <ReportBlock title={t(lang, "pharmacyComplianceReportDestroyed")} rows={bundle.destroyed} lang={lang} />
        <ReportBlock title={t(lang, "pharmacyComplianceReportOverrides")} rows={bundle.overrides} lang={lang} />
        <ReportBlock title={t(lang, "pharmacyComplianceReportWitness")} rows={bundle.witnessLog} lang={lang} />
      </div>

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm print:break-inside-avoid">
        <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyComplianceReportStock")}</h2>
        <ul className="mt-3 space-y-2">
          {bundle.controlledStockHints.length === 0 ? (
            <li className="text-sm font-semibold text-stone-500">{t(lang, "pharmacyComplianceRegisterEmpty")}</li>
          ) : (
            bundle.controlledStockHints.map((h) => (
              <li key={h.productId} className="flex justify-between gap-2 text-sm font-semibold">
                <span className="truncate text-stone-900">{h.productName}</span>
                <span className="shrink-0 font-black text-teal-800">{h.dispensedQty}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </EnterprisePageContainer>
  );
}
