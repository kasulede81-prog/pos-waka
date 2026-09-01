import type { ActivationBlockKind } from "./deviceActivation";

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

/** First paint must be checking, never a false unauthorized/network-failed flash. */
export function initialDeviceActivationFlags(
  authMode: "supabase" | "local",
  userId?: string | null,
): { loading: boolean; activated: boolean } {
  const skipCheck = authMode !== "supabase" || !userId;
  return { loading: !skipCheck, activated: skipCheck };
}

/**
 * While the device check is in flight, protected POS (PosDataProvider) must still mount.
 * Unauthorized devices are blocked only after the check resolves.
 */
export function deviceGateMountsProtectedOutlet(input: {
  loading: boolean;
  activated: boolean;
  path: string;
  isShopOwner: boolean;
  blockKind?: ActivationBlockKind | null;
}): boolean {
  if (input.loading) return true;
  if (input.activated) return true;
  const path = input.path.split("?")[0] || "/";
  if (pathAllowedWhenDeviceBlocked(path)) return true;
  if (input.isShopOwner && input.blockKind !== "limit") return true;
  return false;
}

/** True when authorization has resolved against this device and POS must not be used. */
export function isDeviceActivationBlockingUse(input: { loading: boolean; activated: boolean }): boolean {
  return !input.loading && !input.activated;
}
