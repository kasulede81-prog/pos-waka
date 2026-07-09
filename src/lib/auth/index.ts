export {
  authenticateStaffLogin,
  buildStaffSessionActor,
  type AuthenticatedStaffSession,
} from "./staffAuthentication";
export {
  lockPos,
  verifyLockScreenPin,
  completePosUnlock,
  emergencyStaffLogout,
  type LockPosReason,
  type UnlockVerifyResult,
} from "./staffLockScreen";
export {
  STAFF_AUTO_LOCK_OPTIONS,
  DEFAULT_STAFF_MAX_FAILED_ATTEMPTS,
  DEFAULT_STAFF_SESSION_TIMEOUT_MINUTES,
  computeSessionExpiresAt,
  getStaffSessionRuntime,
  handleStaffSessionExpired,
  isStaffSessionExpired,
  persistStaffSessionRow,
  readPersistedStaffSession,
  readStaffLastActivity,
  readStaffSessionStartedAt,
  clearStaffSessionPersistence,
  resolveStaffAutoLockMinutes,
  resolveStaffMaxFailedAttempts,
  resolveStaffSessionTimeoutMinutes,
  staffAllowSwitchUser,
  staffRememberSessionEnabled,
  staffRequirePinAfterIdle,
  startStaffSessionClock,
  touchStaffActivity,
  tryRestorePersistedStaffSession,
  type RestoredStaffSession,
  type StaffAutoLockMinutes,
  type StaffSessionRuntime,
} from "./staffSession";
export { logStaffSessionAudit, type StaffSessionAuditEvent } from "./staffSessionAudit";
export {
  UNLOCK_LOCKOUT_SECONDS,
  UNLOCK_MAX_ATTEMPTS,
  clearUnlockFailures,
  getUnlockLockoutStatus,
  recordUnlockFailure,
  unlockLimiterScope,
} from "./staffLoginLimiter";
export { performStaffSwitch, prepareSwitchUserLock } from "./staffSwitchUser";
