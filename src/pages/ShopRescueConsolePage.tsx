import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { AdminShell } from "../components/internal-admin/v2/AdminShell";
import { adminPermissions } from "../components/internal-admin/v2/adminRoles";
import { InternalNotesPanel } from "../components/internal-admin/v2/ops/OpsWidgets";
import {
  RescueActionButton,
  RescueMetric,
  RescueMetricGrid,
  RescueRow,
  RescueSection,
} from "../components/internal-admin/rescue/RescuePrimitives";
import { ResponsiveDataTable } from "../components/shared/ResponsiveDataTable";
import { adminKpiGridClass, KPI_VALUE_CLASS } from "../lib/desktopLayout";
import {
  buildRescueFinancialSnapshot,
  buildRescueHealthSummary,
  computeCloudBackupFinancial,
  exportRescueSupportLogs,
  filterRescueAuditEvents,
  inventoryIntegrityFromSources,
  mapOpsAuditToRescueEvents,
  type RescueAuditFilters,
} from "../lib/rescueConsoleIntel";
import {
  parseRescueDiagnosticsJson,
  rescueDiagnosticsKindLabel,
  type ParsedRescueDiagnostics,
} from "../lib/rescueDiagnosticsParse";
import {
  fetchShopCloudSnapshotForRescue,
  fetchShopRecoverySignals,
  logRescueSupportAction,
} from "../lib/rescueSupportActions";
import { sendOwnerPasswordResetEmail } from "../lib/shopRecoverySignals";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { formatWakaShopNumber } from "../lib/shopNumber";
import {
  adminSetShopActive,
  adminShopDeviceSetTrusted,
  adminShopForceLogoutDevices,
  adminShopLogPasswordResetEmail,
  adminShopResetBackOfficePin,
  adminShopResetSync,
  adminShopSendOwnerPasswordReset,
  fetchShopAuditTimeline,
  fetchShopOpsDetail,
  fetchWakaInternalAdminMe,
  formatDisplayEmail,
  formatLastActive,
  formatOwnerDisplayLabel,
  whatsappUrlFromPhone,
  type OpsAuditRow,
  type ShopDeviceRow,
  type ShopOpsDetail,
  type WakaInternalAdminRow,
} from "../lib/wakaInternalAdmin";
import {
  INTERNAL_ADMIN_PREVIEW_ROW,
  internalAdminShopHref,
  isInternalAdminPreviewActive,
  PREVIEW_SHOP_ID,
  PREVIEW_SHOP_OPS_DETAIL,
} from "../lib/internalAdminPreview";
import { healthColor } from "../lib/internalOpsIntelligence";
import clsx from "clsx";
import { Upload } from "lucide-react";

type Props = {
  lang: Language;
  email: string | null | undefined;
};

const SECTIONS = [
  { id: "health", label: "Health" },
  { id: "owner", label: "Owner" },
  { id: "recovery", label: "Recovery" },
  { id: "sync", label: "Sync" },
  { id: "inventory", label: "Inventory" },
  { id: "devices", label: "Devices" },
  { id: "financial", label: "Financial" },
  { id: "audit", label: "Audit" },
  { id: "import", label: "Import" },
  { id: "actions", label: "Actions" },
] as const;

function deviceOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 15 * 60 * 1000;
}

function fmtUgx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB");
}

function syncTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "Healthy") return "good";
  if (status === "Failed") return "bad";
  if (status === "Backlogged" || status === "Pending") return "warn";
  return "neutral";
}

