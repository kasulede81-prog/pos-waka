import { useState } from "react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { useOfflineStatus } from "../hooks/useOfflineStatus";
import { countSalesWithSyncErrors, countUnsyncedSales, listSalesWithSyncErrors } from "../offline/cloudSync";
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
  const syncErrorCount = countSalesWithSyncErrors();
  const syncErrors = listSalesWithSyncErrors(6);
  const needsAttention = isOnline && (h.lastIssueCode === "error" || (h.lastIssueCode === "partial" && sync.pendingCount > 5) || syncErrorCount > 0);

  const issueLabel =
    h.lastIssueCode === "error"
      ? t(lang, "syncIssueError")
      : h.lastIssueCode === "partial"
        ? t(lang, "syncIssuePartial")
        : null;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
        {t(lang, "syncTrustSavedOnPhone")}
      </p>
      <p className="mt-3 text-base font-black text-stone-900">
        {simple ? t(lang, "backupSyncOnlineTitle") : t(lang, "syncDiagnosticsTitle")}
      </p>
      {!simple ? <p className="mt-1 text-sm text-stone-600">{t(lang, "syncDiagnosticsSub")}</p> : null}
      <p className="mt-2 text-sm font-semibold text-stone-600">
        {isOnline ? t(lang, "backupSyncOnlineActive") : t(lang, "syncTrustOfflineSell")}
      </p>
      {!isOnline ? <p className="mt-1 text-sm font-semibold text-stone-600">{t(lang, "syncTrustKeepUsing")}</p> : null}

      {unsyncedSales > 0 ? (
        <div className="mt-2 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-sm font-bold text-amber-950">
            {tTemplate(lang, "backupSyncWaitingUploads", { count: String(unsyncedSales) })}
          </p>
          <p className="text-xs font-semibold text-amber-900">{t(lang, "syncTrustWaitingSafe")}</p>
        </div>
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
        {!simple ? (
          <>
            <div className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2">
              <dt className="font-semibold text-stone-600">{t(lang, "syncLastSuccess")}</dt>
              <dd className="text-right font-medium text-stone-800">{fmtShort(h.lastSuccessAt, lang)}</dd>
            </div>
            {issueLabel ? (
              <div className="rounded-xl bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold text-amber-900">{t(lang, "syncLastIssue")}</p>
                <p className="mt-0.5 text-sm font-black text-amber-950">{issueLabel}</p>
              </div>
            ) : null}
            <div className="flex justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2">
              <dt className="font-semibold text-stone-600">{t(lang, "syncFailedCount")}</dt>
              <dd className="font-black text-stone-900">{syncErrorCount}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {!simple && syncErrors.length > 0 ? (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="text-xs font-black uppercase text-rose-900">{t(lang, "syncAffectedRecords")}</p>
          <ul className="mt-1 space-y-0.5 text-xs font-medium text-rose-800">
            {syncErrors.map((e) => (
              <li key={e.id} className="truncate">
                {t(lang, "syncSaleListItem")} · {e.id.slice(0, 8)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

      {!simple ? (
        <>
          <p className="mt-2 text-xs text-stone-500">{t(lang, "backupSyncForceFullHint")}</p>
          <button
            type="button"
            disabled={!isOnline || sync.syncing}
            onClick={async () => {
              setMsg(null);
              await sync.flushFull();
              setMsg(t(lang, "backupSyncForceFullDone"));
              window.setTimeout(() => setMsg(null), 5000);
            }}
            className="mt-2 w-full rounded-2xl border-2 border-stone-300 bg-white py-3 text-sm font-black text-stone-800 disabled:opacity-50"
          >
            {sync.syncing ? t(lang, "syncingShort") : t(lang, "backupSyncForceFull")}
          </button>
        </>
      ) : null}
    </article>
  );
}
