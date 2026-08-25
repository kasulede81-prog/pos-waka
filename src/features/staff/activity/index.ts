/**
 * Staff feature — activity / audit surface (re-exports only).
 * Phase 2: no logic moved; unify call sites later.
 */
export {
  logStaffSecurityAudit,
  type StaffSecurityAuditAction,
} from "../../../lib/staffSecurityAudit";

export {
  logStaffSessionAudit,
  type StaffSessionAuditEvent,
} from "../../../lib/auth/staffSessionAudit";
