/** Device registry lifecycle — mirrors server rules in migration 089. */

export type ShopDeviceStatus = "active" | "disconnected" | "revoked";

export function normalizeShopDeviceStatus(raw: unknown): ShopDeviceStatus {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "disconnected" || s === "revoked") return s;
  return "active";
}

export function isActiveDeviceStatus(status: ShopDeviceStatus): boolean {
  return status === "active";
}

/** Heartbeat must not update disconnected/revoked devices. */
export function heartbeatPolicy(current: ShopDeviceStatus | null): "accept" | "reject" {
  if (current == null) return "accept";
  return current === "active" ? "accept" : "reject";
}

/** Only login registration may reactivate a disconnected device. */
export function loginRegistrationPolicy(
  current: ShopDeviceStatus | null,
): "insert" | "reactivate" | "touch_active" | "reject_revoked" {
  if (current == null) return "insert";
  if (current === "active") return "touch_active";
  if (current === "disconnected") return "reactivate";
  return "reject_revoked";
}
