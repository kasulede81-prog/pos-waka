/**
 * Staff feature — roles & permissions surface (re-exports only).
 * Phase 3 adds can(actor, action) facade — does not remove legacy helpers.
 */
export {
  FAIL_CLOSED_ROLE,
  normalizeUserRole,
  parseRoleFromUserMetadata,
  logRoleResolutionFailure,
  resolveAuthRole,
  hasPermission,
  permissionsForRole,
  hasActorPermission,
  canUseDevRoleSimulator,
  canTogglePosUiMode,
} from "../../../lib/permissions";

export {
  actorHasPermission,
  actorHasEffectivePermission,
  permissionsHasEffective,
} from "../../../lib/actorAuthorization";

export {
  can,
  permissionForStaffAction,
  STAFF_ACTION_TO_PERMISSION,
  type StaffAction,
} from "./can";

export * from "../../../lib/enterpriseRoles";

export {
  STAFF_LOGIN_ROLES,
  isStaffLoginRole,
  staffLoginRoleLabel,
  staffLoginRoleMatches,
  type StaffLoginRole,
} from "../../../lib/staffLoginRoles";

/** Catalog helpers only — avoids re-exporting enterpriseRoles symbols twice. */
export {
  staffCreateRolesForBusiness,
  staffRoleCard,
  STAFF_CREATE_ROLES,
  STAFF_HOST_ROLE_CARD,
  STAFF_CLEANER_ROLE_CARD,
  type StaffRoleCardDef,
} from "../../../lib/staffRoleCatalog";

export {
  generateStaffPin,
  staffInitials,
  roleAccentClasses,
  roleIconClasses,
  stepIndex,
  WIZARD_STEPS,
  stepLabelKey,
  STAFF_OWNER_ROLE_CARD,
  type StaffWizardStep,
} from "../../../lib/staffRoleCatalogUi";

export {
  StaffAccountAuthorizationError,
  authorizeStaffAccountMutation,
  authorizeStaffAccountMutationWithDevice,
  assertStaffAccountMutationAllowed,
  assertStaffAccountMutationAllowedAsync,
} from "../../../lib/staffAccountAuthorization";

export {
  validateStaffAccountsPatch,
  validateCanAddStaffAccount,
} from "../../../lib/staffPlanEnforcement";
