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
  type DeviceAuthorityContext,
  type DeviceAuthorizedAction,
} from "../lib/deviceAuthority";

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

  const refresh = useCallback(async () => {
    if (authMode !== "supabase" || !shopId) {
      setCtx(null);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchDeviceAuthorityContext(shopId);
      setCtx(next);
    } finally {
      setLoading(false);
    }
  }, [authMode, shopId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo((): DeviceAuthorityState => {
    const hasCtx = ctx != null;
    const deviceAuthorized =
      authMode === "local" || (hasCtx && isDeviceAuthorizedForManagement(ctx));
    const isApproved = authMode === "local" || (hasCtx && ctx.isApproved);
    const isOperational = authMode === "local" || (hasCtx && ctx.isOperational);
    const pendingApproval =
      authMode === "supabase" && hasCtx && ctx.approvalStatus === "pending";
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
  }, [authMode, ctx, loading]);

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
  const deviceCtx = await fetchDeviceAuthorityContext(shopId);
  if (!deviceCtx) return { ok: true };
  if (deviceCtx.approvalStatus === "pending") {
    return { ok: false, errorKey: "devicePendingApproval" };
  }
  if (!isDeviceAuthorizedForManagement(deviceCtx)) {
    return { ok: false, errorKey: "deviceNotAuthorized" };
  }
  void action;
  return { ok: true };
}
