import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MonitorSmartphone } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useDeviceActivation } from "../context/DeviceActivationContext";
import {
  ensureShopDeviceActivation,
  fetchShopDeviceLimitContext,
  recordDeviceReplacementCompleted,
  type DeviceLimitContext,
} from "../lib/deviceActivation";
import { disconnectOwnerShopDevice } from "../lib/shopDevices";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
  formatLastActiveRelative,
} from "../lib/devicePresenceFormat";
import { currentDeviceFingerprint } from "../lib/shopDevices";

type Props = { lang: Language; onSignOut?: () => void };

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

function planDisplayName(ctx: DeviceLimitContext | null, fallback?: string): string {
  if (!ctx) return fallback ?? "—";
  const name = ctx.plan_name?.trim();
  if (name && name !== "Unknown") return name;
  const code = ctx.plan_code?.trim();
  if (!code) return fallback ?? "—";
  return code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ");
}

export function DeviceLimitReachedPage({ lang, onSignOut }: Props) {
  const navigate = useNavigate();
  const { block, retry, shopId } = useDeviceActivation();
  const [ctx, setCtx] = useState<DeviceLimitContext | null>(block?.context ?? null);
  const [loading, setLoading] = useState(!block?.context);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const sid = block?.shopId ?? shopId ?? ctx?.shop_id ?? null;
  const isOwner = ctx?.is_owner ?? false;
  const currentFp = useMemo(() => currentDeviceFingerprint(), []);

  const loadContext = useCallback(async () => {
    if (!sid) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchShopDeviceLimitContext(sid);
      setCtx(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "deviceLimitLoadError"));
    } finally {
      setLoading(false);
    }
  }, [sid, lang]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (block?.context) {
      setCtx(block.context);
      setLoading(false);
      return;
    }
    void loadContext();
  }, [block?.context, loadContext]);

  const usageLine = useMemo(() => {
    if (!ctx?.device_limit) {
      return tTemplate(lang, "connectedDevicesUsageNoLimit", { used: String(ctx?.active_count ?? 0) });
    }
    return tTemplate(lang, "connectedDevicesUsageWithLimit", {
      used: String(ctx.active_count),
      limit: String(ctx.device_limit),
    });
  }, [ctx, lang]);

  const handleDisconnect = async (deviceId: string, fingerprint: string) => {
    if (!sid || busyId) return;
    setBusyId(deviceId);
    setError(null);
    try {
      await disconnectOwnerShopDevice(deviceId, sid);
      const result = await ensureShopDeviceActivation(sid);
      if (!result.activated) {
        await loadContext();
        setError(t(lang, "deviceLimitStillFull"));
        return;
      }
      await recordDeviceReplacementCompleted(sid, fingerprint);
      await retry();
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "connectedDevicesDisconnectError"));
    } finally {
      setBusyId(null);
    }
  };

  const activeDevices = (ctx?.devices ?? []).filter((d) => d.status === "active");

  return (
    <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-orange-50 to-stone-50 dark:from-stone-950 dark:to-stone-900">
      <div className="auth-scroll-pane min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              <MonitorSmartphone className="h-7 w-7" aria-hidden />
            </div>
            <h1 className="mt-4 text-2xl font-black text-stone-950 dark:text-stone-50">{t(lang, "deviceLimitTitle")}</h1>
            <p className="mt-2 text-sm font-medium text-stone-600 dark:text-stone-400">{t(lang, "deviceLimitSub")}</p>
          </div>

          <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              {t(lang, "deviceLimitPackageLabel")}
            </p>
            <p className="mt-1 text-lg font-black text-stone-950 dark:text-stone-50">
              {planDisplayName(ctx, block?.result.plan_name)}
            </p>
            <p className="mt-2 text-sm font-bold text-stone-800 dark:text-stone-200">{usageLine}</p>
          </section>

          {!isOwner ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-sm font-bold text-amber-950 dark:text-amber-100">{t(lang, "deviceLimitNonOwnerTitle")}</p>
              <p className="mt-1 text-sm font-medium text-amber-900 dark:text-amber-200/90">
                {t(lang, "deviceLimitNonOwnerBody")}
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="text-sm font-black text-stone-800 dark:text-stone-200">{t(lang, "deviceLimitDevicesHeading")}</h2>
            {loading ? (
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{t(lang, "connectedDevicesLoading")}</p>
            ) : activeDevices.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{t(lang, "connectedDevicesEmpty")}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {activeDevices.map((device) => {
                  const name = formatDeviceDisplayName(device.label, device.platform);
                  const isCurrent = device.device_fingerprint === currentFp;
                  return (
                    <li
                      key={device.id}
                      className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900"
                    >
                      <p className="text-base font-black text-stone-950 dark:text-stone-50">{name}</p>
                      <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
                        {formatDevicePlatformLabel(device.platform)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-stone-500 dark:text-stone-500">
                        {t(lang, "connectedDevicesLastActivePrefix")}: {lastActiveLabel(lang, device.last_seen_at, nowMs)}
                      </p>
                      {isOwner && !isCurrent ? (
                        <button
                          type="button"
                          disabled={busyId === device.id}
                          onClick={() => void handleDisconnect(device.id, device.device_fingerprint)}
                          className="mt-3 min-h-[44px] w-full rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-800 disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                        >
                          {busyId === device.id
                            ? t(lang, "connectedDevicesDisconnecting")
                            : tTemplate(lang, "deviceLimitDisconnectNamed", { name })}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {error ? (
            <p
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <footer className="shrink-0 border-t border-stone-200/80 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
          {isOwner ? (
            <button
              type="button"
              onClick={() => void retry().then(() => navigate("/", { replace: true }))}
              className="min-h-[48px] rounded-xl bg-stone-900 px-4 text-sm font-bold text-white dark:bg-stone-100 dark:text-stone-900"
            >
              {t(lang, "deviceLimitRetryActivation")}
            </button>
          ) : null}
          <Link
            to="/upgrade"
            className="flex min-h-[48px] items-center justify-center rounded-xl bg-amber-600 px-4 text-sm font-bold text-white"
          >
            {t(lang, "connectedDevicesUpgradeCta")}
          </Link>
          <button
            type="button"
            onClick={() => {
              if (onSignOut) onSignOut();
              else navigate("/login", { replace: true });
            }}
            className="min-h-[48px] rounded-xl border border-stone-300 bg-white px-4 text-sm font-bold text-stone-800 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
          >
            {isOwner ? t(lang, "deviceLimitCancel") : t(lang, "deviceLimitClose")}
          </button>
        </div>
      </footer>
    </div>
  );
}
