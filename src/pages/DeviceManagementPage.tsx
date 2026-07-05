import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Battery, MonitorSmartphone, Star, Wifi, WifiOff } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { ManagedByPrimaryDevice } from "../components/device/ManagedByPrimaryDevice";
import { useSubscription } from "../context/SubscriptionContext";
import { useDeviceAuthority } from "../context/DeviceAuthorityContext";
import { useSensitiveActionAuth } from "../context/SensitiveActionAuthContext";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import {
  buildDeviceUsageSummary,
  currentDeviceFingerprint,
  fetchOwnerShopDevices,
  parsePlanDeviceLimit,
  recordDevicesPageViewed,
  type ShopDeviceRow,
} from "../lib/shopDevices";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
  formatLastActiveRelative,
} from "../lib/devicePresenceFormat";
import { setDeviceApprovalStatus, transferPrimaryDevice } from "../lib/deviceAuthority";

type Props = { lang: Language };

function authorityLabel(lang: Language, device: ShopDeviceRow): string {
  if (device.device_authority === "primary") return t(lang, "deviceMgmtPrimaryBadge");
  return t(lang, "deviceMgmtSecondaryBadge");
}

function approvalBadge(lang: Language, status: ShopDeviceRow["approval_status"]): string {
  if (status === "pending") return t(lang, "deviceMgmtStatusPending");
  if (status === "suspended") return t(lang, "deviceMgmtStatusSuspended");
  if (status === "revoked" || status === "disabled") return t(lang, "deviceMgmtStatusRevoked");
  return t(lang, "deviceMgmtStatusApproved");
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

  const currentFp = useMemo(() => currentDeviceFingerprint(), []);
  const planLimit = useMemo(() => parsePlanDeviceLimit(snapshot, authMode), [snapshot, authMode]);
  const usage = useMemo(() => buildDeviceUsageSummary(devices, planLimit), [devices, planLimit]);

  const loadDevices = useCallback(async (sid: string) => {
    setError(null);
    const rows = await fetchOwnerShopDevices(sid);
    setDevices(rows);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
    if (!shopId || !canPrimary("device_approve")) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    setBusyId(device.id);
    try {
      await setDeviceApprovalStatus(shopId, device.id, "approved");
      await loadDevices(shopId);
      await refreshAuthority();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceMgmtApproveError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (device: ShopDeviceRow) => {
    if (!shopId || !canPrimary("device_approve")) return;
    const ok = await ensureAuthorized("manage_users");
    if (!ok) return;
    if (!window.confirm(tTemplate(lang, "deviceMgmtRejectConfirm", { name: formatDeviceDisplayName(device.label, device.platform) }))) {
      return;
    }
    setBusyId(device.id);
    try {
      await setDeviceApprovalStatus(shopId, device.id, "revoked");
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

  if (authMode === "local") {
    return <Navigate to="/settings" replace />;
  }

  const usageLine =
    usage.planLimit != null && usage.planLimit > 0
      ? tTemplate(lang, "connectedDevicesUsageWithLimit", {
          used: String(usage.activeCount),
          limit: String(usage.planLimit),
        })
      : tTemplate(lang, "connectedDevicesUsageNoLimit", { used: String(usage.activeCount) });

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "deviceMgmtTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "deviceMgmtSub")}</p>
      </div>

      {!isPrimary ? <ManagedByPrimaryDevice lang={lang} /> : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-stone-800">{usageLine}</p>
        <p className="mt-1 text-xs font-medium text-stone-500">{t(lang, "deviceMgmtUsageHint")}</p>
      </section>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm font-medium text-stone-500">{t(lang, "connectedDevicesLoading")}</p>
      ) : !shopId ? (
        <p className="text-sm font-medium text-stone-500">{t(lang, "connectedDevicesNoShop")}</p>
      ) : devices.length === 0 ? (
        <p className="text-sm font-medium text-stone-500">{t(lang, "connectedDevicesEmpty")}</p>
      ) : (
        <ul className="space-y-4">
          {devices.map((device) => {
            const isCurrent = device.device_fingerprint === currentFp;
            const name = formatDeviceDisplayName(device.label, device.platform);
            const platform = formatDevicePlatformLabel(device.platform);
            const rel = formatLastActiveRelative(device.last_seen_at, nowMs);
            const online = device.status === "active" && device.approval_status === "approved";
            const busy = busyId === device.id;

            return (
              <li
                key={device.id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${
                  device.device_authority === "primary" ? "border-amber-300 ring-1 ring-amber-100" : "border-stone-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                      device.device_authority === "primary" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {device.device_authority === "primary" ? (
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
                              ? "bg-amber-100 text-amber-900"
                              : "bg-red-100 text-red-800"
                        }`}
                      >
                        {approvalBadge(lang, device.approval_status)}
                      </span>
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
                        {t(lang, "connectedDevicesLastActivePrefix")}:{" "}
                        {rel.key === "never"
                          ? t(lang, "connectedDevicesLastActiveNever")
                          : rel.key === "just_now"
                            ? t(lang, "connectedDevicesLastActiveJustNow")
                            : device.last_seen_at
                              ? new Date(device.last_seen_at).toLocaleString()
                              : "—"}
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
                        {t(lang, "deviceMgmtSyncQueue")}: ↑{device.pending_uploads ?? 0} ↓
                        {device.pending_downloads ?? 0}
                      </p>
                    ) : null}
                  </div>
                </div>

                {isPrimary && device.approval_status === "pending" ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleApprove(device)}
                      className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {busy ? t(lang, "deviceMgmtApproving") : t(lang, "deviceMgmtApprove")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleReject(device)}
                      className="min-h-[44px] flex-1 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
                    >
                      {t(lang, "deviceMgmtReject")}
                    </button>
                  </div>
                ) : null}

                {isPrimary &&
                device.approval_status === "approved" &&
                device.device_authority !== "primary" &&
                !isCurrent ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleTransferPrimary(device)}
                    className="mt-4 min-h-[44px] w-full rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-950 disabled:opacity-50"
                  >
                    {transferTarget === device.id && busy
                      ? t(lang, "deviceMgmtTransferring")
                      : t(lang, "deviceMgmtTransferPrimary")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {usage.atPlanLimit ? (
        <Link
          to="/upgrade"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-amber-600 px-4 text-sm font-bold text-white"
        >
          {t(lang, "connectedDevicesUpgradeCta")}
        </Link>
      ) : null}
    </div>
  );
}
