import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Battery, MonitorSmartphone, Plus, Star, Wifi, WifiOff } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { EnterpriseSkeletonList } from "../components/enterprise/EnterpriseSkeleton";
import { ManagedByPrimaryDevice } from "../components/device/ManagedByPrimaryDevice";
import { useSubscription } from "../context/SubscriptionContext";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";
import { useSensitiveActionAuth } from "../context/SensitiveActionAuthContext";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import type { SubscriptionSnapshot } from "../lib/subscriptionEntitlements";
import {
  buildDeviceUsageSummary,
  currentDeviceFingerprint,
  dismissPendingOwnerShopDevice,
  disconnectOwnerShopDevice,
  fetchShopDevicesForManagement,
  parsePlanDeviceLimit,
  partitionShopDevices,
  recordDevicesPageViewed,
  removeOwnerShopDevice,
  type ShopDeviceRow,
} from "../lib/shopDevices";
import { registerShopDeviceOnLogin } from "../lib/deviceActivation";
import { ENFORCE_PRIMARY_DEVICE } from "../lib/deviceAuthorityPolicy";
import {
  formatPendingApprovalCountdown,
  isPendingApprovalExpired,
  pendingApprovalRemainingMs,
} from "../lib/devicePendingApproval";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
  formatLastActiveRelative,
} from "../lib/devicePresenceFormat";
import { setDeviceApprovalStatus, transferPrimaryDevice } from "../lib/deviceAuthority";

type Props = { lang: Language };

function formatPlanDisplayName(snapshot: SubscriptionSnapshot): string {
  if (snapshot.kind !== "remote") return "—";
  const code = snapshot.row.plan_code?.trim();
  if (!code) return "—";
  return code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");
}

function authorityLabel(lang: Language, device: ShopDeviceRow): string {
  if (!ENFORCE_PRIMARY_DEVICE) return formatDevicePlatformLabel(device.platform) || "Device";
  if (device.device_authority === "primary") return t(lang, "deviceMgmtPrimaryBadge");
  return t(lang, "deviceMgmtSecondaryBadge");
}

function approvalBadge(lang: Language, status: ShopDeviceRow["approval_status"]): string {
  if (status === "pending") return t(lang, "deviceMgmtStatusPending");
  if (status === "suspended") return t(lang, "deviceMgmtStatusSuspended");
  if (status === "revoked" || status === "disabled") return t(lang, "deviceMgmtStatusRevoked");
  return t(lang, "deviceMgmtStatusApproved");
}

function lastActiveText(lang: Language, iso: string | null, nowMs: number): string {
  const rel = formatLastActiveRelative(iso, nowMs);
  if (rel.key === "never") return t(lang, "connectedDevicesLastActiveNever");
  if (rel.key === "just_now") return t(lang, "connectedDevicesLastActiveJustNow");
  return iso ? new Date(iso).toLocaleString() : "—";
}

type DeviceCardProps = {
  lang: Language;
  device: ShopDeviceRow;
  currentFp: string;
  nowMs: number;
  isPrimary: boolean;
  isShopOwner: boolean;
  busy: boolean;
  transferTarget: string | null;
  onApprove: (device: ShopDeviceRow) => void;
  onReject: (device: ShopDeviceRow) => void;
  onDismiss: (device: ShopDeviceRow) => void;
  onTransferPrimary: (device: ShopDeviceRow) => void;
  onDisconnect: (device: ShopDeviceRow) => void;
  onRemove: (device: ShopDeviceRow) => void;
  showLifecycleActions: boolean;
};

