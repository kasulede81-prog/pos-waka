import type { ShopDeviceStatus } from "./deviceLifecycle";

/** Whether login registration needs a new device slot (counts toward limit). */
export function needsNewDeviceSlot(status: ShopDeviceStatus | null): boolean {
  return status == null || status === "disconnected";
}

/**
 * Server-aligned gate: block only when limit is set, device needs a slot,
 * and active count already at or over limit.
 */
export function evaluateDeviceLimitBlock(params: {
  deviceLimit: number | null;
  activeCount: number;
  currentStatus: ShopDeviceStatus | null;
}): { blocked: boolean; reason?: "at_limit" } {
  if (!needsNewDeviceSlot(params.currentStatus)) {
    return { blocked: false };
  }
  if (params.deviceLimit == null || params.deviceLimit <= 0) {
    return { blocked: false };
  }
  if (params.activeCount >= params.deviceLimit) {
    return { blocked: true, reason: "at_limit" };
  }
  return { blocked: false };
}

export function isUnlimitedDevicePlan(deviceLimit: number | null | undefined): boolean {
  return deviceLimit == null || deviceLimit <= 0;
}
