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
  registerShopDeviceOnLogin,
  type DeviceActivationResult,
  type DeviceLimitContext,
} from "../lib/deviceActivation";

export type DeviceActivationBlock = {
  shopId: string;
  result: DeviceActivationResult;
  context: DeviceLimitContext | null;
  kind: "limit" | "pending" | "revoked";
};

type DeviceActivationState = {
  loading: boolean;
  activated: boolean;
  block: DeviceActivationBlock | null;
  shopId: string | null;
  retry: () => Promise<void>;
};

const DeviceActivationCtx = createContext<DeviceActivationState | null>(null);

const DEVICE_CHECK_TIMEOUT_MS = 8_000;

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

  const runCheck = useCallback(async (uid: string) => {
    if (inFlightRef.current === uid) return;
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
      const result = await withTimeout(
        registerShopDeviceOnLogin(sid),
        DEVICE_CHECK_TIMEOUT_MS,
        { ok: false, activated: false },
      );
      if (result.activated) {
        setActivated(true);
        setBlock(null);
        void import("../lib/staffCacheSync").then(({ scheduleStaffCacheProvisioning }) => {
          scheduleStaffCacheProvisioning();
        });
        return;
      }
      if (result.pending_approval || result.approval_status === "pending") {
        setActivated(false);
        setBlock({ shopId: sid, result, context: null, kind: "pending" });
        return;
      }
      if (result.revoked) {
        setActivated(false);
        setBlock({ shopId: sid, result, context: null, kind: "revoked" });
        return;
      }
      if (result.limit_blocked) {
        const context = await withTimeout(fetchShopDeviceLimitContext(sid), DEVICE_CHECK_TIMEOUT_MS, null);
        setActivated(false);
        setBlock({ shopId: sid, result, context, kind: "limit" });
        return;
      }
      setActivated(false);
      setBlock(null);
    } catch {
      setActivated(false);
      setBlock(null);
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
    await runCheck(user.id);
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
