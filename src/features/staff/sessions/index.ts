/**
 * Staff feature — sessions surface (re-exports only).
 * Login, lock screen, offline PIN auth, SessionActor helpers.
 * Phase 2: no logic moved.
 */
export {
  resolveSessionActor,
  authOperatorRole,
  authMembershipRole,
  authOperatorPermissions,
  isPathSOperatingStaff,
  shiftOwnerUserId,
  normalizeLinkedAuthUserId,
  commercialAuthUserIdFromActor,
  type SessionActor,
} from "../../../lib/sessionActor";

export {
  authenticateStaffLogin,
  buildStaffSessionActor,
  lockPos,
  verifyLockScreenPin,
  completePosUnlock,
  emergencyStaffLogout,
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
  isPosAutoLockEnabled,
  startStaffSessionClock,
  touchStaffActivity,
  tryRestorePersistedStaffSession,
  UNLOCK_LOCKOUT_SECONDS,
  UNLOCK_MAX_ATTEMPTS,
  clearUnlockFailures,
  getUnlockLockoutStatus,
  recordUnlockFailure,
  unlockLimiterScope,
  performStaffSwitch,
  prepareSwitchUserLock,
  type AuthenticatedStaffSession,
  type LockPosReason,
  type UnlockVerifyResult,
  type RestoredStaffSession,
  type StaffAutoLockMinutes,
  type StaffSessionRuntime,
} from "../../../lib/auth";

export {
  isSharedTerminalLockOperator,
  shouldShowEnterpriseStaffLockScreen,
  shouldSuppressPosLockScreen,
  canLockPos,
  isBackOfficePinConfigured,
  activeStaffCanUnlock,
} from "../../../lib/lockPos";

export {
  authenticateOfflineStaff,
  listCachedShopsForStaffLogin,
  listActiveSellersForStaffLogin,
  readStaffSession,
  writeStaffSession,
  clearStaffSession,
  clearStaffAuth,
  readRememberedStaffDevice,
  clearRememberedStaffDevice,
  type CachedShop,
  type StaffLoginInput,
  type StaffAuthResult,
  type RememberedStaffDevice,
  type PersistedStaffSession,
  StaffCacheMissingError,
  StaffCredentialRecoveryRequiredError,
} from "../../../lib/staffOfflineAuth";

export {
  filterActiveSellersForPicker,
  findSellerPickerOption,
  type SellerPickerOption,
} from "../../../lib/staffSellerPicker";
