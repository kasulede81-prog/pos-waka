import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { hasPermission } from "../../lib/permissions";
import { useSessionActor } from "../../context/SessionActorContext";
import { getLastRestoreQueueSafety, readRestoreArchiveStats } from "../../lib/restoreSyncSafety";
import { buildQueueSyncDiagnosticSnapshot, type QueueSyncDiagnosticSnapshot } from "../../lib/queueSyncDiagnostics";
import {
  analyzeSnapshotTrim,
  getLastSnapshotUploadTrimAnalysis,
  type SnapshotTrimAnalysis,
} from "../../lib/snapshotTrimDiagnostics";
import {
  buildPostRestoreValidationSnapshot,
  getLastPostRestoreValidation,
  type PostRestoreValidationSnapshot,
} from "../../lib/postRestoreValidation";
import { snapshotFromPartial } from "../../offline/backupEngine";

function statusLabel(lang: Language, status: "healthy" | "warning" | "critical"): string {
  if (status === "healthy") return t(lang, "recoveryStatusHealthy");
  if (status === "critical") return t(lang, "recoveryStatusCritical");
  return t(lang, "recoveryStatusWarning");
}

function statusClass(status: "healthy" | "warning" | "critical"): string {
  if (status === "healthy") return "border border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "critical") return "border border-red-200 bg-red-50 text-red-950";
  return "border border-amber-200 bg-amber-50 text-amber-950";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-100 bg-stone-50/80 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-stone-500">{title}</p>
      <div className="mt-2 space-y-1 text-sm text-stone-800">{children}</div>
    </section>
  );
}

