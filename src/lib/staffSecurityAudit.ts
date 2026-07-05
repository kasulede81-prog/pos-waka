/**
 * Staff security audit events — local audit log with cloud sync payload.
 */

import type { AuditAction } from "../types";
import { getOrCreateDeviceId } from "./deviceId";
import { getDeviceOnline } from "./deviceOnline";
import { presencePlatform } from "./shopPresence";

export type StaffSecurityAuditAction =
  | "staff_login"
  | "staff_login_failed"
  | "staff_logout"
  | "staff_pin_reset"
  | "staff_password_reset"
  | "staff_account_created"
  | "staff_account_deleted"
  | "staff_suspended"
  | "staff_reactivated"
  | "staff_device_changed"
  | "staff_account_unlocked"
  | "staff_lockout_triggered"
  | "staff_login_rejected_device"
  | "staff_security_alert";

const ACTION_MAP: Record<StaffSecurityAuditAction, AuditAction> = {
  staff_login: "staff_login",
  staff_login_failed: "staff_login_failed",
  staff_logout: "staff_logout",
  staff_pin_reset: "staff_pin_reset",
  staff_password_reset: "staff_password_reset",
  staff_account_created: "staff_account_created",
  staff_account_deleted: "staff_account_deleted",
  staff_suspended: "staff_suspended",
  staff_reactivated: "staff_reactivated",
  staff_device_changed: "staff_device_changed",
  staff_account_unlocked: "staff_account_unlocked",
  staff_lockout_triggered: "staff_lockout_triggered",
  staff_login_rejected_device: "staff_login_rejected_device",
  staff_security_alert: "staff_security_alert",
};

const SUMMARY: Record<StaffSecurityAuditAction, string> = {
  staff_login: "Staff login",
  staff_login_failed: "Staff login failed",
  staff_logout: "Staff logout",
  staff_pin_reset: "Staff PIN reset",
  staff_password_reset: "Staff password reset",
  staff_account_created: "Staff account created",
  staff_account_deleted: "Staff account deleted",
  staff_suspended: "Staff suspended",
  staff_reactivated: "Staff reactivated",
  staff_device_changed: "Staff device changed",
  staff_account_unlocked: "Staff account unlocked",
  staff_lockout_triggered: "Staff account locked",
  staff_login_rejected_device: "Staff login rejected — unapproved device",
  staff_security_alert: "Staff security alert",
};

export function logStaffSecurityAudit(
  action: StaffSecurityAuditAction,
  payload: Record<string, unknown>,
): void {
  void import("../store/usePosStore").then(({ usePosStore }) => {
    const auditAction = ACTION_MAP[action];
    const enriched = {
      ...payload,
      online: payload.online ?? getDeviceOnline(),
      platform: payload.platform ?? presencePlatform(),
      deviceFingerprint: payload.deviceFingerprint ?? getOrCreateDeviceId(),
      reason: payload.reason ?? SUMMARY[action],
      at: new Date().toISOString(),
    };
    usePosStore.getState().logAuditAction(auditAction, SUMMARY[action], enriched);
  });
}
