import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { MonitorSmartphone } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useSubscription } from "../context/SubscriptionContext";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import {
  buildDeviceUsageSummary,
  currentDeviceFingerprint,
  disconnectOwnerShopDevice,
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
import type { ShopDeviceStatus } from "../lib/shopDevices";

type Props = { lang: Language };

function statusBadgeLabel(lang: Language, status: ShopDeviceStatus): string {
  if (status === "disconnected") return t(lang, "connectedDevicesStatusDisconnected");
  if (status === "revoked") return t(lang, "connectedDevicesStatusRevoked");
  return t(lang, "connectedDevicesStatusActive");
}

function statusBadgeClass(status: ShopDeviceStatus): string {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "revoked") return "bg-red-100 text-red-800";
  return "bg-stone-200 text-stone-700";
}

function lastActiveLabel(lang: Language, iso: string | null, nowMs: number): string {
  const rel = formatLastActiveRelative(iso, nowMs);
  if (rel.key === "never") return t(lang, "connectedDevicesLastActiveNever");
  if (rel.key === "just_now") return t(lang, "connectedDevicesLastActiveJustNow");
  if (rel.key === "yesterday") return t(lang, "connectedDevicesLastActiveYesterday");
  if (rel.key === "mins") {
    return tTemplate(lang, "connectedDevicesLastActiveMins", { count: String(rel.count ?? 1) });
  }
  if (rel.key === "hours") {
    return tTemplate(lang, "connectedDevicesLastActiveHours", { count: String(rel.count ?? 1) });
  }
  return tTemplate(lang, "connectedDevicesLastActiveDays", { count: String(rel.count ?? 1) });
}

export function ConnectedDevicesPage({ lang }: Props) {
  const { userId, snapshot, authMode } = useSubscription();
  const [shopId, setShopId] = useState<string | null>(null);
  const [devices, setDevices] = useState<ShopDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
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

  const usageLine = useMemo(() => {
    if (usage.planLimit != null && usage.planLimit > 0) {
      return tTemplate(lang, "connectedDevicesUsageWithLimit", {
        used: String(usage.activeCount),
        limit: String(usage.planLimit),
      });
    }
    return tTemplate(lang, "connectedDevicesUsageNoLimit", { used: String(usage.activeCount) });
  }, [lang, usage]);

  const handleDisconnect = async (device: ShopDeviceRow) => {
    if (!shopId || disconnectingId) return;
    const name = formatDeviceDisplayName(device.label, device.platform);
    const isCurrent = device.device_fingerprint === currentFp;
    const msg = isCurrent
      ? tTemplate(lang, "connectedDevicesDisconnectCurrentConfirm", { name })
      : tTemplate(lang, "connectedDevicesDisconnectConfirm", { name });
    if (!window.confirm(msg)) return;

    setDisconnectingId(device.id);
    setError(null);
    try {
      await disconnectOwnerShopDevice(device.id, shopId);
      await loadDevices(shopId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "connectedDevicesDisconnectError"));
    } finally {
      setDisconnectingId(null);
    }
  };

  if (authMode === "local") {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "connectedDevicesTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "connectedDevicesSub")}</p>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-bold text-stone-800">{usageLine}</p>
          {usage.atPlanLimit && usage.planLimit != null ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
              {t(lang, "connectedDevicesAtLimitBadge")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs font-medium text-stone-500">{t(lang, "connectedDevicesUsageHint")}</p>
        {usage.overPlanLimit && usage.planLimit != null ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900" role="alert">
            {tTemplate(lang, "connectedDevicesOverLimitWarning", {
              used: String(usage.activeCount),
              limit: String(usage.planLimit),
            })}
          </p>
        ) : null}
        {usage.atPlanLimit ? (
          <Link
            to="/upgrade"
            className="mt-3 inline-flex min-h-[40px] items-center rounded-xl bg-amber-600 px-4 text-sm font-bold text-white"
          >
            {t(lang, "connectedDevicesUpgradeCta")}
          </Link>
        ) : null}
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
        <ul className="space-y-3">
          {devices.map((device) => {
            const isCurrent = device.device_fingerprint === currentFp;
            const name = formatDeviceDisplayName(device.label, device.platform);
            const platform = formatDevicePlatformLabel(device.platform);
            const lastActive = lastActiveLabel(lang, device.last_seen_at, nowMs);
            const busy = disconnectingId === device.id;

            return (
              <li
                key={device.id}
                className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
                    <MonitorSmartphone className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-black text-stone-950">{name}</h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadgeClass(device.status)}`}
                      >
                        {statusBadgeLabel(lang, device.status)}
                      </span>
                      {isCurrent ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
                          {t(lang, "connectedDevicesCurrentBadge")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-stone-600">{platform}</p>
                    <p className="mt-1 text-sm font-medium text-stone-500">
                      {t(lang, "connectedDevicesLastActivePrefix")}: {lastActive}
                    </p>
                  </div>
                </div>
                {device.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDisconnect(device)}
                    className="mt-4 min-h-[44px] w-full rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50"
                  >
                    {busy ? t(lang, "connectedDevicesDisconnecting") : t(lang, "connectedDevicesDisconnect")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
