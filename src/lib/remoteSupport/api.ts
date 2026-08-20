import { supabase } from "../supabase";
import type { RemoteSupportInbox, RemoteSupportReasonCode, RemoteSupportRpcResult } from "./types";
import {
  DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS,
  parseRemoteSupportPlatformSettings,
  type RemoteSupportPlatformSettings,
} from "./masterSwitch";

function parseRpc(data: unknown, error: { message: string } | null): RemoteSupportRpcResult {
  if (error) return { ok: false, error: "rpc_error", message: error.message };
  if (!data || typeof data !== "object") return { ok: false, error: "rpc_error", message: "Empty response" };
  const r = data as Record<string, unknown>;
  return {
    ok: r.ok === true,
    error: r.error != null ? String(r.error) : undefined,
    message: r.message != null ? String(r.message) : r.error != null ? String(r.error) : undefined,
    request_id: r.request_id != null ? String(r.request_id) : undefined,
    session_id: r.session_id != null ? String(r.session_id) : undefined,
    grant_jti: r.grant_jti != null ? String(r.grant_jti) : undefined,
    status: r.status != null ? String(r.status) : undefined,
  };
}

function parseInbox(data: unknown): RemoteSupportInbox {
  if (!data || typeof data !== "object") return { request: null, session: null };
  const r = data as Record<string, unknown>;
  return {
    request: (r.request as RemoteSupportInbox["request"]) ?? null,
    session: (r.session as RemoteSupportInbox["session"]) ?? null,
  };
}

export async function requestRemoteSupport(input: {
  shopId: string;
  shopDeviceId: string;
  reasonCode: RemoteSupportReasonCode;
  reasonText: string;
  supportRequestId?: string | null;
}): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_request_start", {
    p_shop_id: input.shopId,
    p_shop_device_id: input.shopDeviceId,
    p_reason_code: input.reasonCode,
    p_reason_text: input.reasonText,
    p_support_request_id: input.supportRequestId ?? null,
  });
  return parseRpc(data, error);
}

export async function approveRemoteSupport(input: {
  requestId: string;
  deviceFingerprint: string;
}): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_customer_approve", {
    p_request_id: input.requestId,
    p_device_fingerprint: input.deviceFingerprint,
  });
  return parseRpc(data, error);
}

export async function declineRemoteSupport(input: {
  requestId: string;
  deviceFingerprint: string;
}): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_customer_decline", {
    p_request_id: input.requestId,
    p_device_fingerprint: input.deviceFingerprint,
  });
  return parseRpc(data, error);
}

export async function endRemoteSupport(input: {
  sessionId: string;
  deviceFingerprint: string;
}): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_customer_end", {
    p_session_id: input.sessionId,
    p_device_fingerprint: input.deviceFingerprint,
  });
  return parseRpc(data, error);
}

export async function cancelRemoteSupport(requestId: string): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_technician_cancel", {
    p_request_id: requestId,
  });
  return parseRpc(data, error);
}

export async function revokeRemoteSupport(input: {
  requestId?: string | null;
  sessionId?: string | null;
}): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_admin_revoke", {
    p_request_id: input.requestId ?? null,
    p_session_id: input.sessionId ?? null,
  });
  return parseRpc(data, error);
}

export async function expireStaleRemoteSupport(shopId?: string | null): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_expire_stale", {
    p_shop_id: shopId ?? null,
  });
  return parseRpc(data, error);
}

export async function assertRemoteSupportGrantRpc(input: {
  sessionId: string;
  grantJti: string;
  deviceFingerprint: string;
}): Promise<RemoteSupportRpcResult> {
  if (!supabase) return { ok: false, error: "offline", message: "Offline" };
  const { data, error } = await supabase.rpc("remote_support_grant_assert", {
    p_session_id: input.sessionId,
    p_grant_jti: input.grantJti,
    p_device_fingerprint: input.deviceFingerprint,
  });
  return parseRpc(data, error);
}

export async function fetchRemoteSupportCustomerInbox(deviceFingerprint: string): Promise<RemoteSupportInbox> {
  if (!supabase) return { request: null, session: null };
  const { data, error } = await supabase.rpc("remote_support_customer_inbox", {
    p_device_fingerprint: deviceFingerprint,
  });
  if (error) return { request: null, session: null };
  return parseInbox(data);
}

export async function fetchRemoteSupportPlatformSettings(): Promise<RemoteSupportPlatformSettings> {
  if (!supabase) return { ...DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS };
  const { data, error } = await supabase.rpc("get_remote_support_platform_settings");
  if (error || !data) return { ...DEFAULT_REMOTE_SUPPORT_PLATFORM_SETTINGS };
  return parseRemoteSupportPlatformSettings(data);
}

export async function adminUpdateRemoteSupportPlatformEnabled(
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "offline" };
  const { data, error } = await supabase.rpc("admin_update_remote_support_platform_settings", {
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string } | null;
  if (!row?.ok) return { ok: false, error: row?.error ?? "not_authorized" };
  return { ok: true };
}

export function remoteSupportErrorMessage(result: RemoteSupportRpcResult): string {
  switch (result.error) {
    case "remote_support_disabled":
      return "Remote support is turned off.";
    case "not_authorized":
      return "You do not have permission to request remote support.";
    case "device_not_found":
      return "That WAKA POS device was not found.";
    case "device_shop_mismatch":
      return "That device does not belong to this shop.";
    case "support_request_shop_mismatch":
      return "That support ticket belongs to a different shop.";
    case "support_request_not_found":
      return "That support ticket was not found.";
    case "device_not_eligible":
    case "device_no_longer_eligible":
      return "This device is not eligible for remote support.";
    case "device_offline":
      return "This device has not been seen recently.";
    case "unsupported_platform":
      return "Remote support is available only on Windows WAKA POS.";
    case "reason_required":
      return "Enter a support reason.";
    case "request_exists":
      return "A remote-support request is already pending for this device.";
    case "request_expired":
      return "This request has expired.";
    case "invalid_state":
      return "This request is no longer waiting for approval.";
    case "device_mismatch":
      return "This request is for a different POS device.";
    case "grant_replayed":
      return "This authorization has already been used.";
    case "grant_expired":
      return "This authorization has expired.";
    default:
      return result.message || "Remote support action failed.";
  }
}
