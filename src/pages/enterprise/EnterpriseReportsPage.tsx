import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { supportedExportFormats } from "../../lib/enterprise/enterpriseReporting";

export function EnterpriseReportsPage({ lang }: { lang: Language }) {
  const formats = supportedExportFormats();

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_reports")} subtitle={t(lang, "enterpriseReportsSub")}>
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "enterpriseReportsBranchHint")}</p>
        <Link
          to="/reports"
          className="mt-4 inline-flex min-h-[44px] items-center rounded-2xl bg-waka-600 px-5 text-sm font-black text-white"
        >
          {t(lang, "enterpriseReportsOpenShop")} →
        </Link>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-muted p-5">
        <p className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "enterpriseReportsExport")}</p>
        <p className="mt-2 text-sm font-medium text-muted-foreground">{t(lang, "enterpriseReportsExportNote")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {formats.map((f) => (
            <span key={f} className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-black uppercase">
              {f}
            </span>
          ))}
        </div>
      </section>
    </EnterpriseShell>
  );
}
