import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import {
  fetchShopDeviceLimitContext,
  resolveActivationBlockKind,
  resolveLoginDeviceActivation,
  type ActivationBlockKind,
  type DeviceActivationResult,
  type DeviceLimitContext,
} from "../lib/deviceActivation";
import { fetchShopDevicesForManagement } from "../lib/shopDevices";
import { getOrCreateDeviceId } from "../lib/deviceId";
import { logActivationFailure, type ActivationFailureKind } from "../lib/deviceActivationDiagnostics";
import { schedulePostLoginBackgroundTasks } from "../lib/postLoginBackgroundTasks";

export type DeviceActivationBlock = {
  shopId: string;
  result: DeviceActivationResult;
  context: DeviceLimitContext | null;
  kind: ActivationBlockKind;
  failureReason?: ActivationFailureKind;
};

type DeviceActivationState = {
  loading: boolean;
  activated: boolean;
  block: DeviceActivationBlock | null;
  shopId: string | null;
  retry: () => Promise<void>;
};

const DeviceActivationCtx = createContext<DeviceActivationState | null>(null);

const DEVICE_CHECK_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(fallback), ms);
    void promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      () => {
        window.clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

export function pathAllowedWhenDeviceBlocked(path: string): boolean {
  const p = path.split("?")[0] || "/";
  return (
    p === "/device-limit" ||
    p === "/device-activating" ||
    p === "/device-pending" ||
    p === "/upgrade" ||
    p === "/login" ||
    p === "/onboarding" ||
    p.startsWith("/auth/") ||
    p === "/account" ||
    p === "/settings/devices"
  );
}

type ProviderProps = {
  authMode: "supabase" | "local";
  user: User | null | undefined;
  children: ReactNode;
};

export function DeviceActivationProvider({ authMode, user, children }: ProviderProps) {
  const [loading, setLoading] = useState(false);
  const [activated, setActivated] = useState(authMode !== "supabase");
  const [block, setBlock] = useState<DeviceActivationBlock | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const inFlightRef = useRef<string | null>(null);

  const runCheck = useCallback(async (uid: string, force = false) => {
    if (!force && inFlightRef.current === uid) return;
    inFlightRef.current = uid;
    setLoading(true);
    try {
      const org = await withTimeout(resolvePrimaryOrganizationForUser(uid), DEVICE_CHECK_TIMEOUT_MS, null);
      const sid = org?.shopId ?? null;
      setShopId(sid);
      if (!sid) {
        setActivated(true);
        setBlock(null);
        return;
      }

      const loginActivation = await withTimeout(
        resolveLoginDeviceActivation(sid),
        DEVICE_CHECK_TIMEOUT_MS,
        {
          activated: false,
          result: { ok: false, activated: false },
          failureReason: "timeout" as ActivationFailureKind,
        },
      );

      if (loginActivation.activated) {
        setActivated(true);
        setBlock(null);
        schedulePostLoginBackgroundTasks(sid);
        return;
      }

      const result = loginActivation.result;
      const context = await withTimeout(fetchShopDeviceLimitContext(sid), DEVICE_CHECK_TIMEOUT_MS, null);
      const isOwner = loginActivation.isOwner ?? context?.is_owner ?? false;

      if (
        result.revoked ||
        loginActivation.failureReason === "revoked" ||
        loginActivation.failureReason === "device_revoked"
      ) {
        setActivated(false);
        setBlock({
          shopId: sid,
          result,
          context,
          kind: "revoked",
          failureReason: "device_revoked",
        });
        return;
      }

      if (
        result.limit_blocked ||
        loginActivation.failureReason === "limit_reached" ||
        loginActivation.failureReason === "device_limit_reached"
      ) {
        setActivated(false);
        setBlock({
          shopId: sid,
          result,
          context,
          kind: "limit",
          failureReason: "device_limit_reached",
        });
        return;
      }

      if (!isOwner && (result.pending_approval || result.approval_status === "pending")) {
        setActivated(false);
        setBlock({
          shopId: sid,
          result,
          context,
          kind: "pending",
          failureReason: "device_pending",
        });
        return;
      }

      const fp = getOrCreateDeviceId();
      const [{ devices }, deviceContext] = await Promise.all([
        withTimeout(fetchShopDevicesForManagement(sid), DEVICE_CHECK_TIMEOUT_MS, { devices: [], isOwner: false }),
        Promise.resolve(context),
      ]);
      const mine = devices.find((d) => d.device_fingerprint === fp);
      const kind = resolveActivationBlockKind({
        result,
        context: deviceContext,
        currentDevice: mine ?? null,
        failureReason: loginActivation.failureReason,
      });

      if (kind === "limit") {
        setActivated(false);
        setBlock({ shopId: sid, result, context: deviceContext, kind: "limit", failureReason: "device_limit_reached" });
        return;
      }

      if (kind === "pending" && !isOwner) {
        setActivated(false);
        setBlock({ shopId: sid, result, context: deviceContext, kind: "pending", failureReason: "device_pending" });
        return;
      }

      setActivated(false);
      setBlock({ shopId: sid, result, context: deviceContext, kind, failureReason: loginActivation.failureReason });
    } catch (error) {
      setActivated(false);
      setBlock(null);
      logActivationFailure("login", "unknown", { error: String(error) });
    } finally {
      inFlightRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authMode !== "supabase" || !user?.id) {
      setLoading(false);
      setActivated(true);
      setBlock(null);
      setShopId(null);
      return;
    }
    void runCheck(user.id);
  }, [authMode, user?.id, runCheck]);

  const retry = useCallback(async () => {
    if (!user?.id) return;
    await runCheck(user.id, true);
  }, [runCheck, user?.id]);

  const value = useMemo(
    () => ({ loading, activated, block, shopId, retry }),
    [loading, activated, block, shopId, retry],
  );

  return <DeviceActivationCtx.Provider value={value}>{children}</DeviceActivationCtx.Provider>;
}

export function useDeviceActivation(): DeviceActivationState {
  const ctx = useContext(DeviceActivationCtx);
  if (!ctx) {
    return {
      loading: false,
      activated: true,
      block: null,
      shopId: null,
      retry: async () => {},
    };
  }
  return ctx;
}