export function RecoveryReadinessDashboard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const stockMovements = usePosStore((s) => s.stockMovements);
  const suppliers = usePosStore((s) => s.suppliers);
  const purchases = usePosStore((s) => s.purchases);
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const archivedSales = usePosStore((s) => s.archivedSales);

  const [queueSnap, setQueueSnap] = useState<QueueSyncDiagnosticSnapshot | null>(null);
  const [archiveTotal, setArchiveTotal] = useState(0);

  const canView = hasPermission(actor.role, "owner.dashboard");

  useEffect(() => {
    if (!canView) return;
    void buildQueueSyncDiagnosticSnapshot().then(setQueueSnap);
    void readRestoreArchiveStats().then((s) => setArchiveTotal(s.totalArchivedOps));
  }, [canView, products.length, sales.length]);

  const currentTrimAnalysis = useMemo((): SnapshotTrimAnalysis => {
    const prefs = usePosStore.getState().preferences;
    const snap = snapshotFromPartial({
      products,
      customers,
      sales,
      preferences: prefs,
      debtPayments,
      suppliers,
      purchases,
      supplierPayments,
      stockMovements,
      archivedSales,
    });
    if (!snap) {
      return analyzeSnapshotTrim({
        products,
        customers,
        sales,
        preferences: prefs,
        debtPayments,
        dayCloses: [],
        updatedAt: new Date().toISOString(),
        archivedSales,
      });
    }
    return analyzeSnapshotTrim(snap);
  }, [products, customers, sales, debtPayments, suppliers, purchases, supplierPayments, stockMovements, archivedSales]);

  const liveValidation = useMemo(
    (): PostRestoreValidationSnapshot =>
      buildPostRestoreValidationSnapshot({
        products,
        customers,
        sales,
        debtPayments,
        stockMovements,
        suppliers,
        purchases,
        supplierPayments,
      }),
    [products, customers, sales, debtPayments, stockMovements, suppliers, purchases, supplierPayments],
  );

  const lastRestore = getLastRestoreQueueSafety();
  const lastUploadTrim = getLastSnapshotUploadTrimAnalysis();
  const lastPostRestore = getLastPostRestoreValidation();

  if (!canView) return null;

  const overallStatus = liveValidation.overallStatus;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "recoveryReadinessTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "recoveryReadinessSub")}</p>

      <p className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${statusClass(overallStatus)}`}>
        {statusLabel(lang, overallStatus)}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Section title={t(lang, "recoverySectionSyncQueue")}>
          <p>{t(lang, "recoveryQueueCount")}: {queueSnap?.queuedCount ?? "…"}</p>
          <p>{t(lang, "recoveryQueueOldest")}: {formatAge(queueSnap?.oldestOpAgeMs ?? null)}</p>
          <p>{t(lang, "recoveryQueueMaxRetries")}: {queueSnap?.maxAttempts ?? 0}</p>
          {queueSnap?.localOnlyMode ? (
            <p className="font-semibold text-amber-900">{t(lang, "recoveryQueueLocalOnly")}</p>
          ) : null}
        </Section>

        <Section title={t(lang, "recoverySectionRestoreHealth")}>
          {lastRestore ? (
            <>
              <p>{t(lang, "recoveryRestoreCleared")}: {lastRestore.clearedCount}</p>
              <p>{t(lang, "recoveryRestoreArchived")}: {lastRestore.archivedCount}</p>
              <p className="text-xs text-stone-500">{new Date(lastRestore.at).toLocaleString()}</p>
            </>
          ) : (
            <p className="text-stone-500">{t(lang, "recoveryRestoreNone")}</p>
          )}
          <p>{t(lang, "recoveryArchiveTotal")}: {archiveTotal}</p>
        </Section>

        <Section title={t(lang, "recoverySectionSnapshotHealth")}>
          <p>{t(lang, "recoverySnapshotSize")}: {formatBytes(currentTrimAnalysis.originalBytes)}</p>
          <p>{t(lang, "recoverySnapshotSales")}: {currentTrimAnalysis.retainedSalesCount} / {currentTrimAnalysis.originalSalesCount}</p>
          <p>{t(lang, "recoverySnapshotArchives")}: {currentTrimAnalysis.retainedArchivedSalesCount} / {currentTrimAnalysis.originalArchivedSalesCount}</p>
          {currentTrimAnalysis.wouldTrim ? (
            <p className="font-semibold text-amber-900">{t(lang, "recoverySnapshotWouldTrim")}</p>
          ) : null}
          {lastUploadTrim?.wouldTrim ? (
            <p className="text-xs text-amber-800">{t(lang, "recoverySnapshotLastTrim")}: {lastUploadTrim.status}</p>
          ) : null}
        </Section>

        <Section title={t(lang, "recoverySectionDebt")}>
          <p>{statusLabel(lang, liveValidation.debt.status)} · {liveValidation.debt.mismatchCount} {t(lang, "recoveryMismatchLabel")}</p>
          {lastPostRestore ? (
            <p className="text-xs text-stone-500">{t(lang, "recoveryLastRestoreCheck")}: {new Date(lastPostRestore.checkedAt).toLocaleString()}</p>
          ) : null}
        </Section>

        <Section title={t(lang, "recoverySectionInventory")}>
          <p>{statusLabel(lang, liveValidation.inventory.status)} · {liveValidation.inventory.mismatchCount} {t(lang, "recoveryMismatchLabel")}</p>
        </Section>

        <Section title={t(lang, "recoverySectionSuppliers")}>
          <p>{statusLabel(lang, liveValidation.suppliers.status)} · {liveValidation.suppliers.mismatchCount} {t(lang, "recoveryMismatchLabel")}</p>
          <p>{t(lang, "recoveryPurchasesVoided")}: {liveValidation.purchases.voidedCount}</p>
          <p>{t(lang, "recoveryPurchasesPending")}: {liveValidation.purchases.pendingSyncCount}</p>
        </Section>
      </div>
    </article>
  );
}

/** Focused restore queue safety card (also included in RecoveryReadinessDashboard). */
export function RestoreDiagnosticsCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const [archiveTotal, setArchiveTotal] = useState(0);
  const canView = hasPermission(actor.role, "owner.dashboard");
  const lastRestore = getLastRestoreQueueSafety();

  useEffect(() => {
    if (!canView) return;
    void readRestoreArchiveStats().then((s) => setArchiveTotal(s.totalArchivedOps));
  }, [canView, lastRestore?.at]);

  if (!canView) return null;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "restoreDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "restoreDiagnosticsSub")}</p>
      {lastRestore ? (
        <div className="mt-3 space-y-1 text-sm">
          <p>{t(lang, "recoveryRestoreCleared")}: <strong>{lastRestore.clearedCount}</strong></p>
          <p>{t(lang, "recoveryRestoreArchived")}: <strong>{lastRestore.archivedCount}</strong></p>
          <p className="text-xs text-stone-500">{new Date(lastRestore.at).toLocaleString()}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-500">{t(lang, "recoveryRestoreNone")}</p>
      )}
      <p className="mt-2 text-sm">{t(lang, "recoveryArchiveTotal")}: {archiveTotal}</p>
    </article>
  );
}

export function QueueStatusCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const [queueSnap, setQueueSnap] = useState<QueueSyncDiagnosticSnapshot | null>(null);
  const canView = hasPermission(actor.role, "owner.dashboard");

  useEffect(() => {
    if (!canView) return;
    void buildQueueSyncDiagnosticSnapshot().then(setQueueSnap);
  }, [canView]);

  if (!canView) return null;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "queueStatusTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "queueStatusSub")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <span>{t(lang, "recoveryQueueCount")}: {queueSnap?.queuedCount ?? 0}</span>
        <span>{t(lang, "recoveryQueueOldest")}: {formatAge(queueSnap?.oldestOpAgeMs ?? null)}</span>
        <span>{t(lang, "recoveryQueueMaxRetries")}: {queueSnap?.maxAttempts ?? 0}</span>
        <span>{t(lang, "recoveryQueueNextRetry")}: {queueSnap?.nextRetryMs != null ? `${Math.ceil(queueSnap.nextRetryMs / 1000)}s` : "—"}</span>
      </div>
      {queueSnap?.localOnlyMode ? (
        <p className="mt-2 text-xs font-semibold text-amber-900">{t(lang, "recoveryQueueLocalOnly")}</p>
      ) : null}
    </article>
  );
}

export function SnapshotHealthCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const archivedSales = usePosStore((s) => s.archivedSales);
  const canView = hasPermission(actor.role, "owner.dashboard");

  const analysis = useMemo(() => {
    const prefs = usePosStore.getState().preferences;
    const snap = snapshotFromPartial({
      products,
      customers,
      sales,
      preferences: prefs,
      debtPayments,
      archivedSales,
    });
    const payload = snap ?? {
      products,
      customers,
      sales,
      preferences: prefs,
      debtPayments,
      dayCloses: [],
      updatedAt: new Date().toISOString(),
      archivedSales,
    };
    return analyzeSnapshotTrim(payload);
  }, [products, customers, sales, debtPayments, archivedSales]);

  const lastUpload = getLastSnapshotUploadTrimAnalysis();

  if (!canView) return null;

  const status =
    analysis.status === "ok"
      ? "healthy"
      : analysis.status === "critical" || analysis.status === "trimmed_sales"
        ? "critical"
        : "warning";

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "snapshotHealthTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "snapshotHealthSub")}</p>
      <p className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${statusClass(status)}`}>
        {statusLabel(lang, status)}
      </p>
      <div className="mt-3 space-y-1 text-sm">
        <p>{t(lang, "recoverySnapshotSize")}: {formatBytes(analysis.originalBytes)}</p>
        <p>{t(lang, "recoverySnapshotSales")}: {analysis.retainedSalesCount} / {analysis.originalSalesCount}</p>
        <p>{t(lang, "recoverySnapshotArchives")}: {analysis.retainedArchivedSalesCount} / {analysis.originalArchivedSalesCount}</p>
        {analysis.wouldTrim ? <p className="font-semibold text-amber-900">{t(lang, "recoverySnapshotWouldTrim")}</p> : null}
        {lastUpload?.wouldTrim ? (
          <p className="text-xs text-stone-500">{t(lang, "recoverySnapshotLastUploadTrim")}: {lastUpload.salesTrimmedCount} sales</p>
        ) : null}
      </div>
    </article>
  );
}
