import { useEffect } from "react";
import { Upload } from "lucide-react";
import { AdminDiagnosticsImportPanel } from "../../../ops/AdminDiagnosticsImportPanel";
import { AdminSyncInvestigationPanel } from "../../../ops/AdminSyncInvestigationPanel";
import { AdminCollapsible } from "../../../adminUi";
import {
  RescueActionButton,
  RescueMetric,
  RescueMetricGrid,
  RescueRow,
  RescueSection,
} from "../../../rescue/RescuePrimitives";
import { ResponsiveDataTable } from "../../../../shared/ResponsiveDataTable";
import { inventoryIntegrityFromSources } from "../../../../../lib/rescueConsoleIntel";
import { rescueDiagnosticsKindLabel } from "../../../../../lib/rescueDiagnosticsParse";
import { adminShopForceLogoutDevices, adminShopResetSync } from "../../../../../lib/wakaInternalAdmin";
import { t } from "../../../../../lib/i18n";
import { runShopConsoleRescueAction } from "../rescueRun";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB");
}

export function ShopConsoleDeveloperTab({ ctx }: Props) {
  const {
    lang,
    detail,
    canSupport,
    busy,
    previewMode,
    importedPending,
    setImportedPending,
    rescue,
    loadRescueData,
    loadImport,
    executeAction,
  } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  if (!detail) return null;

  const syncHealth = detail.sync_health;
  const diagnostics = rescue.diagnostics;
  const pendingFromImport = diagnostics?.pendingQueueTotal ?? null;
  const inventory = inventoryIntegrityFromSources(detail, diagnostics);

  const refreshDiagnostics = () => {
    void runShopConsoleRescueAction(ctx, "rescue_refresh_diagnostics", async () => {
      await loadRescueData();
      return { ok: true };
    });
  };

  return (
    <div className="space-y-3">
      {canSupport ? (
        <AdminDiagnosticsImportPanel
          previewMode={previewMode}
          defaultShopId={detail.shop.id}
          onParsed={(p) => setImportedPending(p?.valid ? p.pendingSyncQueue : null)}
        />
      ) : null}

      {canSupport ? (
        <AdminSyncInvestigationPanel detail={detail} diagnosticsPending={importedPending} />
      ) : null}

      {detail.sync_health ? (
        <AdminCollapsible
          title={t(lang, "internalShopProfileSyncTitle")}
          summary={`${detail.sync_health.pending_outbound} pending`}
        >
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSyncPending")}</dt>
              <dd className="font-mono font-black">{detail.sync_health.pending_outbound}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSyncLastPull")}</dt>
              <dd className="font-mono text-xs text-stone-700">
                {detail.sync_health.last_pull_at
                  ? new Date(detail.sync_health.last_pull_at).toLocaleString("en-GB")
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-bold text-stone-500">{t(lang, "internalShopProfileSyncLastPush")}</dt>
              <dd className="font-mono text-xs text-stone-700">
                {detail.sync_health.last_push_ok_at
                  ? new Date(detail.sync_health.last_push_ok_at).toLocaleString("en-GB")
                  : "—"}
              </dd>
            </div>
            {detail.sync_health.last_error ? (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
                {detail.sync_health.last_error}
              </p>
            ) : null}
          </dl>
        </AdminCollapsible>
      ) : null}

      <RescueSection id="sync" title="Sync Health" summary="Cloud queue and device-side sync signals">
        <dl className="grid gap-2 sm:grid-cols-2">
          <RescueRow label="Queue size" value={String(syncHealth?.pending_outbound ?? pendingFromImport ?? 0)} />
          <RescueRow
            label="Failed operations"
            value={String(diagnostics?.syncHealth?.failedOperations ?? diagnostics?.pilot?.syncErrorCount ?? 0)}
          />
          <RescueRow
            label="Retry wait"
            value={
              diagnostics?.syncHealth?.retryWaitMs != null
                ? `${Math.round(diagnostics.syncHealth.retryWaitMs / 1000)}s`
                : "—"
            }
          />
          <RescueRow
            label="Last push"
            value={fmtTime(syncHealth?.last_push_ok_at ?? diagnostics?.syncHealth?.lastPushOkAt)}
          />
          <RescueRow
            label="Last pull"
            value={fmtTime(syncHealth?.last_pull_at ?? diagnostics?.syncHealth?.lastPullAt)}
          />
          <RescueRow
            label="Pending uploads"
            value={String(
              diagnostics?.syncHealth?.pendingUploads ?? pendingFromImport ?? syncHealth?.pending_outbound ?? 0,
            )}
          />
          <RescueRow label="Pending downloads" value={String(diagnostics?.syncHealth?.pendingDownloads ?? 0)} />
          <RescueRow
            label="Inventory reconciliation"
            value={diagnostics?.syncHealth?.inventoryReconciliation ?? inventory?.status ?? "—"}
          />
          <RescueRow label="Audit queue" value={String(diagnostics?.syncHealth?.auditQueue ?? 0)} />
        </dl>
        {syncHealth?.last_error ? (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">{syncHealth.last_error}</p>
        ) : null}
        {canSupport ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <RescueActionButton
              disabled={busy}
              onClick={() => void runShopConsoleRescueAction(ctx, "rescue_reset_sync", () => adminShopResetSync(detail.shop.id))}
            >
              Reset sync
            </RescueActionButton>
            <RescueActionButton
              variant="secondary"
              disabled={busy}
              onClick={() => void runShopConsoleRescueAction(ctx, "rescue_retry_sync", () => adminShopResetSync(detail.shop.id))}
            >
              Retry failed sync
            </RescueActionButton>
            <RescueActionButton variant="secondary" disabled={busy} onClick={() => void refreshDiagnostics()}>
              Force refresh diagnostics
            </RescueActionButton>
          </div>
        ) : null}
      </RescueSection>

      {inventory ? (
        <RescueSection id="inventory" title="Inventory Integrity" summary="Read-only parity view">
          <RescueMetricGrid>
            <RescueMetric label="Product count" value={String(inventory.productCount)} />
            <RescueMetric label="Movement count" value={String(inventory.movementCount)} />
            <RescueMetric
              label="Integrity status"
              value={inventory.status}
              tone={inventory.mismatchCount ? "warn" : "good"}
            />
            <RescueMetric
              label="Mismatch count"
              value={String(inventory.mismatchCount)}
              tone={inventory.mismatchCount ? "bad" : "good"}
            />
          </RescueMetricGrid>
          {inventory.mismatches.length > 0 ? (
            <div className="mt-3">
              <ResponsiveDataTable minWidthPx={520}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Recorded</th>
                    <th>Expected</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.mismatches.map((m) => (
                    <tr key={m.product}>
                      <td>{m.product}</td>
                      <td>{m.recorded}</td>
                      <td>{m.expected}</td>
                      <td>{m.difference}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveDataTable>
            </div>
          ) : (
            <p className="mt-3 text-xs text-stone-500">
              No mismatches in imported diagnostics. Table vs snapshot: {detail.product_count_table ?? "—"} /{" "}
              {detail.product_count_snapshot ?? "—"}
            </p>
          )}
        </RescueSection>
      ) : null}

      <RescueSection id="import" title="Diagnostics Import" summary="Cloud Trust, Production Certification, Startup, Sync Health">
        <textarea
          value={rescue.importText}
          onChange={(e) => loadImport(e.target.value)}
          rows={5}
          placeholder="Paste owner JSON export (pilot, cloud trust, production certification, startup, recovery, sync health…)"
          className="w-full rounded-xl border border-stone-200 px-3 py-2 font-mono text-xs"
        />
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-bold text-teal-900">
          <Upload className="h-4 w-4" aria-hidden />
          Upload JSON
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => loadImport(String(reader.result ?? ""));
              reader.readAsText(file);
            }}
          />
        </label>
        {diagnostics && !diagnostics.valid ? (
          <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
            {diagnostics.parseError ?? "Unrecognized format"}
          </p>
        ) : null}
        {diagnostics?.valid ? (
          <dl className="mt-3 grid gap-2 text-sm">
            <RescueRow label="Detected format" value={rescueDiagnosticsKindLabel(diagnostics.kind)} />
            <RescueRow label="Exported" value={fmtTime(diagnostics.exportedAt)} />
            <RescueRow label="Shop ID in file" value={diagnostics.shopId ?? "—"} />
            {diagnostics.pendingQueueTotal != null ? (
              <RescueRow label="Pending queue" value={String(diagnostics.pendingQueueTotal)} />
            ) : null}
          </dl>
        ) : null}
      </RescueSection>

      {canSupport ? (
        <AdminCollapsible title="Remote support" summary="Sync & session tools">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="min-h-[44px] rounded-xl bg-stone-900 px-4 text-xs font-black text-white disabled:opacity-40"
              onClick={() =>
                void executeAction("admin_force_sync", () => adminShopResetSync(detail.shop.id), {
                  permitted: canSupport,
                })
              }
            >
              Force sync reset
            </button>
            <button
              type="button"
              disabled={busy}
              className="min-h-[44px] rounded-xl border border-stone-300 px-4 text-xs font-black disabled:opacity-40"
              onClick={() =>
                void executeAction("admin_force_logout", () => adminShopForceLogoutDevices(detail.shop.id), {
                  permitted: canSupport,
                  confirm: t(lang, "internalShopActionConfirmLogout"),
                })
              }
            >
              Force logout devices
            </button>
          </div>
        </AdminCollapsible>
      ) : null}
    </div>
  );
}
