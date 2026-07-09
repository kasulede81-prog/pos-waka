export { resolveRoleIndustry, type RoleIndustry } from "./industry";
export {
  ALL_CATALOG_PERMISSIONS,
  PERMISSION_CATEGORIES,
  permissionsByCategory,
  type PermissionCategoryDef,
  type PermissionCategoryId,
} from "./permissionCategories";
export {
  ENTERPRISE_ROLE_TEMPLATES,
  defaultRoleTemplateForIndustry,
  findRoleTemplate,
  roleTemplateLabelKey,
  roleTemplatesForIndustry,
  type EnterpriseRoleTemplate,
  type RoleTemplateId,
  type StaffCreateRole,
} from "./roleTemplates";
export {
  buildCustomRolePermissions,
  resolveStaffPermissions,
  staffHasPermission,
} from "./resolvePermissions";
export {
  PROTECTED_BASE_ROLES,
  cloneCustomRoleFromRole,
  cloneCustomRoleFromTemplate,
  countStaffWithCustomRole,
  createCustomRoleDraft,
  isCustomRoleAssignable,
  normalizeCustomStaffRoleStatus,
  permissionCategoriesForBusiness,
  permissionsFromTemplate,
  roleMatchesPermissionQuery,
  searchRoleCenter,
  summarizePermissionsByCategory,
  type PermissionCategorySummary,
  type RoleSearchMatch,
} from "./customRoles";
export { permissionLabel } from "./permissionLabels";

import type { BusinessType } from "../../types";
import { resolveRoleIndustry } from "./industry";
import { roleTemplatesForIndustry } from "./roleTemplates";

export function roleTemplatesForBusinessType(businessType: BusinessType | null | undefined) {
  return roleTemplatesForIndustry(resolveRoleIndustry(businessType));
}