export function ShopRescueConsolePage({ lang }: Props) {
  const { shopId } = useParams<{ shopId: string }>();
  const location = useLocation();
  const previewMode = isInternalAdminPreviewActive(location.search);
  const notesRef = useRef<HTMLDivElement>(null);

  const [adminRow, setAdminRow] = useState<WakaInternalAdminRow | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [detail, setDetail] = useState<ShopOpsDetail | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [auditRows, setAuditRows] = useState<OpsAuditRow[]>([]);
  const [recoverySignals, setRecoverySignals] = useState<{
    clearBackOfficePinAt: string | null;
    passwordResetRequestedAt: string | null;
  }>({ clearBackOfficePinAt: null, passwordResetRequestedAt: null });
  const [cloudSnapshot, setCloudSnapshot] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [importText, setImportText] = useState("");
  const [diagnostics, setDiagnostics] = useState<ParsedRescueDiagnostics | null>(null);
  const [auditFilters, setAuditFilters] = useState<RescueAuditFilters>({
    query: "",
    dateFrom: "",
    dateTo: "",
    user: "all",
    category: "all",
    severity: "all",
  });

  const loadShop = useCallback(async () => {
    if (!shopId) return;
    setLoadingShop(true);
    if (previewMode) {
      setDetail(
        shopId === PREVIEW_SHOP_ID || shopId.startsWith("preview-")
          ? PREVIEW_SHOP_OPS_DETAIL
          : {
              ...PREVIEW_SHOP_OPS_DETAIL,
              shop: {
                ...PREVIEW_SHOP_OPS_DETAIL.shop,
                id: shopId,
                name: `${PREVIEW_SHOP_OPS_DETAIL.shop.name} (${shopId})`,
              },
            },
      );
      setLoadingShop(false);
      return;
    }
    const [d, signals, snap] = await Promise.all([
      fetchShopOpsDetail(shopId),
      fetchShopRecoverySignals(shopId),
      fetchShopCloudSnapshotForRescue(shopId),
    ]);
    setDetail(d);
    setRecoverySignals(signals);
    setCloudSnapshot(snap?.snapshot ?? null);
    setLoadingShop(false);
  }, [shopId, previewMode]);

  const loadAudit = useCallback(async () => {
    if (!shopId || previewMode) {
      setAuditRows([]);
      return;
    }
    const rows = await fetchShopAuditTimeline(shopId, 80);
    setAuditRows(rows);
  }, [shopId, previewMode]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const row = await fetchWakaInternalAdminMe();
      if (!cancelled) {
        setAdminRow(row);
        setLoadingAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadShop();
  }, [loadShop]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const perms = adminPermissions(adminRow);
  const canSupport = perms.canShopSupport;
  const shellAdmin = previewMode ? INTERNAL_ADMIN_PREVIEW_ROW : adminRow;

  const healthBundle = useMemo(() => {
    if (!detail) return null;
    return buildRescueHealthSummary(detail, diagnostics);
  }, [detail, diagnostics]);

  const financial = useMemo(() => {
    if (!detail) return null;
    const backupFin = computeCloudBackupFinancial(cloudSnapshot);
    return buildRescueFinancialSnapshot(detail, diagnostics, backupFin);
  }, [detail, diagnostics, cloudSnapshot]);

  const inventory = useMemo(() => {
    if (!detail) return null;
    return inventoryIntegrityFromSources(detail, diagnostics);
  }, [detail, diagnostics]);

  const auditEvents = useMemo(() => {
    const adminEmails = new Map<string, string>();
    if (shellAdmin?.email) adminEmails.set(shellAdmin.id, shellAdmin.email);
    return mapOpsAuditToRescueEvents(auditRows, adminEmails);
  }, [auditRows, shellAdmin]);

  const filteredAudit = useMemo(() => filterRescueAuditEvents(auditEvents, auditFilters), [auditEvents, auditFilters]);

  const pendingFromImport = diagnostics?.pendingQueueTotal ?? null;
  const syncHealth = detail?.sync_health;

  const runAction = async (
    action: Parameters<typeof logRescueSupportAction>[0]["action"],
    fn: () => Promise<{ ok: boolean; message?: string }>,
    reason?: string,
  ) => {
    if (!shopId || !detail) return;
    if (previewMode) {
      setToast({ kind: "err", text: t(lang, "internalAdminPreviewActionBlocked") });
      return;
    }
    setBusy(true);
    setToast(null);
    const result = await fn();
    await logRescueSupportAction({
      shopId,
      action,
      result: result.ok ? "ok" : "failed",
      reason: reason ?? result.message ?? null,
    });
    setBusy(false);
    if (result.ok) {
      setToast({ kind: "ok", text: t(lang, "internalShopProfileDone") });
      await loadShop();
      await loadAudit();
    } else {
      setToast({ kind: "err", text: result.message ?? t(lang, "internalShopProfileError") });
    }
  };

  const copyText = async (text: string, label: string) => {
    if (!shopId) return;
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "ok", text: `${label} copied` });
      if (!previewMode) {
        await logRescueSupportAction({
          shopId,
          action: "rescue_copy_contact",
          result: "ok",
          metadata: { field: label },
        });
      }
    } catch {
      setToast({ kind: "err", text: "Copy failed" });
    }
  };

  const loadImport = (raw: string) => {
    setImportText(raw);
    setDiagnostics(parseRescueDiagnosticsJson(raw));
  };

  const refreshDiagnostics = async () => {
    if (!shopId) return;
    await runAction("rescue_refresh_diagnostics", async () => {
      await loadShop();
      await loadAudit();
      return { ok: true };
    });
  };

  if (!shopId) return <Navigate to="/internal/waka/shops" replace />;

  if (loadingAdmin || loadingShop) {
    return (
      <AdminShell lang={lang} adminRow={shellAdmin} loading={loadingAdmin} active="shop" previewMode={previewMode}>
        <div className="animate-pulse space-y-4">
          <div className="h-10 rounded-xl bg-stone-200" />
          <div className="h-48 rounded-2xl bg-stone-200" />
        </div>
      </AdminShell>
    );
  }

  if (!detail) {
    return (
      <AdminShell lang={lang} adminRow={shellAdmin} loading={false} active="shop" previewMode={previewMode}>
        <p className="text-sm font-semibold text-stone-600">Shop not found.</p>
      </AdminShell>
    );
  }

  const ownerEmail = formatDisplayEmail(detail.owner_email);
  const ownerPhone = detail.shop.phone_e164;
  const waUrl = whatsappUrlFromPhone(ownerPhone);
  const shopNum = formatWakaShopNumber(detail.shop.shop_number);
  const profileHref = internalAdminShopHref(detail.shop.id, previewMode);

  return (
    <AdminShell lang={lang} adminRow={shellAdmin} loading={false} active="shop" previewMode={previewMode}>
      <div className="space-y-4">
        <header className="rounded-2xl border border-waka-200 bg-gradient-to-br from-waka-50 to-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-waka-800">Shop Rescue Console</p>
              <h1 className="mt-1 truncate text-xl font-black text-stone-900">{detail.shop.name}</h1>
              <p className="mt-1 text-xs font-semibold text-stone-600">
                {shopNum ? `#${shopNum}` : detail.shop.id.slice(0, 8)} · {detail.shop.district ?? "—"} ·{" "}
                {formatOwnerDisplayLabel({
                  ownerLabel: detail.owner_label,
                  ownerEmail: detail.owner_email,
                  ownerFullName: detail.owner_full_name,
                })}
              </p>
              {ownerEmail ? (
                <p className="mt-1 font-mono text-xs text-stone-800">{ownerEmail}</p>
              ) : (
                <p className="mt-1 text-xs font-semibold text-amber-800">Owner email redacted or missing</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={profileHref}
                className="min-h-[44px] rounded-xl border border-stone-300 bg-white px-4 text-xs font-black text-stone-800"
              >
                Shop profile
              </Link>
              {healthBundle ? (
                <div
                  className={clsx(
                    "flex min-h-[44px] items-center rounded-xl px-4 text-xs font-black",
                    healthColor(healthBundle.health.level),
                  )}
                >
                  Health {healthBundle.summary.score}
                </div>
              ) : null}
            </div>
          </div>
          <nav className="mt-4 flex gap-1 overflow-x-auto pb-1">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 ring-1 ring-stone-200"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </header>

        {toast ? (
          <p
            className={clsx(
              "rounded-xl px-3 py-2 text-xs font-semibold",
              toast.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900",
            )}
          >
            {toast.text}
          </p>
        ) : null}

        {healthBundle ? (
          <RescueSection id="health" title="Shop Health" summary="Operational summary from cloud diagnostics">
            <div className={adminKpiGridClass()}>
              <RescueMetric label="Health score" value={String(healthBundle.summary.score)} tone="good" />
              <RescueMetric label="Recovery" value={healthBundle.summary.recoveryStatus} />
              <RescueMetric
                label="Sync"
                value={healthBundle.summary.syncStatus}
                tone={syncTone(healthBundle.summary.syncStatus)}
              />
              <RescueMetric label="Cloud" value={healthBundle.summary.cloudStatus} />
              <RescueMetric label="Active devices" value={String(healthBundle.summary.activeDevices)} />
              <RescueMetric label="Plan" value={healthBundle.summary.currentPlan} />
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <RescueRow label="Last successful sync" value={fmtTime(healthBundle.summary.lastSuccessfulSync)} />
              <RescueRow label="Last activity" value={formatLastActive(healthBundle.summary.lastActivity)} />
              <RescueRow label="Trial status" value={healthBundle.summary.trialStatus} />
              <RescueRow label="Shop status" value={detail.shop.is_active ? "Active" : "Suspended"} />
            </dl>
            {healthBundle.summary.riskFlags.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs font-semibold text-amber-900">
                {healthBundle.summary.riskFlags.map((f) => (
                  <li key={f} className="rounded-lg bg-amber-50 px-2 py-1">
                    {f}
                  </li>
                ))}
              </ul>
            ) : null}
          </RescueSection>
        ) : null}

        <RescueSection id="owner" title="Owner Information" summary="Contact and account recovery">
          <dl className="grid gap-2 sm:grid-cols-2">
            <RescueRow label="Owner name" value={detail.owner_full_name ?? detail.owner_label ?? "—"} />
            <RescueRow label="Registered email" value={ownerEmail ?? "—"} />
            <RescueRow label="Phone" value={ownerPhone ?? "—"} />
            <RescueRow label="Organization" value={detail.shop.organization_id.slice(0, 8) + "…"} />
            <RescueRow label="Shop name" value={detail.shop.name} />
            <RescueRow label="Country" value="Uganda" />
            <RescueRow label="District" value={detail.shop.district ?? "—"} />
          </dl>
          {canSupport ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {ownerEmail ? (
                <RescueActionButton variant="secondary" disabled={busy} onClick={() => void copyText(ownerEmail, "Email")}>
                  Copy email
                </RescueActionButton>
              ) : null}
              {ownerPhone ? (
                <RescueActionButton variant="secondary" disabled={busy} onClick={() => void copyText(ownerPhone, "Phone")}>
                  Copy phone
                </RescueActionButton>
              ) : null}
              <RescueActionButton
                disabled={busy || !ownerEmail}
                onClick={() =>
                  void runAction("rescue_password_reset", async () => {
                    const audit = await adminShopSendOwnerPasswordReset(detail.shop.id);
                    if (!audit.ok) return audit;
                    const email = audit.ownerEmail ?? ownerEmail ?? "";
                    if (!email) return { ok: false, message: "No owner email on file." };
                    const sent = await sendOwnerPasswordResetEmail(email);
                    await adminShopLogPasswordResetEmail(
                      detail.shop.id,
                      sent.ok,
                      sent.ok ? `Email sent to ${email}` : sent.message ?? "send_failed",
                    );
                    return sent;
                  })
                }
              >
                Password reset
              </RescueActionButton>
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void runAction("rescue_verification_email", async () => ({
                    ok: false,
                    message:
                      "Ask the owner to sign in and tap Resend verification on the login screen. Auth verification is owner-initiated.",
                  }))
                }
              >
                Send verification email
              </RescueActionButton>
              <RescueActionButton
                variant={detail.shop.is_active ? "danger" : "primary"}
                disabled={busy}
                onClick={() =>
                  void runAction(
                    detail.shop.is_active ? "rescue_suspend_shop" : "rescue_reactivate_shop",
                    () => adminSetShopActive(detail.shop.id, !detail.shop.is_active),
                  )
                }
              >
                {detail.shop.is_active ? "Suspend account" : "Reactivate account"}
              </RescueActionButton>
            </div>
          ) : null}
        </RescueSection>

        <RescueSection id="recovery" title="Cloud Recovery" summary="Read-only recovery state">
          <dl className="grid gap-2">
            <RescueRow
              label="Recovery applicable"
              value={
                diagnostics?.cloudRecovery?.recoveryApplicable != null
                  ? diagnostics.cloudRecovery.recoveryApplicable
                    ? "Yes"
                    : "No"
                  : detail.cloud_snapshot_at
                    ? "Likely (cloud backup exists)"
                    : "Unknown"
              }
            />
            <RescueRow
              label="Bootstrap complete"
              value={
                diagnostics?.cloudTrust?.bootstrapComplete != null
                  ? diagnostics.cloudTrust.bootstrapComplete
                    ? "Yes"
                    : "No"
                  : "—"
              }
            />
            <RescueRow
              label="Recovery lock"
              value={
                diagnostics?.cloudRecovery?.recoveryLockActive != null
                  ? diagnostics.cloudRecovery.recoveryLockActive
                    ? "Active"
                    : "Clear"
                  : diagnostics?.cloudRecovery?.status === "active"
                    ? "Active (session)"
                    : "—"
              }
            />
            <RescueRow
              label="Last recovery"
              value={fmtTime(diagnostics?.cloudRecovery?.lastRecoveryAt ?? recoverySignals.passwordResetRequestedAt)}
            />
            <RescueRow label="Last validation" value={fmtTime(diagnostics?.cloudRecovery?.lastValidationAt ?? null)} />
            <RescueRow label="PIN reset signal" value={fmtTime(recoverySignals.clearBackOfficePinAt)} />
            <RescueRow label="Password reset signal" value={fmtTime(recoverySignals.passwordResetRequestedAt)} />
          </dl>
          {(diagnostics?.cloudRecovery?.warnings.length ?? 0) > 0 ? (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <p className="font-black">Recovery warnings</p>
              <ul className="mt-1 list-disc pl-4">
                {diagnostics!.cloudRecovery!.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(diagnostics?.cloudRecovery?.failures.length ?? 0) > 0 ? (
            <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-950">
              <p className="font-black">Recovery failures</p>
              <ul className="mt-1 list-disc pl-4">
                {diagnostics!.cloudRecovery!.failures.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs text-stone-500">Import device diagnostics for recovery warnings and failures.</p>
          )}
        </RescueSection>

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
            <RescueRow label="Last push" value={fmtTime(syncHealth?.last_push_ok_at ?? diagnostics?.syncHealth?.lastPushOkAt)} />
            <RescueRow label="Last pull" value={fmtTime(syncHealth?.last_pull_at ?? diagnostics?.syncHealth?.lastPullAt)} />
            <RescueRow
              label="Pending uploads"
              value={String(diagnostics?.syncHealth?.pendingUploads ?? pendingFromImport ?? syncHealth?.pending_outbound ?? 0)}
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
          {diagnostics?.pilot && Object.keys(diagnostics.pilot.pendingBreakdown).length > 0 ? (
            <div className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs">
              <p className="font-black text-stone-700">Imported queue breakdown</p>
              <ul className="mt-1 font-mono text-stone-600">
                {Object.entries(diagnostics.pilot.pendingBreakdown).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {canSupport ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <RescueActionButton
                disabled={busy}
                onClick={() => void runAction("rescue_reset_sync", () => adminShopResetSync(detail.shop.id))}
              >
                Reset sync
              </RescueActionButton>
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction("rescue_retry_sync", () => adminShopResetSync(detail.shop.id))}
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
              <RescueMetric label="Integrity status" value={inventory.status} tone={inventory.mismatchCount ? "warn" : "good"} />
              <RescueMetric label="Mismatch count" value={String(inventory.mismatchCount)} tone={inventory.mismatchCount ? "bad" : "good"} />
            </RescueMetricGrid>
            {inventory.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs font-semibold text-amber-900">
                {inventory.warnings.map((w) => (
                  <li key={w} className="rounded-lg bg-amber-50 px-2 py-1">
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
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
              <p className="mt-3 text-xs text-stone-500">No mismatches in imported diagnostics. Table vs snapshot: {detail.product_count_table ?? "—"} / {detail.product_count_snapshot ?? "—"}</p>
            )}
          </RescueSection>
        ) : null}

        <RescueSection id="devices" title="Device Management" summary={`${detail.devices.length} registered devices`}>
          {detail.devices.length === 0 ? (
            <p className="text-sm font-semibold text-stone-500">No devices registered.</p>
          ) : (
            <ul className="space-y-3">
              {detail.devices.map((d) => (
                <DeviceCard
                  key={d.id}
                  device={d}
                  busy={busy}
                  canSupport={canSupport}
                  onForceLogout={() =>
                    void runAction("rescue_force_logout", () => adminShopForceLogoutDevices(detail.shop.id))
                  }
                  onRevokeTrust={() =>
                    void runAction("rescue_revoke_device_trust", () => adminShopDeviceSetTrusted(d.id, false))
                  }
                  onResetSync={() =>
                    void runAction("rescue_device_reset_sync", () => adminShopResetSync(detail.shop.id))
                  }
                  onRefresh={() => void refreshDiagnostics()}
                />
              ))}
            </ul>
          )}
        </RescueSection>

        {financial ? (
          <RescueSection id="financial" title="Financial Snapshot" summary={`Source: ${financial.source.replace("_", " ")} · read-only`}>
            <div className={clsx(adminKpiGridClass(), "mt-1")}>
              {(
                [
                  ["Revenue", financial.revenueUgx],
                  ["Expenses", financial.expensesUgx],
                  ["Profit", financial.profitUgx],
                  ["Customer debt", financial.customerDebtUgx],
                  ["Supplier balance", financial.supplierBalanceUgx],
                  ["Cash position", financial.cashPositionUgx],
                ] as const
              ).map(([label, val]) => (
                <div key={label} className="rounded-xl bg-stone-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase text-stone-500">{label}</p>
                  <p className={clsx("mt-0.5 text-sm font-black text-stone-900", KPI_VALUE_CLASS)}>{fmtUgx(val)}</p>
                </div>
              ))}
            </div>
            {financial.note ? <p className="mt-2 text-xs text-stone-500">{financial.note}</p> : null}
          </RescueSection>
        ) : null}

        <RescueSection id="audit" title="Audit Timeline" summary="Searchable support and admin actions">
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              type="search"
              placeholder="Search events…"
              value={auditFilters.query}
              onChange={(e) => setAuditFilters((f) => ({ ...f, query: e.target.value }))}
              className="min-h-[44px] rounded-xl border border-stone-200 px-3 text-sm"
            />
            <input
              type="date"
              value={auditFilters.dateFrom}
              onChange={(e) => setAuditFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="min-h-[44px] rounded-xl border border-stone-200 px-3 text-sm"
            />
            <input
              type="date"
              value={auditFilters.dateTo}
              onChange={(e) => setAuditFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="min-h-[44px] rounded-xl border border-stone-200 px-3 text-sm"
            />
            <select
              value={auditFilters.category}
              onChange={(e) => setAuditFilters((f) => ({ ...f, category: e.target.value }))}
              className="min-h-[44px] rounded-xl border border-stone-200 px-3 text-sm"
            >
              <option value="all">All categories</option>
              {["account", "sync", "billing", "support", "shop", "admin"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={auditFilters.severity}
              onChange={(e) => setAuditFilters((f) => ({ ...f, severity: e.target.value }))}
              className="min-h-[44px] rounded-xl border border-stone-200 px-3 text-sm"
            >
              <option value="all">All severity</option>
              {["info", "warning", "critical"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {filteredAudit.length === 0 ? (
            <p className="text-sm font-semibold text-stone-500">No audit events match filters.</p>
          ) : (
            <ResponsiveDataTable minWidthPx={640}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((e) => (
                  <tr key={e.id}>
                    <td>{fmtTime(e.at)}</td>
                    <td>{e.user}</td>
                    <td>{e.category}</td>
                    <td>{e.severity}</td>
                    <td className="max-w-[240px] truncate" title={e.summary}>
                      {e.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveDataTable>
          )}
          <RescueActionButton
            variant="secondary"
            disabled={!healthBundle}
            onClick={() => {
              if (!healthBundle) return;
              const blob = exportRescueSupportLogs({
                shopId: detail.shop.id,
                shopName: detail.shop.name,
                events: filteredAudit,
                health: healthBundle.summary,
                diagnostics,
              });
              const url = URL.createObjectURL(new Blob([blob], { type: "application/json" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `waka-rescue-${detail.shop.id.slice(0, 8)}-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export support logs
          </RescueActionButton>
        </RescueSection>

        <RescueSection id="import" title="Diagnostics Import" summary="Cloud Trust, Production Certification, Startup, Sync Health">
          <textarea
            value={importText}
            onChange={(e) => loadImport(e.target.value)}
            rows={5}
            placeholder='Paste owner JSON export (pilot, cloud trust, production certification, startup, recovery, sync health…)'
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

        <RescueSection id="actions" title="Support Actions" summary="Non-destructive recovery tools">
          {canSupport ? (
            <div className="flex flex-wrap gap-2">
              <RescueActionButton
                disabled={busy || !ownerEmail}
                onClick={() =>
                  void runAction("rescue_password_reset", async () => {
                    const audit = await adminShopSendOwnerPasswordReset(detail.shop.id);
                    if (!audit.ok) return audit;
                    const email = audit.ownerEmail ?? ownerEmail ?? "";
                    const sent = await sendOwnerPasswordResetEmail(email);
                    await adminShopLogPasswordResetEmail(detail.shop.id, sent.ok, sent.message ?? undefined);
                    return sent;
                  })
                }
              >
                Password reset
              </RescueActionButton>
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction("rescue_pin_reset", () => adminShopResetBackOfficePin(detail.shop.id))}
              >
                PIN reset
              </RescueActionButton>
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction("rescue_force_logout", () => adminShopForceLogoutDevices(detail.shop.id))}
              >
                Force logout
              </RescueActionButton>
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() => void runAction("rescue_retry_sync", () => adminShopResetSync(detail.shop.id))}
              >
                Retry sync
              </RescueActionButton>
              <RescueActionButton variant="secondary" disabled={busy} onClick={() => void refreshDiagnostics()}>
                Refresh diagnostics
              </RescueActionButton>
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  notesRef.current?.scrollIntoView({ behavior: "smooth" });
                  void logRescueSupportAction({
                    shopId: detail.shop.id,
                    action: "rescue_open_support_notes",
                    result: "ok",
                  });
                }}
              >
                Open support notes
              </RescueActionButton>
              {waUrl ? (
                <RescueActionButton
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    window.open(waUrl, "_blank", "noopener,noreferrer");
                    void logRescueSupportAction({
                      shopId: detail.shop.id,
                      action: "rescue_whatsapp_contact",
                      result: "ok",
                    });
                  }}
                >
                  WhatsApp shortcut
                </RescueActionButton>
              ) : null}
            </div>
          ) : (
            <p className="text-sm font-semibold text-stone-500">Support actions require shop support permission.</p>
          )}
          <div ref={notesRef} className="mt-4">
            <InternalNotesPanel
              shopId={detail.shop.id}
              author={shellAdmin?.full_name ?? shellAdmin?.email ?? "Staff"}
            />
          </div>
        </RescueSection>
      </div>
    </AdminShell>
  );
}

function DeviceCard({
  device,
  busy,
  canSupport,
  onForceLogout,
  onRevokeTrust,
  onResetSync,
  onRefresh,
}: {
  device: ShopDeviceRow;
  busy: boolean;
  canSupport: boolean;
  onForceLogout: () => void;
  onRevokeTrust: () => void;
  onResetSync: () => void;
  onRefresh: () => void;
}) {
  const online = deviceOnline(device.last_seen_at);
  return (
    <li className="rounded-xl border border-stone-100 bg-stone-50/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-stone-900">{device.label || device.device_fingerprint.slice(0, 18)}</p>
          <p className="text-[10px] font-semibold text-stone-500">
            Model: {device.label ?? "—"} · {device.platform ?? "—"} · v{device.app_version ?? "—"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-black uppercase">
            <span className={online ? "rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-900" : "rounded-md bg-stone-200 px-1.5 py-0.5"}>
              {online ? "Online" : "Offline"}
            </span>
            <span className="rounded-md bg-stone-200 px-1.5 py-0.5">{device.trusted ? "Trusted" : "Untrusted"}</span>
            {device.suspicious_flag ? (
              <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-rose-900">Suspicious</span>
            ) : null}
          </div>
          <p className="mt-1 text-[10px] text-stone-600">Last online: {fmtTime(device.last_seen_at)}</p>
        </div>
        {canSupport ? (
          <div className="flex flex-wrap gap-1">
            <RescueActionButton variant="secondary" disabled={busy} onClick={onForceLogout}>
              Force logout
            </RescueActionButton>
            {device.trusted ? (
              <RescueActionButton variant="secondary" disabled={busy} onClick={onRevokeTrust}>
                Revoke trust
              </RescueActionButton>
            ) : null}
            <RescueActionButton variant="secondary" disabled={busy} onClick={onResetSync}>
              Reset sync
            </RescueActionButton>
            <RescueActionButton variant="secondary" disabled={busy} onClick={onRefresh}>
              Refresh
            </RescueActionButton>
          </div>
        ) : null}
      </div>
    </li>
  );
}
