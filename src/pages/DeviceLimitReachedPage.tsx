import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MonitorSmartphone } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useDeviceActivation } from "../context/DeviceActivationContext";
import {
  fetchShopDeviceLimitContext,
  recordDeviceReplacementCompleted,
  tryActivateCurrentDevice,
  type DeviceLimitContext,
} from "../lib/deviceActivation";
import { currentDeviceFingerprint, disconnectOwnerShopDevice } from "../lib/shopDevices";
import {
  formatDeviceDisplayName,
  formatDevicePlatformLabel,
  formatLastActiveRelative,
} from "../lib/devicePresenceFormat";

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

/** Shown only when the shop plan device limit is genuinely reached. */
export function DeviceLimitReachedPage({ lang, onSignOut }: Props) {
  const navigate = useNavigate();
  const { block, retry, shopId, activated } = useDeviceActivation();
  const [ctx, setCtx] = useState<DeviceLimitContext | null>(block?.context ?? null);
  const [loading, setLoading] = useState(!block?.context);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const redirectedRef = useRef(false);

  const sid = block?.shopId ?? shopId ?? ctx?.shop_id ?? null;
  const isOwner = ctx?.is_owner ?? false;
  const currentFp = useMemo(() => currentDeviceFingerprint(), []);
  const atLimit = ctx?.at_limit ?? block?.kind === "limit";

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

  const finishActivation = useCallback(async () => {
    await retry();
    navigate("/", { replace: true });
  }, [navigate, retry]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (activated) {
      navigate("/", { replace: true });
    }
  }, [activated, navigate]);

  useEffect(() => {
    if (block?.context) {
      setCtx(block.context);
      setLoading(false);
      return;
    }
    void loadContext();
  }, [block?.context, loadContext]);

  useEffect(() => {
    if (redirectedRef.current || loading || !ctx) return;
    if (!atLimit) {
      redirectedRef.current = true;
      navigate("/", { replace: true });
    }
  }, [atLimit, ctx, loading, navigate]);

  const usageLine = useMemo(() => {
    if (!ctx?.device_limit) {
      return tTemplate(lang, "connectedDevicesUsageNoLimit", { used: String(ctx?.active_count ?? 0) });
    }
    return tTemplate(lang, "connectedDevicesUsageWithLimit", {
      used: String(ctx.active_count),
      limit: String(ctx.device_limit),
    });
  }, [ctx, lang]);

  const replaceableDevices = useMemo(
    () =>
      (ctx?.devices ?? []).filter(
        (d) => d.status === "active" && d.approval_status === "approved" && d.device_fingerprint !== currentFp,
      ),
    [ctx?.devices, currentFp],
  );

  useEffect(() => {
    if (selectedId && !replaceableDevices.some((d) => d.id === selectedId)) {
      setSelectedId(null);
    }
  }, [replaceableDevices, selectedId]);

  const handleReplaceSelected = async () => {
    if (!sid || !selectedId || busy) return;
    const device = replaceableDevices.find((d) => d.id === selectedId);
    if (!device) return;

    setBusy(true);
    setError(null);
    try {
      await disconnectOwnerShopDevice(device.id, sid);
      const result = await tryActivateCurrentDevice(sid);
      if (!result.activated) {
        if (result.pending_approval || result.approval_status === "pending") {
          await recordDeviceReplacementCompleted(sid, device.device_fingerprint);
          navigate("/device-pending", { replace: true });
          return;
        }
        if (result.limit_blocked) {
          await loadContext();
          setError(t(lang, "deviceLimitStillFull"));
          return;
        }
        await loadContext();
        setError(t(lang, "deviceLimitActivationFailed"));
        return;
      }
      await recordDeviceReplacementCompleted(sid, device.device_fingerprint);
      await finishActivation();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "connectedDevicesDisconnectError"));
    } finally {
      setBusy(false);
    }
  };

  if (!atLimit && !loading) {
    return null;
  }

  return (
    <div className="auth-scroll-root flex h-dvh max-h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-waka-50 to-muted dark:from-foreground dark:to-foreground">
      <div className="auth-scroll-pane min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
        <div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
              <MonitorSmartphone className="h-7 w-7" aria-hidden />
            </div>
            <h1 className="mt-4 text-2xl font-black text-foreground dark:text-background">{t(lang, "deviceLimitTitle")}</h1>
            <p className="mt-2 text-sm font-medium text-muted-foreground dark:text-muted-foreground">
              {isOwner ? t(lang, "deviceLimitReplacementIntro") : t(lang, "deviceLimitSub")}
            </p>
          </div>

          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:bg-foreground">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
              {t(lang, "deviceLimitPackageLabel")}
            </p>
            <p className="mt-1 text-lg font-black text-foreground dark:text-background">
              {planDisplayName(ctx, block?.result.plan_name)}
            </p>
            <p className="mt-2 text-sm font-bold text-foreground dark:text-muted-foreground">{usageLine}</p>
          </section>

          {!isOwner ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-sm font-bold text-amber-950 dark:text-amber-100">{t(lang, "deviceLimitNonOwnerTitle")}</p>
              <p className="mt-1 text-sm font-medium text-amber-900 dark:text-amber-200/90">
                {t(lang, "deviceLimitNonOwnerBody")}
              </p>
            </section>
          ) : null}

          {isOwner ? (
            <section>
              <h2 className="text-sm font-black text-foreground dark:text-muted-foreground">{t(lang, "deviceLimitDevicesHeading")}</h2>
              {loading ? (
                <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">{t(lang, "connectedDevicesLoading")}</p>
              ) : replaceableDevices.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">{t(lang, "connectedDevicesEmpty")}</p>
              ) : (
                <ul className="mt-3 space-y-3" role="radiogroup" aria-label={t(lang, "deviceLimitDevicesHeading")}>
                  {replaceableDevices.map((device) => {
                    const name = formatDeviceDisplayName(device.label, device.platform);
                    const selected = selectedId === device.id;
                    return (
                      <li key={device.id}>
                        <label
                          className={`flex cursor-pointer gap-3 rounded-2xl border bg-card p-4 shadow-sm dark:bg-foreground ${
                            selected
                              ? "border-amber-400 ring-2 ring-amber-200 dark:border-amber-500 dark:ring-amber-500/30"
                              : "border-border"
                          }`}
                        >
                          <input
                            type="radio"
                            name="replace-device"
                            className="mt-1 h-4 w-4 shrink-0 accent-amber-600"
                            checked={selected}
                            onChange={() => setSelectedId(device.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-black text-foreground dark:text-background">{name}</span>
                            <span className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
                              {formatDevicePlatformLabel(device.platform)}
                            </span>
                            <span className="mt-1 block text-sm font-medium text-muted-foreground dark:text-muted-foreground">
                              {t(lang, "connectedDevicesLastActivePrefix")}:{" "}
                              {lastActiveLabel(lang, device.last_seen_at, nowMs)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

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

      <footer className="shrink-0 border-t border-border/80 bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md dark:bg-foreground/95">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
          {isOwner ? (
            <>
              <button
                type="button"
                disabled={!selectedId || busy || replaceableDevices.length === 0}
                onClick={() => void handleReplaceSelected()}
                className="min-h-[48px] rounded-xl bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? t(lang, "deviceMgmtDisconnecting") : t(lang, "deviceLimitDisconnectSelected")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onSignOut) onSignOut();
                  else navigate("/login", { replace: true });
                }}
                className="min-h-[48px] rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground dark:border-border dark:bg-foreground dark:text-background"
              >
                {t(lang, "deviceLimitCancel")}
              </button>
            </>
          ) : (
            <>
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
                className="min-h-[48px] rounded-xl border border-border bg-card px-4 text-sm font-bold text-foreground dark:border-border dark:bg-foreground dark:text-background"
              >
                {t(lang, "deviceLimitClose")}
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
