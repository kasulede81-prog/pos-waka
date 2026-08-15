import {
  REMOTE_SUPPORT_ONLINE_MS,
  REMOTE_SUPPORT_SUPPORTED_PLATFORMS,
} from "./types";

/**
 * Device fields needed to decide Remote Support eligibility.
 * Uses shop_devices semantics — does not invent a second registry.
 *
 * `trusted` is NOT authorization.
 * `suspicious_flag` is informational (no existing hard-block in WAKA).
 */
export type RemoteSupportEligibilityDevice = {
  id?: string;
  shop_id?: string;
  platform: string | null | undefined;
  last_seen_at: string | null | undefined;
  is_active: boolean;
  status?: string | null;
  approval_status?: string | null;
  suspicious_flag?: boolean | null;
};

export type RemoteSupportIneligibleReason =
  | "inactive"
  | "revoked"
  | "not_approved"
  | "unsupported_platform"
  | "stale_heartbeat"
  | "missing_identity";

export type RemoteSupportEligibility = {
  eligible: boolean;
  reason: RemoteSupportIneligibleReason | null;
  explanation: string;
};

export function isRemoteSupportSupportedPlatform(platform: string | null | undefined): boolean {
  const p = String(platform ?? "")
    .trim()
    .toLowerCase();
  return (REMOTE_SUPPORT_SUPPORTED_PLATFORMS as readonly string[]).includes(p);
}

export function isRemoteSupportRecentlySeen(
  lastSeenAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const ts = Date.parse(lastSeenAt);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts >= 0 && nowMs - ts < REMOTE_SUPPORT_ONLINE_MS;
}

export function isRemoteSupportEligible(
  device: RemoteSupportEligibilityDevice,
  nowMs: number = Date.now(),
): boolean {
  return evaluateRemoteSupportEligibility(device, nowMs).eligible;
}

export function evaluateRemoteSupportEligibility(
  device: RemoteSupportEligibilityDevice,
  nowMs: number = Date.now(),
): RemoteSupportEligibility {
  const statusRaw = device.status != null ? String(device.status).trim().toLowerCase() : "";
  const approvalRaw = device.approval_status != null ? String(device.approval_status).trim().toLowerCase() : "";

  if (statusRaw === "revoked") {
    return { eligible: false, reason: "revoked", explanation: "This device is revoked and cannot receive remote support." };
  }
  if (!device.is_active || (statusRaw && statusRaw !== "active")) {
    return { eligible: false, reason: "inactive", explanation: "This device is not active." };
  }
  if (approvalRaw && approvalRaw !== "approved") {
    return {
      eligible: false,
      reason: "not_approved",
      explanation: "This device is not an approved WAKA POS terminal.",
    };
  }

  if (!isRemoteSupportSupportedPlatform(device.platform)) {
    return {
      eligible: false,
      reason: "unsupported_platform",
      explanation: "Remote support is available only on Windows WAKA POS.",
    };
  }

  if (!isRemoteSupportRecentlySeen(device.last_seen_at, nowMs)) {
    return {
      eligible: false,
      reason: "stale_heartbeat",
      explanation: "This device has not been seen recently. Ask the shop to open WAKA POS.",
    };
  }

  return { eligible: true, reason: null, explanation: "Eligible for a remote-support request." };
}
