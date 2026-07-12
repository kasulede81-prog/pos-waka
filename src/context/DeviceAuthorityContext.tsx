import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchDeviceAuthorityContext,
  isDeviceAuthorizedForManagement,
  isShopOwnerDeviceAuthorityBypassActive,
  seedOwnerApprovedDeviceAuthority,
  setShopOwnerDeviceAuthorityBypass,
  subscribeDeviceAuthorityRefresh,
  type DeviceAuthorityContext,
  type DeviceAuthorizedAction,
} from "../lib/deviceAuthority";
import { fetchShopDeviceLimitContext } from "../lib/deviceActivation";

type DeviceAuthorityState = {
  loading: boolean;
  ctx: DeviceAuthorityContext | null;
  /** Approved operational device — can perform owner management actions. */
  isDeviceAuthorized: boolean;
  isApproved: boolean;
  isOperational: boolean;
  pendingApproval: boolean;
  refresh: () => Promise<void>;
  canPerformAuthorizedAction: (action: DeviceAuthorizedAction) => boolean;
};

const DeviceAuthorityCtx = createContext<DeviceAuthorityState | null>(null);

type Props = {
  shopId: string | null;
  authMode: "supabase" | "local";
  children: ReactNode;
};

export function DeviceAuthorityProvider({ shopId, authMode, children }: Props) {
  const [loading, setLoading] = useState(false);
  const [ctx, setCtx] = useState<DeviceAuthorityContext | null>(null);
  const [isShopOwner, setIsShopOwner] = useState(false);

  const refresh = useCallback(async () => {
    if (authMode !== "supabase" || !shopId) {
      setCtx(null);
      setIsShopOwner(false);
      setShopOwnerDeviceAuthorityBypass(null);
      return;
    }
    setLoading(true);
    try {
      const limitCtx = await fetchShopDeviceLimitContext(shopId).catch(() => null);
      const owner = Boolean(limitCtx?.is_owner);
      setIsShopOwner(owner);
      if (owner) {
        setShopOwnerDeviceAuthorityBypass(shopId);
        seedOwnerApprovedDeviceAuthority(shopId);
      } else {
        setShopOwnerDeviceAuthorityBypass(null);
      }
      const next = await fetchDeviceAuthorityContext(shopId);
      setCtx(next);
    } finally {
      setLoading(false);
    }
  }, [authMode, shopId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => subscribeDeviceAuthorityRefresh(() => {
    void refresh();
  }), [refresh]);

  const value = useMemo((): DeviceAuthorityState => {
    const hasCtx = ctx != null;
    const ownerBypass = isShopOwner || isShopOwnerDeviceAuthorityBypassActive(shopId);
    const deviceAuthorized =
      authMode === "local" || ownerBypass || (hasCtx && isDeviceAuthorizedForManagement(ctx));
    const isApproved = authMode === "local" || ownerBypass || (hasCtx && ctx.isApproved);
    const isOperational = authMode === "local" || ownerBypass || (hasCtx && ctx.isOperational);
    const pendingApproval =
      authMode === "supabase" && hasCtx && ctx.approvalStatus === "pending" && !ownerBypass;
    return {
      loading,
      ctx,
      isDeviceAuthorized: deviceAuthorized,
      isApproved,
      isOperational,
      pendingApproval,
      refresh,
      canPerformAuthorizedAction: () => deviceAuthorized,
    };
  }, [authMode, ctx, isShopOwner, loading, refresh, shopId]);

  return <DeviceAuthorityCtx.Provider value={value}>{children}</DeviceAuthorityCtx.Provider>;
}

export function useDeviceAuthority(): DeviceAuthorityState {
  const ctx = useContext(DeviceAuthorityCtx);
  if (!ctx) {
    return {
      loading: false,
      ctx: null,
      isDeviceAuthorized: false,
      isApproved: false,
      isOperational: false,
      pendingApproval: false,
      refresh: async () => {},
      canPerformAuthorizedAction: () => false,
    };
  }
  return ctx;
}

export async function assertDeviceAuthorizedAction(
  action: DeviceAuthorizedAction,
  shopId?: string,
): Promise<{ ok: true } | { ok: false; errorKey: "deviceNotAuthorized" | "devicePendingApproval" }> {
  if (shopId) {
    const limitCtx = await fetchShopDeviceLimitContext(shopId).catch(() => null);
    if (limitCtx?.is_owner) return { ok: true };
  }
  const deviceCtx = await fetchDeviceAuthorityContext(shopId);
  if (!deviceCtx && isShopOwnerDeviceAuthorityBypassActive(shopId)) return { ok: true };
  if (!deviceCtx) return { ok: false, errorKey: "deviceNotAuthorized" };
  if (deviceCtx.approvalStatus === "pending" && !isShopOwnerDeviceAuthorityBypassActive(deviceCtx.shopId)) {
    return { ok: false, errorKey: "devicePendingApproval" };
  }
  if (!isDeviceAuthorizedForManagement(deviceCtx)) {
    return { ok: false, errorKey: "deviceNotAuthorized" };
  }
  void action;
  return { ok: true };
}
