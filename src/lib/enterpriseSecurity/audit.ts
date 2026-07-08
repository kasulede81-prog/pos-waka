import type { SecurityAuditLogger, SecurityAuditPayload } from "./types";

export function createAuditId(): string {
  return crypto.randomUUID();
}

export function auditSecuritySuccess(
  log: SecurityAuditLogger | undefined,
  payload: Omit<SecurityAuditPayload, "success">,
): void {
  log?.({ ...payload, success: true });
}

export function auditSecurityFailure(
  log: SecurityAuditLogger | undefined,
  payload: Omit<SecurityAuditPayload, "success"> & { reason: string },
): void {
  log?.({ ...payload, success: false });
}

/** Default store audit bridge — used when no custom logger supplied. */
export function defaultSecurityAuditLogger(
  success: boolean,
  summary: string,
  payload: Record<string, unknown>,
): void {
  void import("../../store/usePosStore").then(({ usePosStore }) => {
    usePosStore.getState().logAuditAction(
      success ? "sensitive_action_auth_granted" : "sensitive_action_auth_denied",
      summary,
      payload,
    );
  });
}

export function backOfficeUnlockAuditLogger(
  success: boolean,
  payload: Record<string, unknown>,
): void {
  void import("../../store/usePosStore").then(({ usePosStore }) => {
    usePosStore.getState().logAuditAction(
      success ? "back_office_unlock_success" : "back_office_unlock_failed",
      success ? "Back Office unlocked" : "Back Office unlock failed",
      payload,
    );
  });
}
