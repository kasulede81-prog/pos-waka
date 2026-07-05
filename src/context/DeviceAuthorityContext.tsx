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
  type DeviceAuthorityContext,
  type PrimaryOnlyAction,
} from "../lib/deviceAuthority";

type DeviceAuthorityState = {
  loading: boolean;
  ctx: DeviceAuthorityContext | null;
  isPrimary: boolean;
  isApproved: boolean;
  isOperational: boolean;
  pendingApproval: boolean;
  refresh: () => Promise<void>;
  canPrimary: (action: PrimaryOnlyAction) => boolean;
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
    const isPrimary = authMode === "local" || ctx?.isPrimary !== false;
    const isApproved = authMode === "local" || ctx?.isApproved !== false;
    const isOperational = authMode === "local" || ctx?.isOperational !== false;
    const pendingApproval = authMode === "supabase" && ctx?.approvalStatus === "pending";
    return {
      loading,
      ctx,
      isPrimary,
      isApproved,
      isOperational,
      pendingApproval,
      refresh,
      canPrimary: (action: PrimaryOnlyAction) => {
        if (authMode === "local") return true;
        if (!ctx) return true;
        if (!ctx.primaryDeviceFingerprint) return true;
        if (action === "device_approve") return ctx.isPrimary && ctx.isApproved;
        return ctx.isPrimary && ctx.isApproved;
      },
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
      isPrimary: true,
      isApproved: true,
      isOperational: true,
      pendingApproval: false,
      refresh: async () => {},
      canPrimary: () => true,
    };
  }
  return ctx;
}

export async function assertPrimaryDeviceAction(
  action: PrimaryOnlyAction,
  shopId?: string,
): Promise<{ ok: true } | { ok: false; errorKey: "notPrimaryDevice" | "devicePendingApproval" }> {
  const deviceCtx = await fetchDeviceAuthorityContext(shopId);
  if (!deviceCtx) return { ok: true };
  if (deviceCtx.approvalStatus === "pending") {
    return { ok: false, errorKey: "devicePendingApproval" };
  }
  if (deviceCtx.primaryDeviceFingerprint && !deviceCtx.isPrimary) {
    return { ok: false, errorKey: "notPrimaryDevice" };
  }
  void action;
  return { ok: true };
}
