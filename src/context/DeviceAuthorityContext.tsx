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
import { ENFORCE_PRIMARY_DEVICE } from "../lib/deviceAuthorityPolicy";

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
    const hasCtx = ctx != null;
    const isPrimary =
      authMode === "local" || !ENFORCE_PRIMARY_DEVICE || (hasCtx && ctx.isPrimary);
    const isApproved = authMode === "local" || (hasCtx && ctx.isApproved);
    const isOperational = authMode === "local" || (hasCtx && ctx.isOperational);
    const pendingApproval =
      ENFORCE_PRIMARY_DEVICE &&
      authMode === "supabase" &&
      hasCtx &&
      ctx.approvalStatus === "pending";
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
        if (!hasCtx) return false;
        if (!ENFORCE_PRIMARY_DEVICE) return ctx.isApproved && ctx.approvalStatus !== "pending";
        if (!ctx.primaryDeviceFingerprint) return ctx.isPrimary && ctx.isApproved;
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
      isPrimary: false,
      isApproved: false,
      isOperational: false,
      pendingApproval: false,
      refresh: async () => {},
      canPrimary: () => false,
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
  if (ENFORCE_PRIMARY_DEVICE && deviceCtx.primaryDeviceFingerprint && !deviceCtx.isPrimary) {
    return { ok: false, errorKey: "notPrimaryDevice" };
  }
  void action;
  return { ok: true };
}