function DeviceCard({
  lang,
  device,
  currentFp,
  nowMs,
  isPrimary,
  isShopOwner,
  busy,
  transferTarget,
  onApprove,
  onReject,
  onDismiss,
  onTransferPrimary,
  onDisconnect,
  onRemove,
  showLifecycleActions,
}: DeviceCardProps) {
  const isCurrent = device.device_fingerprint === currentFp;
  const name = formatDeviceDisplayName(device.label, device.platform);
  const platform = formatDevicePlatformLabel(device.platform);
  const online = device.status === "active" && device.approval_status === "approved";
  const pendingRemainingMs =
    device.approval_status === "pending"
      ? pendingApprovalRemainingMs(device.approval_requested_at, nowMs)
      : 0;
  const pendingExpired =
    device.approval_status === "pending" && isPendingApprovalExpired(device.approval_requested_at, nowMs);

  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        ENFORCE_PRIMARY_DEVICE && device.device_authority === "primary"
          ? "border-amber-300 ring-1 ring-amber-100"
          : "border-stone-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
            ENFORCE_PRIMARY_DEVICE && device.device_authority === "primary"
              ? "bg-amber-100 text-amber-800"
              : "bg-stone-100 text-stone-700"
          }`}
        >
          {ENFORCE_PRIMARY_DEVICE && device.device_authority === "primary" ? (
            <Star className="h-5 w-5" aria-hidden />
          ) : (
            <MonitorSmartphone className="h-5 w-5" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-black text-stone-950">{name}</h2>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700">
              {authorityLabel(lang, device)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                device.approval_status === "approved"
                  ? "bg-emerald-100 text-emerald-800"
                  : device.approval_status === "pending"
                    ? pendingExpired
                      ? "bg-stone-200 text-stone-700"
                      : "bg-amber-100 text-amber-900"
                    : "bg-red-100 text-red-800"
              }`}
            >
              {device.approval_status === "pending" && pendingExpired
                ? t(lang, "deviceMgmtStatusExpired")
                : approvalBadge(lang, device.approval_status)}
            </span>
            {device.approval_status === "pending" && !pendingExpired ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-900">
                {tTemplate(lang, "deviceMgmtPendingCountdown", {
                  time: formatPendingApprovalCountdown(pendingRemainingMs),
                })}
              </span>
            ) : null}
            {isCurrent ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
                {t(lang, "connectedDevicesCurrentBadge")}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm font-medium text-stone-600">{platform}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-stone-500">
            <span className="inline-flex items-center gap-1">
              {online ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? t(lang, "deviceMgmtOnline") : t(lang, "deviceMgmtOffline")}
            </span>
            <span>
              {t(lang, "deviceMgmtLastSync")}:{" "}
              {device.last_sync_at ? new Date(device.last_sync_at).toLocaleString() : "—"}
            </span>
            <span>
              {t(lang, "connectedDevicesLastActivePrefix")}: {lastActiveText(lang, device.last_seen_at, nowMs)}
            </span>
            {device.app_version ? (
              <span>
                {t(lang, "deviceMgmtVersion")}: {device.app_version}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Battery className="h-3.5 w-3.5" aria-hidden />
              {t(lang, "deviceMgmtHealthy")}
            </span>
          </div>
          {(device.pending_uploads ?? 0) > 0 || (device.pending_downloads ?? 0) > 0 ? (
            <p className="mt-1 text-xs font-medium text-stone-500">
              {t(lang, "deviceMgmtSyncQueue")}: ↑{device.pending_uploads ?? 0} ↓{device.pending_downloads ?? 0}
            </p>
          ) : null}
        </div>
      </div>

      {isShopOwner && device.approval_status === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || pendingExpired}
            onClick={() => onApprove(device)}
            className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? t(lang, "deviceMgmtApproving") : t(lang, "deviceMgmtApprove")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDismiss(device)}
            className="min-h-[44px] flex-1 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
          >
            {busy ? t(lang, "deviceMgmtDeleting") : t(lang, "deviceMgmtDeletePending")}
          </button>
        </div>
      ) : null}

      {isPrimary && device.approval_status === "pending" && !isShopOwner ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || pendingExpired}
            onClick={() => onApprove(device)}
            className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? t(lang, "deviceMgmtApproving") : t(lang, "deviceMgmtApprove")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReject(device)}
            className="min-h-[44px] flex-1 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
          >
            {t(lang, "deviceMgmtReject")}
          </button>
        </div>
      ) : null}

      {showLifecycleActions &&
      (ENFORCE_PRIMARY_DEVICE ? isPrimary : isShopOwner) &&
      device.approval_status === "approved" ? (
        <div className="mt-4 flex flex-col gap-2">
          {ENFORCE_PRIMARY_DEVICE && device.device_authority !== "primary" && !isCurrent ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onTransferPrimary(device)}
              className="min-h-[44px] w-full rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-950 disabled:opacity-50"
            >
              {transferTarget === device.id && busy
                ? t(lang, "deviceMgmtTransferring")
                : t(lang, "deviceMgmtMakePrimary")}
            </button>
          ) : null}
          {!isCurrent && (ENFORCE_PRIMARY_DEVICE ? device.device_authority !== "primary" : true) ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDisconnect(device)}
                className="min-h-[44px] w-full rounded-xl border border-stone-300 bg-stone-50 px-4 text-sm font-bold text-stone-800 disabled:opacity-50"
              >
                {busy ? t(lang, "deviceMgmtDisconnecting") : t(lang, "deviceMgmtDisconnect")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRemove(device)}
                className="min-h-[44px] w-full rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
              >
                {busy ? t(lang, "deviceMgmtRemoving") : t(lang, "deviceMgmtRemove")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function DeviceManagementPage({ lang }: Props) {
  const { userId, snapshot, authMode } = useSubscription();
  const { isPrimary, canPrimary, refresh: refreshAuthority } = useDeviceAuthority();
  const { ensureAuthorized } = useSensitiveActionAuth();
  const [shopId, setShopId] = useState<string | null>(null);
  const [devices, setDevices] = useState<ShopDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isShopOwner, setIsShopOwner] = useState(true);

  const currentFp = useMemo(() => currentDeviceFingerprint(), []);
  const planLimit = useMemo(() => parsePlanDeviceLimit(snapshot, authMode), [snapshot, authMode]);
  const usage = useMemo(() => buildDeviceUsageSummary(devices, planLimit), [devices, planLimit]);
  const { activeDevices, pendingDevices } = useMemo(() => partitionShopDevices(devices), [devices]);
  const planName = useMemo(() => formatPlanDisplayName(snapshot), [snapshot]);
  const remaining =
    usage.planLimit != null && usage.planLimit > 0
      ? Math.max(0, usage.planLimit - usage.activeCount)
      : null;

  const loadDevices = useCallback(async (sid: string) => {
    setError(null);
    const { devices: rows, isOwner } = await fetchShopDevicesForManagement(sid);
    setIsShopOwner(isOwner);
    setDevices(rows);
  }, []);

  useEffect(() => {
    const intervalMs = pendingDevices.length > 0 ? 1_000 : 60_000;
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [pendingDevices.length]);

  useEffect(() => {
    if (!shopId || pendingDevices.length === 0) return;
    const expired = pendingDevices.some((device) =>
      isPendingApprovalExpired(device.approval_requested_at, nowMs),
    );
    if (!expired) return;
    void loadDevices(shopId);
  }, [shopId, pendingDevices, nowMs, loadDevices]);

  useEffect(() => {
    if (!userId || authMode === "local") {
      setShopId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const org = await resolvePrimaryOrganizationForUser(userId);
        if (cancelled) return;
        const sid = org?.shopId ?? null;
        setShopId(sid);
        if (!sid) {
          setDevices([]);
          return;
        }
        await registerShopDeviceOnLogin(sid).catch(() => undefined);
        await recordDevicesPageViewed(sid);
        await loadDevices(sid);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t(lang, "connectedDevicesLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, authMode, lang, loadDevices]);

  const handleApprove = async (device: ShopDeviceRow) => {
    if (!shopId || !isShopOwner) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    setBusyId(device.id);
    try {
      const result = await setDeviceApprovalStatus(shopId, device.id, "approved");
      if (result.limitBlocked) {
        setError(t(lang, "deviceMgmtLimitBlockedApprove"));
        return;
      }
      if (result.error === "approval_expired") {
        setError(t(lang, "deviceMgmtApprovalExpired"));
        await loadDevices(shopId);
        return;
      }
      if (!result.ok) {
        setError(result.error ?? t(lang, "deviceMgmtApproveError"));
        return;
      }
      await loadDevices(shopId);
      await refreshAuthority();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceMgmtApproveError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (device: ShopDeviceRow) => {
    if (!shopId || !isShopOwner) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    const name = formatDeviceDisplayName(device.label, device.platform);
    if (!window.confirm(tTemplate(lang, "deviceMgmtDeletePendingConfirm", { name }))) return;
    setBusyId(device.id);
    try {
      await dismissPendingOwnerShopDevice(device.id, shopId);
      await loadDevices(shopId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceMgmtDeletePendingError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (device: ShopDeviceRow) => {
    if (!shopId) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    if (
      !window.confirm(
        tTemplate(lang, "deviceMgmtRejectConfirm", { name: formatDeviceDisplayName(device.label, device.platform) }),
      )
    ) {
      return;
    }
    setBusyId(device.id);
    try {
      if (device.approval_status === "pending") {
        await dismissPendingOwnerShopDevice(device.id, shopId);
      } else {
        await setDeviceApprovalStatus(shopId, device.id, "revoked");
      }
      await loadDevices(shopId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceMgmtRejectError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleTransferPrimary = async (device: ShopDeviceRow) => {
    if (!shopId || !canPrimary("primary_transfer")) return;
    const ok = await ensureAuthorized("change_settings");
    if (!ok) return;
    setTransferTarget(device.id);
    setBusyId(device.id);
    try {
      const result = await transferPrimaryDevice(shopId, device.device_fingerprint);
      if (!result.ok) {
        setError(result.error ?? t(lang, "deviceMgmtTransferError"));
        return;
      }
      await loadDevices(shopId);
      await refreshAuthority();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceMgmtTransferError"));
    } finally {
      setBusyId(null);
      setTransferTarget(null);
    }
  };

  const handleDisconnect = async (device: ShopDeviceRow) => {
    if (!shopId) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    const name = formatDeviceDisplayName(device.label, device.platform);
    if (!window.confirm(tTemplate(lang, "connectedDevicesDisconnectConfirm", { name }))) return;
    setBusyId(device.id);
    try {
      await disconnectOwnerShopDevice(device.id, shopId);
      await loadDevices(shopId);
      await refreshAuthority();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "connectedDevicesDisconnectError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (device: ShopDeviceRow) => {
    if (!shopId) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    const name = formatDeviceDisplayName(device.label, device.platform);
    if (!window.confirm(tTemplate(lang, "deviceMgmtRemoveConfirm", { name }))) return;
    setBusyId(device.id);
    try {
      await removeOwnerShopDevice(device.id, shopId);
      await loadDevices(shopId);
      await refreshAuthority();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceMgmtRemoveError"));
    } finally {
      setBusyId(null);
    }
  };

  if (authMode === "local") {
    return <Navigate to="/settings" replace />;
  }

  const usageLine =
    usage.planLimit != null && usage.planLimit > 0
      ? tTemplate(lang, "deviceMgmtDevicesUsed", {
          used: String(usage.activeCount),
          limit: String(usage.planLimit),
        })
      : tTemplate(lang, "connectedDevicesUsageNoLimit", { used: String(usage.activeCount) });

  const cardProps = {
    lang,
    currentFp,
    nowMs,
    isPrimary,
    isShopOwner,
    transferTarget,
    onApprove: (d: ShopDeviceRow) => void handleApprove(d),
    onReject: (d: ShopDeviceRow) => void handleReject(d),
    onDismiss: (d: ShopDeviceRow) => void handleDismiss(d),
    onTransferPrimary: (d: ShopDeviceRow) => void handleTransferPrimary(d),
    onDisconnect: (d: ShopDeviceRow) => void handleDisconnect(d),
    onRemove: (d: ShopDeviceRow) => void handleRemove(d),
  };

  return (
    <EnterprisePageContainer className="space-y-6">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "deviceMgmtEnterpriseTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "deviceMgmtSub")}</p>
      </div>

      {!isPrimary ? <ManagedByPrimaryDevice lang={lang} /> : null}

      {!isShopOwner ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
          {t(lang, "deviceMgmtOwnerAccountRequired")}
        </div>
      ) : null}

      {isShopOwner && (!ENFORCE_PRIMARY_DEVICE || isPrimary) && devices.length === 0 && !loading ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-950">
          {t(lang, "deviceMgmtRegisterPrimaryHint")}
        </div>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-500">{t(lang, "deviceLimitPackageLabel")}</p>
        <p className="mt-1 text-lg font-black text-stone-950">{planName}</p>
        <p className="mt-3 text-base font-black text-stone-900">{usageLine}</p>
        {usage.planLimit != null && usage.planLimit > 0 ? (
          <div className="mt-2 flex flex-wrap gap-4 text-sm font-semibold text-stone-600">
            <span>
              {t(lang, "deviceMgmtMaximum")}: {usage.planLimit}
            </span>
            <span>
              {t(lang, "deviceMgmtRemaining")}: {remaining ?? 0}
            </span>
          </div>
        ) : null}
        {usage.atPlanLimit ? (
          <span className="mt-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
            {t(lang, "connectedDevicesAtLimitBadge")}
          </span>
        ) : null}
      </section>

      <section className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-4">
        <div className="flex items-start gap-3">
          <Plus className="mt-0.5 h-5 w-5 shrink-0 text-stone-600" aria-hidden />
          <div>
            <p className="text-sm font-bold text-stone-800">{t(lang, "deviceMgmtRegisterDevice")}</p>
            <p className="mt-1 text-xs font-medium text-stone-500">{t(lang, "deviceMgmtRegisterHint")}</p>
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <EnterpriseSkeletonList count={3} />
      ) : !shopId ? (
        <EnterpriseEmptyState
          icon={MonitorSmartphone}
          title={t(lang, "connectedDevicesNoShop")}
          description={t(lang, "deviceMgmtSub")}
        />
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-stone-500">{t(lang, "deviceMgmtActiveHeading")}</h2>
            {activeDevices.length === 0 ? (
              <EnterpriseEmptyState
                icon={MonitorSmartphone}
                title={t(lang, "deviceMgmtNoActiveDevices")}
                description={t(lang, "deviceMgmtRegisterHint")}
                className="mt-3"
              />
            ) : (
              <ul className="mt-3 space-y-4">
                {activeDevices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    {...cardProps}
                    device={device}
                    busy={busyId === device.id}
                    showLifecycleActions
                  />
                ))}
              </ul>
            )}
          </div>

          {pendingDevices.length > 0 ? (
            <div>
              <h2 className="text-xs font-black uppercase tracking-wider text-stone-500">
                {t(lang, "deviceMgmtPendingHeading")}
              </h2>
              <ul className="mt-3 space-y-4">
                {pendingDevices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    {...cardProps}
                    device={device}
                    busy={busyId === device.id}
                    showLifecycleActions={false}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {usage.atPlanLimit ? (
        <Link
          to="/upgrade"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-amber-600 px-4 text-sm font-bold text-white"
        >
          {t(lang, "connectedDevicesUpgradeCta")}
        </Link>
      ) : null}
    </EnterprisePageContainer>
  );
}
