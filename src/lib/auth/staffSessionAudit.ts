/**
 * Phase 13.2 — staff session audit events via existing audit infrastructure.
 */

import type { AuditAction } from "../../types";
import { getOrCreateDeviceId } from "../deviceId";
import { getDeviceOnline } from "../deviceOnline";
import { presencePlatform } from "../shopPresence";

export type StaffSessionAuditEvent =
  | "staff_login"
  | "staff_logout"
  | "staff_lock"
  | "staff_unlock"
  | "staff_login_failed"
  | "staff_switch_user"
  | "staff_session_expired"
  | "staff_auto_lock"
  | "staff_lockout_triggered";

const ACTION_MAP: Record<StaffSessionAuditEvent, AuditAction> = {
  staff_login: "staff_login",
  staff_logout: "staff_logout",
  staff_lock: "pos_lock",
  staff_unlock: "pos_unlock",
  staff_login_failed: "staff_login_failed",
  staff_switch_user: "staff_switch_user",
  staff_session_expired: "staff_session_expired",
  staff_auto_lock: "pos_lock",
  staff_lockout_triggered: "staff_lockout_triggered",
};

const SUMMARY: Record<StaffSessionAuditEvent, string> = {
  staff_login: "Staff login",
  staff_logout: "Staff logout",
  staff_lock: "POS locked",
  staff_unlock: "POS unlocked",
  staff_login_failed: "Staff PIN failed",
  staff_switch_user: "Staff switch user",
  staff_session_expired: "Staff session expired",
  staff_auto_lock: "POS auto-locked",
  staff_lockout_triggered: "Brute-force lock",
};

export function logStaffSessionAudit(
  event: StaffSessionAuditEvent,
  payload: Record<string, unknown> = {},
): void {
  void import("../../store/usePosStore").then(({ usePosStore }) => {
    const auditAction = ACTION_MAP[event];
    const summary =
      typeof payload.summary === "string" && payload.summary.trim()
        ? payload.summary.trim()
        : SUMMARY[event];
    const { summary: _drop, ...restPayload } = payload;
    const enriched = {
      ...restPayload,
      event,
      online: payload.online ?? getDeviceOnline(),
      platform: payload.platform ?? presencePlatform(),
      deviceFingerprint: payload.deviceFingerprint ?? getOrCreateDeviceId(),
      at: new Date().toISOString(),
    };
    usePosStore.getState().logAuditAction(auditAction, summary, enriched);
  });
}
