import { useEffect, useMemo, useState, type ReactNode } from "react";
import { actorHasPermission } from "../../lib/actorAuthorization";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";

import { useSessionActor } from "../../context/SessionActorContext";
import { getLastRestoreQueueSafety, readRestoreArchiveStats } from "../../lib/restoreSyncSafety";
import { buildQueueSyncDiagnosticSnapshot, type QueueSyncDiagnosticSnapshot } from "../../lib/queueSyncDiagnostics";
import {
  analyzeSnapshotTrim,
  getLastSnapshotUploadTrimAnalysis,
  type SnapshotTrimAnalysis,
} from "../../lib/snapshotTrimDiagnostics";
import { buildPostRestoreValidationSnapshot,
  getLastPostRestoreValidation,
  type PostRestoreValidationSnapshot,
} from "../../lib/postRestoreValidation";
import { buildCloudRecoverySnapshotFromStore } from "../../lib/cloudAuthorityAudit";
import { readLastCloudRecoveryDiagnostics } from "../../lib/cloudRecoverySession";
import { buildRecoveryCompletenessReport } from "../../lib/cloudRecoveryCompleteness";
import { wasLastSalesPullTruncated } from "../../offline/cloudSync";
import {
  buildCloudRecoverySimulationReport,
  getLastCloudRecoveryValidation,
  recordCloudRecoveryValidation,
  type CloudRecoveryValidationResult,
} from "../../lib/cloudRecoveryValidator";
import { snapshotFromPartial } from "../../offline/backupEngine";
import { useSystemHealthDiagnostics } from "./SystemHealthDiagnosticsProvider";

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

