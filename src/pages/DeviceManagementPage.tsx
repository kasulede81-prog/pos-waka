import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { MonitorSmartphone, Plus } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { fetchShopDeviceLimitContext, type DeviceLimitContext } from "../lib/deviceActivation";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { Body, Caption, MonoNumber } from "../components/enterprise/EnterpriseTypography";
import { statusTokens } from "../lib/statusTokens";
import clsx from "clsx";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { EnterpriseSkeletonList } from "../components/enterprise/EnterpriseSkeleton";
import { useSubscription } from "../context/SubscriptionContext";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";
import { useSensitiveActionAuth } from "../context/SensitiveActionAuthContext";
import { useDeviceActivation } from "../context/DeviceActivationContext";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import type { SubscriptionSnapshot } from "../lib/subscriptionEntitlements";
import {
  buildDeviceUsageSummary,
  currentDeviceFingerprint,
  dismissPendingOwnerShopDevice,
  disconnectOwnerShopDevice,
  fetchShopDevicesForManagement,
  filterAssignableFleetDevices,
  isLicensedActiveDevice,
  parsePlanDeviceLimit,
  partitionShopDevices,
  recordDevicesPageViewed,
  type ShopDeviceRow,
} from "../lib/shopDevices";
import { registerShopDeviceOnLogin } from "../lib/deviceActivation";
import { setDeviceApprovalStatus } from "../lib/deviceAuthority";
import { isPendingApprovalExpired } from "../lib/devicePendingApproval";
import { filterFleetDevices, groupFleetDevicesByBucket, type DeviceFleetFilter } from "../lib/deviceFleetCatalog";
import { logDeviceFleetDiagnostic } from "../lib/deviceFleetPresence";
import { readDeviceDisplayAlias } from "../lib/deviceFleetLabels";
import { readSyncCheckpoints } from "../lib/syncCheckpoints";
import { usePosStore } from "../store/usePosStore";
import { DeviceFleetCard } from "../components/device/DeviceFleetCard";
import { DeviceFleetDetailsPanel } from "../components/device/DeviceFleetDetailsPanel";
import { DeviceFleetFilters } from "../components/device/DeviceFleetFilters";

type Props = { lang: Language };

function formatPlanDisplayName(snapshot: SubscriptionSnapshot): string {
  if (snapshot.kind !== "remote") return "—";
  const code = snapshot.row.plan_code?.trim();
  if (!code) return "—";
  return code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");
}

const BUCKET_ORDER = ["current", "approved", "pending", "offline"] as const;

const BUCKET_HEADING: Record<(typeof BUCKET_ORDER)[number], string> = {
  current: "deviceFleetSectionCurrent",
  approved: "deviceFleetSectionApproved",
  pending: "deviceFleetSectionPending",
  offline: "deviceFleetSectionOffline",
};

