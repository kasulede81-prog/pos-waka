import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  AUDIT_RETENTION_WARN_COUNT,
  buildAuditExportText,
  getAuditRetentionStatus,
  getAuditSyncHealth,
} from "../../lib/auditHealth";
import { usePosStore } from "../../store/usePosStore";
import { readSyncQueue } from "../../offline/localDb";
import { saveExportedFile } from "../../lib/fileDownload";

export function AuditHealthCard({ lang }: { lang: Language }) {
  const auditLogs = usePosStore((s) => s.auditLogs);
  const retention = getAuditRetentionStatus(auditLogs);
  const [pendingAudit, setPendingAudit] = useState(0);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    void readSyncQueue().then((q) => {
      setPendingAudit(getAuditSyncHealth(q).pendingAuditOps);
    });
  }, [auditLogs.length]);

  const exportAudit = async () => {
    const body = buildAuditExportText(auditLogs, lang);
    const ok = await saveExportedFile(
      `waka-audit-${new Date().toISOString().slice(0, 10)}.txt`,
      body,
      "text/plain;charset=utf-8",
    );
    setExportMsg(ok ? t(lang, "auditExportDone") : t(lang, "auditExportFailed"));
    window.setTimeout(() => setExportMsg(null), 3000);
  };

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "auditHealthTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "auditHealthSub")}</p>

      {retention.warn ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {t(lang, "auditRetentionWarn").replace("{count}", String(retention.count)).replace(
            "{max}",
            String(AUDIT_RETENTION_WARN_COUNT),
          )}
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-stone-700">
          {t(lang, "auditRetentionOk").replace("{count}", String(retention.count))}
        </p>
      )}

      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex justify-between rounded-xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "auditSyncPendingLabel")}</dt>
          <dd className={`font-black ${pendingAudit > 0 ? "text-amber-800" : "text-emerald-800"}`}>
            {pendingAudit}
          </dd>
        </div>
        <div className="flex justify-between rounded-xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "auditSyncHealthLabel")}</dt>
          <dd className="font-black text-stone-900">
            {pendingAudit > 0 ? t(lang, "auditSyncHealthPending") : t(lang, "auditSyncHealthOk")}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => void exportAudit()}
        className="mt-4 min-h-[44px] w-full rounded-2xl border-2 border-stone-300 bg-white font-bold text-stone-900"
      >
        {t(lang, "auditExportButton")}
      </button>
      {exportMsg ? <p className="mt-2 text-center text-sm font-bold text-stone-700">{exportMsg}</p> : null}
    </article>
  );
}
