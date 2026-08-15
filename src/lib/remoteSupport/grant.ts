/**
 * Future one-time grant checks (RS-1 control plane only).
 * Does not mint a remote-desktop credential.
 * Grant existence is necessary but not sufficient — current device
 * lifecycle must still be eligible.
 */

import { isRemoteSupportEligible, type RemoteSupportEligibilityDevice } from "./eligibility";

export type RemoteSupportGrantRecord = {
  session_id: string;
  shop_device_id: string;
  device_fingerprint: string;
  grant_jti: string;
  grant_expires_at: string;
  grant_consumed_at: string | null;
  session_status: string;
};

export type RemoteSupportGrantAssertInput = {
  sessionId: string;
  grantJti: string;
  deviceFingerprint: string;
  shopDeviceId: string;
};

export type RemoteSupportGrantAssertResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "grant_invalid"
        | "grant_expired"
        | "grant_replayed"
        | "grant_device_mismatch"
        | "grant_session_mismatch"
        | "device_no_longer_eligible";
    };

export function assertRemoteSupportGrant(
  record: RemoteSupportGrantRecord,
  input: RemoteSupportGrantAssertInput,
  nowMs: number = Date.now(),
  device?: RemoteSupportEligibilityDevice | null,
): RemoteSupportGrantAssertResult {
  if (record.session_id !== input.sessionId) {
    return { ok: false, error: "grant_session_mismatch" };
  }
  if (record.grant_jti !== input.grantJti) {
    return { ok: false, error: "grant_invalid" };
  }
  if (record.shop_device_id !== input.shopDeviceId || record.device_fingerprint !== input.deviceFingerprint) {
    return { ok: false, error: "grant_device_mismatch" };
  }
  if (record.grant_consumed_at) {
    return { ok: false, error: "grant_replayed" };
  }
  if (Date.parse(record.grant_expires_at) <= nowMs) {
    return { ok: false, error: "grant_expired" };
  }
  if (record.session_status !== "connecting" && record.session_status !== "active") {
    return { ok: false, error: "grant_invalid" };
  }
  if (device && !isRemoteSupportEligible(device, nowMs)) {
    return { ok: false, error: "device_no_longer_eligible" };
  }
  return { ok: true };
}

export function consumeRemoteSupportGrant(
  record: RemoteSupportGrantRecord,
  input: RemoteSupportGrantAssertInput,
  nowMs: number = Date.now(),
  device?: RemoteSupportEligibilityDevice | null,
): RemoteSupportGrantAssertResult & { consumedAt?: string } {
  const asserted = assertRemoteSupportGrant(record, input, nowMs, device);
  if (!asserted.ok) return asserted;
  return { ok: true, consumedAt: new Date(nowMs).toISOString() };
}
