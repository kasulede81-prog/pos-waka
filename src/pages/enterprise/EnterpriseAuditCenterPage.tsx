import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import type { Language } from "../../types";
import type { EnterpriseAuditRow } from "../../types/enterprise";
import { t } from "../../lib/i18n";
import { EnterpriseShell } from "../../components/enterprise/EnterpriseShell";
import { EnterpriseAsyncShell } from "../../components/enterprise/EnterpriseAsyncShell";
import { auditSeverity, searchEnterpriseAudit } from "../../lib/enterprise/enterpriseAudit";

export function EnterpriseAuditCenterPage({ lang }: { lang: Language }) {
  const [rows, setRows] = useState<EnterpriseAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await searchEnterpriseAudit({ limit: 50 });
    if (!result.ok) {
      setLoadError(result.error ?? t(lang, "notifyEnterpriseLoadFailed"));
      setRows([]);
    } else {
      setRows(result.rows);
    }
    setLoading(false);
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <EnterpriseShell lang={lang} title={t(lang, "enterpriseNav_audit")} subtitle={t(lang, "enterpriseAuditSub")}>
      <EnterpriseAsyncShell
        loading={loading}
        error={loadError}
        empty={!loadError && rows.length === 0}
        emptyIcon={ClipboardList}
        emptyTitle={t(lang, "enterpriseNoData")}
        errorTitle={t(lang, "notifyEnterpriseLoadFailed")}
        retryLabel={t(lang, "enterpriseRetry")}
        onRetry={() => void load()}
      >
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-foreground">{row.summary || row.action}</p>
                <span
                  className={
                    auditSeverity(row.action) === "critical"
                      ? "rounded-lg bg-rose-100 px-2 py-0.5 text-xs font-black text-rose-900"
                      : auditSeverity(row.action) === "warning"
                        ? "rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900"
                        : "rounded-lg bg-muted px-2 py-0.5 text-xs font-black text-muted-foreground"
                  }
                >
                  {auditSeverity(row.action)}
                </span>
              </div>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                {row.action} · {new Date(row.at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </EnterpriseAsyncShell>
    </EnterpriseShell>
  );
}
