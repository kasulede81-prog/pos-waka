/**
 * Remote Support control-plane transitions (RS-1).
 *
 * Request and session are separate. All production transitions happen in
 * SECURITY DEFINER RPCs; this module is the documented client mirror used
 * for tests and UI guards.
 *
 * Request:
 *   requested → approved | declined | cancelled | expired
 *   approved / declined / cancelled / expired are terminal
 *
 * Session (created only on customer approve):
 *   connecting → active | ended | failed | revoked | expired
 *   active     → ended | failed | revoked | expired
 *   ended / failed / revoked / expired are terminal
 *
 * Illegal: declined→approved, expired→approved, ended→approved, revoked→approved
 */

import type { RemoteSupportRequestStatus, RemoteSupportSessionStatus } from "./types";

const REQUEST_TRANSITIONS: Record<RemoteSupportRequestStatus, readonly RemoteSupportRequestStatus[]> = {
  requested: ["approved", "declined", "cancelled", "expired"],
  approved: [],
  declined: [],
  cancelled: [],
  expired: [],
};

const SESSION_TRANSITIONS: Record<RemoteSupportSessionStatus, readonly RemoteSupportSessionStatus[]> = {
  connecting: ["active", "ended", "failed", "revoked", "expired"],
  active: ["ended", "failed", "revoked", "expired"],
  ended: [],
  failed: [],
  revoked: [],
  expired: [],
};

export function canTransitionRequest(
  from: RemoteSupportRequestStatus,
  to: RemoteSupportRequestStatus,
): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export function canTransitionSession(
  from: RemoteSupportSessionStatus,
  to: RemoteSupportSessionStatus,
): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function isTerminalRequestStatus(status: RemoteSupportRequestStatus): boolean {
  return REQUEST_TRANSITIONS[status].length === 0;
}

export function isOpenSessionStatus(status: RemoteSupportSessionStatus): boolean {
  return status === "connecting" || status === "active";
}

export function isTerminalSessionStatus(status: RemoteSupportSessionStatus): boolean {
  return !isOpenSessionStatus(status);
}
