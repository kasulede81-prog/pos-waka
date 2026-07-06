import { useEffect, useState } from "react";
import type { Language } from "../../types";
import type { EnterpriseAuditRow } from "../../types/enterprise";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { auditSeverity, searchEnterpriseAudit } from "../../lib/enterprise/enterpriseAudit";

export function EnterpriseAuditCenterPage({ lang }: { lang: Language }) {
  const [rows, setRows] = useState<EnterpriseAuditRow[]>([]);

  useEffect(() => {
    void searchEnterpriseAudit({ limit: 50 }).then(setRows);
  }, []);

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_audit")} subtitle={t(lang, "enterpriseAuditSub")}>
      <ul className="space-y-2">
        {rows.length === 0 ? (
          <li className="text-sm font-medium text-stone-500">{t(lang, "enterpriseNoData")}</li>
        ) : (
          rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-stone-900">{row.summary || row.action}</p>
                <span
                  className={
                    auditSeverity(row.action) === "critical"
                      ? "rounded-lg bg-rose-100 px-2 py-0.5 text-xs font-black text-rose-900"
                      : auditSeverity(row.action) === "warning"
                        ? "rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900"
                        : "rounded-lg bg-stone-100 px-2 py-0.5 text-xs font-black text-stone-700"
                  }
                >
                  {auditSeverity(row.action)}
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-stone-500">
                {row.action} · {new Date(row.at).toLocaleString()}
              </p>
            </li>
          ))
        )}
      </ul>
    </EnterpriseShell>
  );
}
