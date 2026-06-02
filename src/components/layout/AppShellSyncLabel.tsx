import { memo } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { countSalesWithSyncErrors } from "../../offline/cloudSync";
import { offlineDurationLabel } from "../../lib/syncMeta";
import { usePosStore } from "../../store/usePosStore";

function fmtShort(iso: string | null, lang: Language): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function label(
  lang: Language,
  syncing: boolean,
  pendingCount: number,
  online: boolean,
  syncErrors: number,
  queueHealth: "healthy" | "degraded" | "backing_off",
): string {
  if (!online) return t(lang, "autoSyncOfflineBanner");
  if (syncing) return t(lang, "syncingShort");
  if (syncErrors > 0) return tTemplate(lang, "syncErrorCount", { count: String(syncErrors) });
  if (queueHealth === "backing_off") return t(lang, "autoSyncQueueBackoff");
  if (queueHealth === "degraded") return t(lang, "autoSyncQueueDegraded");
  if (pendingCount > 0) {
    return tTemplate(lang, "autoSyncPendingBanner", { count: String(pendingCount) });
  }
  return t(lang, "autoSyncSyncedBanner");
}

/** Isolated sync strip — updates here do not re-render the whole AppShell / POS tree. */
export const AppShellSyncLabel = memo(function AppShellSyncLabel({ lang }: { lang: Language }) {
  const { isOnline } = useOfflineStatus();
  const { syncing, pendingCount, health } = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const salesHydration = usePosStore((s) => s.salesHistoryHydration);
  const needsAction = isOnline && syncErrors > 0;

  const syncLine = label(lang, syncing, pendingCount, isOnline, syncErrors, health.queueHealth);
  const offlineDur = !isOnline ? offlineDurationLabel(health.offlineSinceAt) : null;
  const lastSuccess = fmtShort(health.lastSuccessAt, lang);

  const hydrationLine =
    salesHydration?.active
      ? salesHydration.total > 0
        ? `${t(lang, "salesHistoryHydrationLoading")} ${tTemplate(lang, "salesHistoryHydrationCount", {
            loaded: String(salesHydration.loaded),
            total: String(salesHydration.total),
          })}`
        : t(lang, "salesHistoryHydrationLoading")
      : null;

  return (
    <div className="min-w-0">
      <p
        className={`truncate text-[11px] font-medium ${needsAction ? "text-rose-800" : "text-waka-800/90"}`}
        title={needsAction ? t(lang, "syncErrorBanner") : undefined}
      >
        {syncLine}
      </p>
      {offlineDur ? (
        <p className="truncate text-[10px] font-semibold text-stone-600">
          {tTemplate(lang, "autoSyncOfflineDuration", { duration: offlineDur })}
        </p>
      ) : null}
      {isOnline && lastSuccess && !syncing && pendingCount === 0 && syncErrors === 0 ? (
        <p className="truncate text-[10px] font-medium text-emerald-800">
          {tTemplate(lang, "autoSyncLastSuccess", { time: lastSuccess })}
        </p>
      ) : null}
      {hydrationLine ? (
        <p className="truncate text-[10px] font-semibold text-amber-800">{hydrationLine}</p>
      ) : null}
    </div>
  );
});
