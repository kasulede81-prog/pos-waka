/**
 * Staff feature — identity surface (re-exports only).
 * Profiles, invitations, auth↔profile mapping, hydration.
 * Phase 2: no logic moved; import from here or keep existing lib paths.
 */
export {
  STAFF_INVITE_TOKEN_KEY,
  STAFF_INVITE_POS_ROLES,
  membershipRoleForPosRole,
  invitePosRoleForStaff,
  isLegacyPinStaffUpgradeable,
  persistStaffInviteToken,
  peekStaffInviteToken,
  clearStaffInviteToken,
  acceptStaffInviteToken,
  hasPendingStaffInviteForMe,
  sendStaffInvite,
  staffHasPendingUpgradeInvite,
  listStaffInvitations,
  revokeStaffInvitation,
  staffAcceptReturnPath,
  staffAcceptLoginHref,
  type StaffInvitePosRole,
  type StaffInviteMembershipRole,
  type StaffInviteAcceptResult,
  type StaffInvitationRow,
} from "../../../lib/staffInvite";

export {
  runStaffInviteAcceptFlow,
  type StaffInviteAcceptFlowResult,
} from "../../../lib/staffInviteAcceptFlow";

export {
  resolveStaffInviteBeforeOwnerBootstrap,
  type StaffInviteBootstrapGate,
} from "../../../lib/staffInviteOnboarding";

export {
  hydrateStaffAuthWorkspace,
  clearPersonalStaffTerminalRuntimeState,
  isNonOwnerShopMemberRole,
} from "../../../lib/staffAuthHydrate";

export {
  fetchShopMemberRoleForUser,
  SHOP_MEMBER_ROLE_FETCH_TIMEOUT_MS,
} from "../../../lib/shopMemberRole";

export {
  generateStaffUsername,
} from "../../../lib/staffAccountHelpers";

export {
  hydrateStaffTeamFromCloud,
} from "../../../lib/staffRecovery";

export {
  isAuthSellerUuid,
  firstAuthSellerUuid,
  soldByUserIdFromCloudSaleRow,
  soldByAuthUserIdFromCloudSaleRow,
  saleSoldByMatchesActor,
  mergeCommercialSellerFields,
  type SellerMatchActor,
} from "../../../lib/sellerIdentity";
