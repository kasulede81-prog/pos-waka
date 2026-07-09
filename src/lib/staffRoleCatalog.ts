import type { BusinessType } from "../types";
import {
  defaultRoleTemplateForIndustry,
  findRoleTemplate,
  resolveRoleIndustry,
  roleTemplatesForBusinessType,
  type EnterpriseRoleTemplate,
  type StaffCreateRole,
} from "./enterpriseRoles";

export type { StaffCreateRole };

export type StaffRoleCardDef = EnterpriseRoleTemplate;

export function staffCreateRolesForBusiness(businessType: BusinessType | null | undefined): StaffRoleCardDef[] {
  return roleTemplatesForBusinessType(businessType);
}

export function staffRoleCard(templateId: string, businessType?: BusinessType | null): StaffRoleCardDef {
  return findRoleTemplate(templateId) ?? defaultRoleTemplateForIndustry(resolveRoleIndustry(businessType));
}

/** Default retail templates — used where business type is unavailable. */
export const STAFF_CREATE_ROLES: StaffRoleCardDef[] = roleTemplatesForBusinessType("kiosk_duka");

export {
  generateStaffPin,
  staffInitials,
  roleAccentClasses,
  roleIconClasses,
  STAFF_OWNER_ROLE_CARD,
  WIZARD_STEPS,
  stepIndex,
  stepLabelKey,
  type StaffWizardStep,
} from "./staffRoleCatalogUi";

/** Host role — maps to waiter permissions (Phase 7.1). */
export { STAFF_HOST_ROLE_CARD, STAFF_CLEANER_ROLE_CARD } from "./staffRoleCatalogLegacy";
