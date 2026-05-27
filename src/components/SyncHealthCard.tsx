import { useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { useOfflineStatus } from "../hooks/useOfflineStatus";
import { countUnsyncedSales } from "../offline/cloudSync";
import { tTemplate } from "../lib/i18n";

type Props = { lang: Language; variant?: "full" | "simple" };

function fmtShort(iso: string | null, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function SyncHealthCard({ lang, variant = "full" }: Props) {
  const { isOnline } = useOfflineStatus();
  const sync = useSyncStatus();
  const [msg, setMsg] = useState<string | null>(null);
  const h = sync.health;
  const simple = variant === "simple";

  const unsyncedSales = countUnsyncedSales();
  const needsAttention = isOnline && (h.lastIssueCode === "error" || (h.lastIssueCode === "partial" && sync.pendingCount > 5));

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">
        {simple ? t(lang, "backupSyncOnlineTitle") : t(lang, "syncDiagnosticsTitle")}
      </p>
      {!simple ? <p className="mt-1 text-sm text-stone-600">{t(lang, "syncDiagnosticsSub")}</p> : null}
      <p className="mt-2 text-sm font-semibold text-stone-600">
        {isOnline ? t(lang, "backupSyncOnlineActive") : t(lang, "backupSyncOfflineActive")}
      </p>

      {unsyncedSales > 0 ? (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {tTemplate(lang, "backupSyncWaitingUploads", { count: String(unsyncedSales) })}
        </p>
      ) : null}

      {!simple && needsAttention ? (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          {t(lang, "syncNeedsReview")}
        </p>
      ) : null}

      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "backupSyncPendingLabel")}</dt>
          <dd className="font-black text-stone-900">{sync.pendingCount}</dd>
        </div>
        {!simple ? (
          <div className="rounded-xl bg-stone-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t(lang, "backupSyncQueueBreakdown")}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold text-stone-700">
              <p className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                <span>{t(lang, "backupSyncQueueSales")}</span>
                <span className="font-black text-stone-900">{sync.pendingBreakdown.sales}</span>
              </p>
              <p className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                <span>{t(lang, "backupSyncQueueStock")}</span>
                <span className="font-black text-stone-900">{sync.pendingBreakdown.stock}</span>
              </p>
              <p className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                <span>{t(lang, "backupSyncQueueReturns")}</span>
                <span className="font-black text-stone-900">{sync.pendingBreakdown.returns}</span>
              </p>
              <p className="flex items-center justify-between rounded-lg bg-white px-2 py-1">
                <span>{t(lang, "backupSyncQueueExpenses")}</span>
                <span className="font-black text-stone-900">{sync.pendingBreakdown.expenses}</span>
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2">
          <dt className="font-semibold text-stone-600">{t(lang, "backupSyncLastUpload")}</dt>
          <dd className="text-right font-medium text-stone-800">{fmtShort(h.lastSuccessAt, lang)}</dd>
        </div>
      </dl>

      {msg ? <p className="mt-2 text-sm font-semibold text-waka-800">{msg}</p> : null}

      <button
        type="button"
        disabled={!isOnline || sync.syncing}
        onClick={async () => {
          setMsg(null);
          await sync.flush();
          setMsg(t(lang, "syncRetryDone"));
          window.setTimeout(() => setMsg(null), 4000);
        }}
        className="mt-3 w-full rounded-2xl bg-waka-600 py-3 text-sm font-black text-white disabled:opacity-50"
      >
        {sync.syncing ? t(lang, "syncingShort") : t(lang, "backupSyncUploadNow")}
      </button>
    </article>
  );
}
