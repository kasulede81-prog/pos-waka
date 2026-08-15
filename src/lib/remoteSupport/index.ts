export {
  REMOTE_SUPPORT_GRANT_TTL_MS,
  REMOTE_SUPPORT_ONLINE_MS,
  REMOTE_SUPPORT_REASON_CODES,
  REMOTE_SUPPORT_REQUEST_TTL_MS,
  REMOTE_SUPPORT_SUPPORTED_PLATFORMS,
} from "./types";
export type {
  RemoteSupportEndedBy,
  RemoteSupportEvent,
  RemoteSupportInbox,
  RemoteSupportReasonCode,
  RemoteSupportRequest,
  RemoteSupportRequestStatus,
  RemoteSupportRpcResult,
  RemoteSupportSession,
  RemoteSupportSessionStatus,
} from "./types";
export { canTransitionRequest, canTransitionSession, isOpenSessionStatus } from "./stateMachine";
export {
  evaluateRemoteSupportEligibility,
  isRemoteSupportEligible,
  isRemoteSupportRecentlySeen,
  isRemoteSupportSupportedPlatform,
} from "./eligibility";
export type { RemoteSupportEligibilityDevice, RemoteSupportIneligibleReason } from "./eligibility";
export {
  canApproveRemoteSupportRequest,
  canCustomerActOnRequest,
  canCustomerSeeRemoteSupportInbox,
  fingerprintsMatch,
} from "./deviceBinding";
export { assertRemoteSupportGrant, consumeRemoteSupportGrant } from "./grant";
export {
  approveRemoteSupport,
  assertRemoteSupportGrantRpc,
  cancelRemoteSupport,
  declineRemoteSupport,
  endRemoteSupport,
  expireStaleRemoteSupport,
  fetchRemoteSupportCustomerInbox,
  remoteSupportErrorMessage,
  requestRemoteSupport,
  revokeRemoteSupport,
} from "./api";
export {
  getWakaDesktopRemoteSupport,
  nativeStatusFromControlPlane,
} from "./nativeBoundary";
export type {
  RemoteSupportNativeResult,
  RemoteSupportNativeStatus,
  WakaDesktopRemoteSupportApi,
} from "./nativeBoundary";
export { remoteSupportUiPhase } from "./transport";
export type {
  RemoteSupportTransportResult,
  RemoteSupportTransportStatus,
  RemoteSupportUiPhase,
} from "./transport";
