/**
 * WAKA Remote Support control-plane types (RS-1).
 *
 * IDENTITY (shop_devices) ≠ AUTHORIZATION (these records) ≠ TRANSPORT (later).
 * No remote-desktop credential is represented here. grant_jti is a future
 * one-time authorization reference only.
 */

/** Technician request before / instead of a session. */
export type RemoteSupportRequestStatus =
  | "requested"
  | "approved"
  | "declined"
  | "cancelled"
  | "expired";

/** Authoritative session after customer approval. */
export type RemoteSupportSessionStatus =
  | "connecting"
  | "active"
  | "ended"
  | "failed"
  | "revoked"
  | "expired";

export type RemoteSupportEndedBy = "customer" | "technician" | "system" | "admin";

export type RemoteSupportActorType = "technician" | "customer" | "admin" | "system";

export type RemoteSupportEvent =
  | "request_created"
  | "request_delivered"
  | "customer_approved"
  | "customer_declined"
  | "technician_cancelled"
  | "request_expired"
  | "session_created"
  | "session_ended"
  | "customer_ended"
  | "session_revoked"
  | "session_failed"
  | "admin_revoked"
  | "grant_asserted"
  | "grant_rejected";

export type RemoteSupportReasonCode =
  | "printer"
  | "sync"
  | "training"
  | "hardware"
  | "software"
  | "other";

export const REMOTE_SUPPORT_REASON_CODES: RemoteSupportReasonCode[] = [
  "printer",
  "sync",
  "training",
  "hardware",
  "software",
  "other",
];

export const REMOTE_SUPPORT_REQUEST_TTL_MS = 5 * 60 * 1000;
export const REMOTE_SUPPORT_GRANT_TTL_MS = 5 * 60 * 1000;
export const REMOTE_SUPPORT_ONLINE_MS = 15 * 60 * 1000;
export const REMOTE_SUPPORT_SUPPORTED_PLATFORMS = ["windows"] as const;

export type RemoteSupportRequest = {
  id: string;
  shop_id: string;
  shop_device_id: string;
  device_fingerprint: string;
  technician_admin_id: string;
  technician_user_id: string | null;
  technician_name: string | null;
  reason_code: string;
  reason_text: string;
  status: RemoteSupportRequestStatus;
  requested_at: string;
  expires_at: string;
  customer_responded_at: string | null;
  customer_actor_type: string | null;
  customer_actor_id: string | null;
  support_request_id: string | null;
};

export type RemoteSupportSession = {
  id: string;
  request_id: string;
  shop_id: string;
  shop_device_id: string;
  technician_admin_id: string;
  technician_name: string | null;
  status: RemoteSupportSessionStatus;
  approved_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  ended_by: RemoteSupportEndedBy | null;
  failure_reason: string | null;
  /** Never returned to the POS inbox. Server-only / future transport. */
  grant_jti?: string | null;
  grant_expires_at?: string | null;
  grant_consumed_at?: string | null;
  transport_session_ref?: string | null;
};

export type RemoteSupportInbox = {
  request: RemoteSupportRequest | null;
  session: RemoteSupportSession | null;
};

export type RemoteSupportRpcResult = {
  ok: boolean;
  error?: string;
  message?: string;
  request_id?: string;
  session_id?: string;
  grant_jti?: string;
  status?: string;
};