export function RecoveryReadinessDashboard({ lang, lazy = false }: { lang: Language; lazy?: boolean }) {
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
  const { shared, queue, ensureShared } = useSystemHealthDiagnostics();

  const [queueSnap, setQueueSnap] = useState<QueueSyncDiagnosticSnapshot | null>(null);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [simResult, setSimResult] = useState<CloudRecoveryValidationResult | null>(() =>
    getLastCloudRecoveryValidation(),
  );

  const canView = actorHasPermission(actor, "owner.dashboard");

  useEffect(() => {
    if (lazy) void ensureShared();
  }, [lazy, ensureShared]);

  useEffect(() => {
    if (!canView) return;
    if (lazy) {
      setQueueSnap(shared?.queue ?? queue);
    } else {
      void buildQueueSyncDiagnosticSnapshot().then(setQueueSnap);
    }
  }, [canView, lazy, shared, queue, products.length, sales.length]);

  useEffect(() => {
    if (!canView) return;
    void readRestoreArchiveStats().then((s) => setArchiveTotal(s.totalArchivedOps));
  }, [canView]);

  const currentTrimAnalysis = useMemo((): SnapshotTrimAnalysis => {
    if (shared?.snapshotTrim) return shared.snapshotTrim;
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
  }, [shared, products, customers, sales, debtPayments, suppliers, purchases, supplierPayments, stockMovements, archivedSales]);

  const liveValidation = useMemo((): PostRestoreValidationSnapshot => {
    if (shared?.postRestoreValidation) return shared.postRestoreValidation;
    return buildPostRestoreValidationSnapshot({
      products,
      customers,
      sales,
      debtPayments,
      stockMovements,
      suppliers,
      purchases,
      supplierPayments,
    });
  }, [shared, products, customers, sales, debtPayments, stockMovements, suppliers, purchases, supplierPayments]);

  const cloudRecovery = useMemo(() => buildCloudRecoverySnapshotFromStore(), [
    products.length,
    sales.length,
    customers.length,
    purchases.length,
    suppliers.length,
    debtPayments.length,
  ]);

  const lastRestore = getLastRestoreQueueSafety();
  const lastUploadTrim = getLastSnapshotUploadTrimAnalysis();
  const lastPostRestore = getLastPostRestoreValidation();

  if (!canView) return null;

  const overallStatus = liveValidation.overallStatus;

  const lastRecovery = readLastCloudRecoveryDiagnostics();

  const completeness = useMemo(() => {
    const s = usePosStore.getState();
    return buildRecoveryCompletenessReport({
      validation: buildCloudRecoverySimulationReport(),
      probe: {
        hasSnapshot: products.length > 0 || sales.length > 0,
        snapshotUpdatedAt: null,
        hasCloudProducts: products.length > 0,
        snapshotRowFound: products.length > 0 || sales.length > 0,
        snapshotContainsCoreData: products.length > 0 || sales.length > 0,
      },
      stockMovements: s.stockMovements.length,
      inventoryCountSessions: s.inventoryCountSessions.length,
      archivedSales: archivedSales.length,
      salesPullTruncated: wasLastSalesPullTruncated(),
    });
  }, [products.length, sales.length, archivedSales.length]);

  const runRecoverySimulation = () => {
    const result = buildCloudRecoverySimulationReport();
    recordCloudRecoveryValidation(result);
    setSimResult(result);
  };

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "recoveryReadinessTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "recoveryReadinessSub")}</p>

      <p className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${statusClass(overallStatus)}`}>
        {statusLabel(lang, overallStatus)}
      </p>

      <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
        <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "cloudRecoveryStatusTitle")}</p>
        <p className="mt-1 text-2xl font-black tabular-nums text-stone-950">
          {tTemplate(lang, "cloudRecoveryScoreLabel", { pct: cloudRecovery.scorePct })}
        </p>
        <p className="mt-1 text-xs font-semibold text-stone-600">
          {t(lang, cloudRecovery.badgeKey)} · {cloudRecovery.authoritativeCount} {t(lang, "cloudProtectionAuthoritative")} ·{" "}
          {cloudRecovery.partialCount} {t(lang, "cloudProtectionPartial")} · {cloudRecovery.localOnlyCount}{" "}
          {t(lang, "cloudProtectionLocalOnly")}
        </p>
        {!cloudRecovery.recoveryReady ? (
          <p className="mt-2 text-xs font-semibold text-amber-900">{t(lang, "cloudRecoveryNotReadyHint")}</p>
        ) : null}
      </div>

      <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
        <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "recoveryCompletenessTitle")}</p>
        <p className="mt-1 text-2xl font-black tabular-nums text-stone-950">{completeness.scorePct}%</p>
        <ul className="mt-2 space-y-1 text-xs text-stone-700">
          {completeness.categories.map((cat) => (
            <li key={cat.id} className="flex justify-between gap-2">
              <span>{t(lang, cat.labelKey)}</span>
              <span className={cat.restored ? "font-bold text-emerald-800" : "font-bold text-amber-800"}>
                {cat.restored ? "✓" : "…"} {cat.localCount}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Section title={t(lang, "cloudEntityMatrixTitle")}>
        <ul className="space-y-1">
          {cloudRecovery.entities.map((entity) => (
            <li key={entity.id} className="flex flex-wrap items-center justify-between gap-1 text-xs">
              <span className="font-semibold text-stone-800">{t(lang, entity.labelKey)}</span>
              <span className="font-bold text-stone-600">
                {t(lang, entity.protectionLabelKey)}
                {entity.localCount > 0 ? ` · ${entity.localCount}` : ""}
                {entity.unsyncedCount > 0 ? ` · ${entity.unsyncedCount} unsynced` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t(lang, "recoveryDiagnosticsTitle")}>
        {lastRecovery?.finishedAt ? (
          <>
            <p>
              {lastRecovery.status === "complete"
                ? t(lang, "recoveryDiagnosticsSuccess")
                : t(lang, "recoveryDiagnosticsFailure")}
              {" · "}
              {new Date(lastRecovery.finishedAt).toLocaleString()}
            </p>
            {lastRecovery.durationMs != null ? (
              <p>
                {t(lang, "recoveryDiagnosticsDuration")}: {Math.round(lastRecovery.durationMs / 1000)}s
              </p>
            ) : null}
            <p>
              {t(lang, "recoveryDiagnosticsCounts")}: {lastRecovery.entityCounts.products} products ·{" "}
              {lastRecovery.entityCounts.sales} sales · {lastRecovery.entityCounts.customers} customers ·{" "}
              {lastRecovery.entityCounts.shifts} shifts · {lastRecovery.entityCounts.dayCloses} day closes
            </p>
            {lastRecovery.completeness ? (
              <p className="text-xs font-semibold text-stone-700">
                {t(lang, "recoveryCompletenessTitle")}: {lastRecovery.completeness.scorePct}%
              </p>
            ) : null}
            {lastRecovery.errorMessage ? (
              <p className="text-xs font-semibold text-rose-900">{lastRecovery.errorMessage}</p>
            ) : null}
            {lastRecovery.errorKey ? (
              <p className="text-xs font-semibold text-amber-900">
                {t(lang, "recoveryErrorKey")}: {lastRecovery.errorKey}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-stone-500">{t(lang, "recoveryDiagnosticsNone")}</p>
        )}
      </Section>

      <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/80 p-3">
        <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "cloudRecoverySimulationTitle")}</p>
        <p className="mt-1 text-sm text-stone-600">{t(lang, "cloudRecoverySimulationSub")}</p>
        <button
          type="button"
          onClick={runRecoverySimulation}
          className="mt-3 inline-flex min-h-[40px] items-center rounded-xl bg-stone-900 px-4 text-sm font-black text-white"
        >
          {t(lang, "cloudRecoverySimulationRun")}
        </button>
        {simResult ? (
          <div className="mt-3 space-y-1 text-sm text-stone-800">
            <p className={`font-bold ${simResult.ok ? "text-emerald-800" : "text-amber-900"}`}>
              {simResult.ok ? t(lang, "cloudRecoverySimulationOk") : t(lang, "cloudRecoverySimulationFail")}
            </p>
            <p>{t(lang, "cloudRecoverySimulationCounts")}: {simResult.counts.products} products · {simResult.counts.sales} sales · {simResult.counts.customers} customers</p>
            <p>{t(lang, "cloudRecoverySimulationFinancial")}: UGX {simResult.financial.revenueUgx.toLocaleString()} revenue · UGX {simResult.financial.profitUgx.toLocaleString()} profit</p>
            <p>{t(lang, "cloudRecoverySimulationInventory")}: UGX {simResult.inventoryValueUgx.toLocaleString()}</p>
            <p>{t(lang, "cloudRecoverySimulationDebt")}: {simResult.debtMismatches}</p>
            {simResult.failures.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-amber-950">
                {simResult.failures.map((f) => (
                  <li key={f.code}>
                    <strong>{f.severity}</strong>: {f.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-stone-500">{new Date(simResult.checkedAt).toLocaleString()}</p>
          </div>
        ) : null}
      </div>

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
  const canView = actorHasPermission(actor, "owner.dashboard");
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

export function QueueStatusCard({ lang, lazy = false }: { lang: Language; lazy?: boolean }) {
  const actor = useSessionActor();
  const { queue, shared, ensureShared } = useSystemHealthDiagnostics();
  const [queueSnap, setQueueSnap] = useState<QueueSyncDiagnosticSnapshot | null>(null);
  const canView = actorHasPermission(actor, "owner.dashboard");

  useEffect(() => {
    if (lazy) void ensureShared();
  }, [lazy, ensureShared]);

  useEffect(() => {
    if (!canView) return;
    if (lazy) {
      setQueueSnap(shared?.queue ?? queue);
      return;
    }
    void buildQueueSyncDiagnosticSnapshot().then(setQueueSnap);
  }, [canView, lazy, shared, queue]);

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

export function SnapshotHealthCard({ lang, lazy = false }: { lang: Language; lazy?: boolean }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const archivedSales = usePosStore((s) => s.archivedSales);
  const { shared, ensureShared } = useSystemHealthDiagnostics();
  const canView = actorHasPermission(actor, "owner.dashboard");

  useEffect(() => {
    if (lazy) void ensureShared();
  }, [lazy, ensureShared]);

  const analysis = useMemo(() => {
    if (shared?.snapshotTrim) return shared.snapshotTrim;
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
  }, [shared, products, customers, sales, debtPayments, archivedSales]);

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
