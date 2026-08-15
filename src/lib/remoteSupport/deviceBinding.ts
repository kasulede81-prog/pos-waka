/**
 * Customer actions are bound to the target POS fingerprint.
 * shop_id alone is never sufficient.
 * Inbox visibility is per-device: Device B must not see Device A's request.
 *
 * Fingerprint is a WAKA localStorage identity, not hardware authentication.
 */

import { isRemoteSupportEligible, type RemoteSupportEligibilityDevice } from "./eligibility";

export type RemoteSupportBindingRequest = {
  shop_id: string;
  shop_device_id?: string;
  device_fingerprint: string;
  status: string;
  expires_at: string;
  technician_user_id?: string | null;
};

export function fingerprintsMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
  const a = String(expected ?? "").trim();
  const b = String(actual ?? "").trim();
  return a.length >= 8 && a === b;
}

/** Shop-member inbox/Realtime must not return another device's request. */
export function canCustomerSeeRemoteSupportInbox(
  requestFingerprint: string,
  callerFingerprint: string,
): boolean {
  return fingerprintsMatch(requestFingerprint, callerFingerprint);
}

export function canCustomerActOnRequest(
  request: RemoteSupportBindingRequest,
  currentFingerprint: string,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; error: "device_mismatch" | "request_expired" | "invalid_state" } {
  if (!fingerprintsMatch(request.device_fingerprint, currentFingerprint)) {
    return { ok: false, error: "device_mismatch" };
  }
  if (Date.parse(request.expires_at) <= nowMs) {
    return { ok: false, error: "request_expired" };
  }
  if (request.status !== "requested") {
    return { ok: false, error: "invalid_state" };
  }
  return { ok: true };
}

export function canApproveRemoteSupportRequest(
  request: RemoteSupportBindingRequest,
  currentFingerprint: string,
  device: RemoteSupportEligibilityDevice,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; error: "device_mismatch" | "request_expired" | "invalid_state" | "device_no_longer_eligible" } {
  const bound = canCustomerActOnRequest(request, currentFingerprint, nowMs);
  if (!bound.ok) return bound;
  if (device.shop_id && request.shop_id && device.shop_id !== request.shop_id) {
    return { ok: false, error: "device_no_longer_eligible" };
  }
  if (!isRemoteSupportEligible(device, nowMs)) {
    return { ok: false, error: "device_no_longer_eligible" };
  }
  return { ok: true };
}
