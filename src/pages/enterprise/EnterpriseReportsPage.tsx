import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { supportedExportFormats } from "../../lib/enterprise/enterpriseReporting";

export function EnterpriseReportsPage({ lang }: { lang: Language }) {
  const formats = supportedExportFormats();

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_reports")} subtitle={t(lang, "enterpriseReportsSub")}>
      <p className="text-sm font-semibold text-stone-600">{t(lang, "enterpriseReportsExport")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {formats.map((f) => (
          <span key={f} className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-black uppercase">
            {f}
          </span>
        ))}
      </div>
    </EnterpriseShell>
  );
}