export function DeviceManagementPage({ lang }: Props) {
  const { userId, snapshot, authMode } = useSubscription();
  const { refresh: refreshAuthority } = useDeviceAuthority();
  const { ensureAuthorized } = useSensitiveActionAuth();
  const { retry: retryActivation } = useDeviceActivation();
  const staffAccounts = usePosStore((s) => s.preferences.staffAccounts ?? []);
  const [shopId, setShopId] = useState<string | null>(null);
  const [devices, setDevices] = useState<ShopDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isShopOwner, setIsShopOwner] = useState(true);
  const [filter, setFilter] = useState<DeviceFleetFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<ShopDeviceRow | null>(null);
  const [aliasVersion, setAliasVersion] = useState(0);
  const [limitContext, setLimitContext] = useState<DeviceLimitContext | null>(null);

  const currentFp = useMemo(() => currentDeviceFingerprint(), []);
  const planLimit = useMemo(() => parsePlanDeviceLimit(snapshot, authMode), [snapshot, authMode]);
  const usage = useMemo(() => {
    const base = buildDeviceUsageSummary(devices, planLimit);
    if (limitContext && base.activeCount === 0 && limitContext.active_count > 0) {
      return {
        ...base,
        activeCount: limitContext.active_count,
        atPlanLimit: limitContext.at_limit,
        overPlanLimit: limitContext.device_limit != null && limitContext.active_count > limitContext.device_limit,
      };
    }
    return base;
  }, [devices, planLimit, limitContext]);
  const { pendingDevices } = useMemo(() => partitionShopDevices(devices), [devices]);
  const planName = useMemo(() => formatPlanDisplayName(snapshot), [snapshot]);
  const remaining =
    usage.planLimit != null && usage.planLimit > 0
      ? Math.max(0, usage.planLimit - usage.activeCount)
      : null;

  const filteredDevices = useMemo(
    () =>
      filterFleetDevices(devices, {
        filter,
        search,
        currentFingerprint: currentFp,
        nowMs,
      }),
    [devices, filter, search, currentFp, nowMs],
  );

  const grouped = useMemo(
    () => groupFleetDevicesByBucket(filteredDevices, currentFp, nowMs),
    [filteredDevices, currentFp, nowMs],
  );

  const resolveStaffLabel = useCallback(
    (device: ShopDeviceRow): string | null => {
      const staffId = device.current_staff_client_id?.trim();
      if (!staffId) return null;
      const staff = staffAccounts.find((s) => s.id === staffId);
      return staff?.name ?? staffId;
    },
    [staffAccounts],
  );

  const resolveDisplayName = useCallback(
    (device: ShopDeviceRow): string | undefined => {
      if (!shopId) return undefined;
      void aliasVersion;
      return readDeviceDisplayAlias(shopId, device.id) ?? undefined;
    },
    [shopId, aliasVersion],
  );

  const loadDevices = useCallback(async (sid: string) => {
    setError(null);
    try {
      const [{ devices: rows, isOwner }, ctx] = await Promise.all([
        fetchShopDevicesForManagement(sid, { planLimit, currentFingerprint: currentFp }),
        fetchShopDeviceLimitContext(sid).catch(() => null),
      ]);
      setIsShopOwner(isOwner || (ctx?.is_owner ?? false));
      setLimitContext(ctx);
      const assignable = filterAssignableFleetDevices(rows, planLimit ?? ctx?.device_limit ?? null, currentFp);
      setDevices(assignable);
      logDeviceFleetDiagnostic("fleet_loaded", {
        count: assignable.length,
        shopId: sid,
        activeCount: ctx?.active_count ?? assignable.filter((d) => isLicensedActiveDevice(d)).length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "connectedDevicesLoadError"));
    }
  }, [lang, planLimit, currentFp]);

  useEffect(() => {
    const intervalMs = pendingDevices.length > 0 ? 1_000 : 30_000;
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
    if (!shopId) return;
    const intervalMs = pendingDevices.length > 0 ? 5_000 : 30_000;
    const id = window.setInterval(() => {
      void loadDevices(shopId);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [shopId, pendingDevices.length, loadDevices]);

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
        await loadDevices(sid);
        void recordDevicesPageViewed(sid);
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
    if (!window.confirm(tTemplate(lang, "deviceMgmtDeletePendingConfirm", { name: resolveDisplayName(device) ?? device.label ?? device.id }))) {
      return;
    }
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

  const handleDisconnect = async (device: ShopDeviceRow) => {
    if (!shopId) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    const name = resolveDisplayName(device) ?? device.label ?? device.id;
    if (!window.confirm(tTemplate(lang, "connectedDevicesDisconnectConfirm", { name }))) return;
    setBusyId(device.id);
    try {
      await disconnectOwnerShopDevice(device.id, shopId);
      setDevices((prev) => prev.filter((d) => d.id !== device.id));
      await loadDevices(shopId);
      await refreshAuthority();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "connectedDevicesDisconnectError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleCopyId = async (device: ShopDeviceRow) => {
    try {
      await navigator.clipboard.writeText(device.device_fingerprint);
      logDeviceFleetDiagnostic("device_id_copied", { deviceId: device.id });
    } catch {
      setError(t(lang, "deviceFleetCopyFailed"));
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

  const syncCheckpoints = readSyncCheckpoints();
  const currentDevice = devices.find((d) => d.device_fingerprint === currentFp) ?? null;

  const cardProps = {
    lang,
    currentFingerprint: currentFp,
    nowMs,
    isShopOwner,
    onApprove: (d: ShopDeviceRow) => void handleApprove(d),
    onDismiss: (d: ShopDeviceRow) => void handleDismiss(d),
    onDisconnect: (d: ShopDeviceRow) => void handleDisconnect(d),
    onCopyId: (d: ShopDeviceRow) => void handleCopyId(d),
    onRetryActivation: () => void retryActivation(),
    onSelect: setSelectedDevice,
    resolveStaffLabel,
    resolveDisplayName,
  };

  return (
    <EnterprisePageContainer className="space-y-6">
      <EnterprisePageHeader
        lang={lang}
        title={t(lang, "deviceMgmtEnterpriseTitle")}
        subtitle={t(lang, "deviceFleetSub")}
        backFallback="/settings"
        backLabel={t(lang, "settingsHubTitle")}
      />

      {!isShopOwner ? (
        <div className={clsx("rounded-2xl border px-4 py-3", statusTokens.warning.banner, statusTokens.warning.badgeRing)}>
          <Body className="!text-sm text-warning-foreground">{t(lang, "deviceMgmtOwnerAccountRequired")}</Body>
        </div>
      ) : null}

      {currentDevice ? (
        <EnterpriseCard
          title={t(lang, "deviceFleetThisDevice")}
          subtitle={t(lang, "deviceFleetThisDeviceSub")}
          className={clsx(statusTokens.info.banner, statusTokens.info.badgeRing)}
        >
          <dl className="grid gap-1 text-xs font-semibold text-foreground">
            <div className="flex justify-between gap-3">
              <dt>{t(lang, "deviceMgmtVersion")}</dt>
              <dd>{currentDevice.app_version ?? import.meta.env.VITE_APP_VERSION ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t(lang, "deviceMgmtLastSync")}</dt>
              <dd>{syncCheckpoints.lastSalesSyncAt ? new Date(syncCheckpoints.lastSalesSyncAt).toLocaleString() : "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t(lang, "connectedDevicesLastActivePrefix")}</dt>
              <dd>
                {currentDevice.last_seen_at ? new Date(currentDevice.last_seen_at).toLocaleString() : t(lang, "connectedDevicesLastActiveNever")}
              </dd>
            </div>
          </dl>
        </EnterpriseCard>
      ) : null}

      <EnterpriseCard>
        <Caption>{t(lang, "deviceLimitPackageLabel")}</Caption>
        <MonoNumber className="mt-1 text-lg">{planName}</MonoNumber>
        <Body className="mt-3 !font-black">{usageLine}</Body>
        {usage.planLimit != null && usage.planLimit > 0 ? (
          <div className="mt-2 flex flex-wrap gap-4 text-sm font-semibold text-muted-foreground">
            <span>
              {t(lang, "deviceMgmtMaximum")}: {usage.planLimit}
            </span>
            <span>
              {t(lang, "deviceMgmtRemaining")}: {remaining ?? 0}
            </span>
          </div>
        ) : null}
        {usage.atPlanLimit ? (
          <span className={clsx("mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-bold", statusTokens.warning.badge, statusTokens.warning.badgeRing)}>
            {t(lang, "connectedDevicesAtLimitBadge")}
          </span>
        ) : null}
      </EnterpriseCard>

      <section className="rounded-2xl border border-dashed border-border bg-muted p-4">
        <div className="flex items-start gap-3">
          <Plus className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-bold text-foreground">{t(lang, "deviceMgmtRegisterDevice")}</p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "deviceFleetRegisterHint")}</p>
          </div>
        </div>
      </section>

      <DeviceFleetFilters
        lang={lang}
        filter={filter}
        search={search}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
      />

      {error ? (
        <div className="space-y-3">
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">
            {error}
          </p>
          {shopId ? (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void loadDevices(shopId).finally(() => setLoading(false));
              }}
              className="min-h-[44px] rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground"
            >
              {t(lang, "enterpriseRetry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <EnterpriseSkeletonList count={3} />
      ) : !shopId ? (
        <EnterpriseEmptyState
          icon={MonitorSmartphone}
          title={t(lang, "connectedDevicesNoShop")}
          description={t(lang, "deviceFleetSub")}
        />
      ) : error ? null : devices.length === 0 ? (
        <EnterpriseEmptyState
          icon={MonitorSmartphone}
          title={t(lang, "deviceFleetEmptyTitle")}
          description={t(lang, "deviceFleetEmptySub")}
        />
      ) : filteredDevices.length === 0 ? (
        <EnterpriseEmptyState
          icon={MonitorSmartphone}
          title={t(lang, "deviceFleetNoMatchesTitle")}
          description={t(lang, "deviceFleetNoMatchesSub")}
        />
      ) : (
        <div className="space-y-6">
          {BUCKET_ORDER.map((bucket) => {
            const rows = grouped[bucket];
            if (rows.length === 0) return null;
            return (
              <div key={bucket}>
                <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                  {t(lang, BUCKET_HEADING[bucket])} ({rows.length})
                </h2>
                <ul className="mt-3 space-y-4">
                  {rows.map((device) => (
                    <DeviceFleetCard
                      key={device.id}
                      device={device}
                      displayName={resolveDisplayName(device)}
                      staffLabel={resolveStaffLabel(device)}
                      busy={busyId === device.id}
                      {...cardProps}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
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

      <DeviceFleetDetailsPanel
        lang={lang}
        open={Boolean(selectedDevice)}
        device={selectedDevice}
        shopId={shopId}
        displayName={selectedDevice ? resolveDisplayName(selectedDevice) : undefined}
        staffLabel={selectedDevice ? resolveStaffLabel(selectedDevice) : null}
        isCurrent={selectedDevice?.device_fingerprint === currentFp}
        onClose={() => setSelectedDevice(null)}
        onAliasSaved={() => setAliasVersion((v) => v + 1)}
      />
    </EnterprisePageContainer>
  );
}
