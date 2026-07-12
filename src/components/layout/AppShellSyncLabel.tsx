import { memo } from "react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useOfflineStatus } from "../../hooks/useOfflineStatus";
import { useSessionConnectionState } from "../../hooks/useSessionConnectionState";
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
  pullPaused: boolean,
  uploadPausedReason: string | null,
): string {
  if (!online) return t(lang, "posUploadWaitingNetwork");
  if (uploadPausedReason === "recovery_lock" || uploadPausedReason === "org_blocked") {
    return t(lang, "posUploadPaused");
  }
  if (syncing) return t(lang, "posUploadInProgress");
  if (syncErrors > 0) return tTemplate(lang, "syncErrorCount", { count: String(syncErrors) });
  if (queueHealth === "backing_off") return t(lang, "autoSyncQueueBackoff");
  if (queueHealth === "degraded") return t(lang, "autoSyncQueueDegraded");
  if (pendingCount > 0) {
    return tTemplate(lang, "posUploadPendingCount", { count: String(pendingCount) });
  }
  if (pullPaused) return t(lang, "posUploadComplete");
  return t(lang, "autoSyncSyncedBanner");
}

/** Isolated sync strip — updates here do not re-render the whole AppShell / POS tree. */
export const AppShellSyncLabel = memo(function AppShellSyncLabel({
  lang,
  inverted = false,
}: {
  lang: Language;
  inverted?: boolean;
}) {
  const { isOnline } = useOfflineStatus();
  const sessionConnection = useSessionConnectionState();
  const { syncing, pendingCount, health, pullPaused } = useSyncStatus();
  const syncErrors = countSalesWithSyncErrors();
  const salesHydration = usePosStore((s) => s.salesHistoryHydration);
  const needsAction = isOnline && syncErrors > 0;

  const syncLine = label(
    lang,
    syncing,
    pendingCount,
    isOnline,
    syncErrors,
    health.queueHealth,
    pullPaused,
    health.lastPosPushSkipReason ?? null,
  );
  const offlineDur = !isOnline ? offlineDurationLabel(health.offlineSinceAt) : null;
  const lastSuccess = fmtShort(health.lastPosPushSuccessAt ?? health.lastSuccessAt, lang);

  const hydrationLine =
    salesHydration?.active
      ? salesHydration.total > 0
        ? `${t(lang, "salesHistoryHydrationLoading")} ${tTemplate(lang, "salesHistoryHydrationCount", {
            loaded: String(salesHydration.loaded),
            total: String(salesHydration.total),
          })}`
        : t(lang, "salesHistoryHydrationLoading")
      : null;

  const authSessionLine =
    sessionConnection === "offline_cached"
      ? t(lang, "authSessionOfflineCached")
      : sessionConnection === "reconnecting"
        ? t(lang, "authSessionReconnecting")
        : null;

  return (
    <div className="min-w-0">
      {authSessionLine ? (
        <p className={`truncate text-[11px] font-semibold ${inverted ? "text-amber-100" : "text-amber-800"}`}>
          {authSessionLine}
        </p>
      ) : null}
      <p
        className={`truncate text-[11px] font-medium ${
          needsAction
            ? inverted
              ? "text-rose-100"
              : "text-rose-800"
            : inverted
              ? "text-waka-50"
              : "text-waka-800/90"
        }`}
        title={needsAction ? t(lang, "syncErrorBanner") : undefined}
      >
        {syncLine}
      </p>
      {offlineDur ? (
        <p className={`truncate text-[10px] font-semibold ${inverted ? "text-waka-100/90" : "text-muted-foreground"}`}>
          {tTemplate(lang, "autoSyncOfflineDuration", { duration: offlineDur })}
        </p>
      ) : null}
      {isOnline && lastSuccess && !syncing && pendingCount === 0 && syncErrors === 0 ? (
        <p className={`truncate text-[10px] font-medium ${inverted ? "text-emerald-100" : "text-emerald-800"}`}>
          {tTemplate(lang, "autoSyncLastSuccess", { time: lastSuccess })}
        </p>
      ) : null}
      {hydrationLine ? (
        <p className={`truncate text-[10px] font-semibold ${inverted ? "text-amber-100" : "text-amber-800"}`}>
          {hydrationLine}
        </p>
      ) : null}
    </div>
  );
});
