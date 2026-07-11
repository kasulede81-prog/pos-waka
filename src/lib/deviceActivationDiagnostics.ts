/** Structured activation pipeline logging for owner device login. */

import { getOrCreateDeviceId } from "./deviceId";

export type ActivationStage =
  | "login"
  | "register"
  | "approve"
  | "activate"
  | "refresh"
  | "completed";

export type ActivationFailureKind =
  | "timeout"
  | "network"
  | "network_error"
  | "rpc_failure"
  | "approval_denied"
  | "approval_failed"
  | "activation_failed"
  | "limit_reached"
  | "device_limit_reached"
  | "revoked"
  | "device_revoked"
  | "authorization_failure"
  | "pending_approval"
  | "device_pending"
  | "email_not_verified"
  | "approval_expired"
  | "invalid_device_fingerprint"
  | "unknown";

export type ActivationAttemptLog = {
  attempt: number;
  shopId: string;
  deviceId: string;
  stage: ActivationStage;
  rpc?: string;
  elapsedMs: number;
  approvalStatus?: string;
  activationStatus?: string;
  failureReason?: ActivationFailureKind;
  failureDetail?: string;
};

const LOG_PREFIX = "[waka-device-activation]";

let attemptCounter = 0;

export function resetActivationAttemptCounter(): void {
  attemptCounter = 0;
}

export function nextActivationAttempt(): number {
  attemptCounter += 1;
  return attemptCounter;
}

export function logActivationStage(stage: ActivationStage, detail?: Record<string, unknown>): void {
  console.info(LOG_PREFIX, stage, detail ?? {});
}

export function logActivationFailure(
  stage: ActivationStage,
  kind: ActivationFailureKind,
  detail?: Record<string, unknown>,
): void {
  console.warn(LOG_PREFIX, `${stage}_failed`, kind, detail ?? {});
}

export function logActivationAttempt(log: ActivationAttemptLog): void {
  console.warn(LOG_PREFIX, "attempt", {
    attempt: log.attempt,
    shopId: log.shopId,
    deviceId: log.deviceId,
    stage: log.stage,
    rpc: log.rpc,
    elapsedMs: log.elapsedMs,
    approvalStatus: log.approvalStatus,
    activationStatus: log.activationStatus,
    failureReason: log.failureReason,
    failureDetail: log.failureDetail,
  });
}

export function classifyActivationError(error: unknown): ActivationFailureKind {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid device fingerprint")) return "invalid_device_fingerprint";
    if (msg.includes("email_not_verified")) return "email_not_verified";
    if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) {
      return "network_error";
    }
    if (msg.includes("forbidden") || msg.includes("unauthorized")) return "authorization_failure";
  }
  return "rpc_failure";
}

export function classifyApprovalRpcError(error?: string | null): ActivationFailureKind {
  const msg = (error ?? "").toLowerCase();
  if (!msg) return "approval_failed";
  if (msg.includes("email_not_verified")) return "email_not_verified";
  if (msg.includes("approval_expired")) return "approval_expired";
  if (msg.includes("device_limit_reached") || msg.includes("limit")) return "device_limit_reached";
  if (msg.includes("device_not_found")) return "approval_failed";
  if (msg.includes("forbidden")) return "authorization_failure";
  return "approval_failed";
}

export function normalizeFailureKind(kind: ActivationFailureKind): ActivationFailureKind {
  if (kind === "network_error") return "network";
  if (kind === "device_limit_reached") return "limit_reached";
  if (kind === "device_revoked") return "revoked";
  if (kind === "device_pending") return "pending_approval";
  return kind;
}

export function activationDeviceId(): string {
  return getOrCreateDeviceId();
}
