import type { BusinessType, CustomStaffRole, CustomStaffRoleStatus, Language, Permission, StaffAccount, UserRole } from "../../types";
import { permissionsForRole } from "../permissions";
import { resolveRoleIndustry } from "./industry";
import { PERMISSION_CATEGORIES, type PermissionCategoryDef, type PermissionCategoryId } from "./permissionCategories";
import { findRoleTemplate, type EnterpriseRoleTemplate } from "./roleTemplates";
import { permissionLabel } from "./permissionLabels";

export const PROTECTED_BASE_ROLES: UserRole[] = [
  "owner",
  "manager",
  "cashier",
  "stock_keeper",
  "supervisor",
  "waiter",
  "kitchen",
  "bar",
];

export function normalizeCustomStaffRoleStatus(status: unknown): CustomStaffRoleStatus {
  if (status === "disabled" || status === "archived") return status;
  return "active";
}

export function isCustomRoleAssignable(role: CustomStaffRole): boolean {
  return normalizeCustomStaffRoleStatus(role.status) === "active";
}

export function countStaffWithCustomRole(staff: StaffAccount[] | undefined, roleId: string): number {
  return (staff ?? []).filter((s) => s.active && s.customRoleId === roleId).length;
}

export function permissionCategoriesForBusiness(businessType: BusinessType | null | undefined): PermissionCategoryDef[] {
  const industry = resolveRoleIndustry(businessType);
  return PERMISSION_CATEGORIES.filter((cat) => {
    if (cat.id === "system" || cat.permissions.length === 0) return false;
    if (cat.id === "pharmacy" && industry !== "pharmacy") return false;
    if (cat.id === "hospitality" && industry !== "hospitality") return false;
    return true;
  });
}

export type PermissionCategorySummary = {
  id: PermissionCategoryId;
  labelKey: string;
  count: number;
};

export function summarizePermissionsByCategory(
  permissions: Permission[],
  businessType: BusinessType | null | undefined,
): PermissionCategorySummary[] {
  const set = new Set(permissions);
  return permissionCategoriesForBusiness(businessType)
    .map((cat) => ({
      id: cat.id,
      labelKey: cat.labelKey,
      count: cat.permissions.filter((p) => set.has(p)).length,
    }))
    .filter((row) => row.count > 0);
}

export function permissionsFromTemplate(template: EnterpriseRoleTemplate): Permission[] {
  return permissionsForRole(template.baseRole);
}

export function createCustomRoleDraft(input: {
  name: string;
  inheritsFrom: UserRole;
  permissions: Permission[];
  sourceTemplateId?: string | null;
  clonedFromRoleId?: string | null;
}): CustomStaffRole {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    inheritsFrom: input.inheritsFrom,
    permissions: [...input.permissions],
    status: "active",
    sourceTemplateId: input.sourceTemplateId ?? null,
    clonedFromRoleId: input.clonedFromRoleId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneCustomRoleFromTemplate(
  template: EnterpriseRoleTemplate,
  name: string,
): CustomStaffRole {
  return createCustomRoleDraft({
    name,
    inheritsFrom: template.baseRole,
    permissions: permissionsFromTemplate(template),
    sourceTemplateId: template.id,
  });
}

export function cloneCustomRoleFromRole(source: CustomStaffRole, name: string): CustomStaffRole {
  return createCustomRoleDraft({
    name,
    inheritsFrom: source.inheritsFrom,
    permissions: [...source.permissions],
    clonedFromRoleId: source.id,
    sourceTemplateId: source.sourceTemplateId ?? null,
  });
}

export type RoleSearchMatch =
  | { kind: "system"; templateId: string }
  | { kind: "custom"; roleId: string }
  | { kind: "staff"; staffId: string };

export function searchRoleCenter(opts: {
  query: string;
  businessType: BusinessType;
  customRoles: CustomStaffRole[];
  staff: StaffAccount[];
  systemTemplates: EnterpriseRoleTemplate[];
}): RoleSearchMatch[] {
  const q = opts.query.trim().toLowerCase();
  if (!q) return [];

  const matches: RoleSearchMatch[] = [];
  for (const tpl of opts.systemTemplates) {
    if (tpl.id.toLowerCase().includes(q) || tpl.baseRole.includes(q)) {
      matches.push({ kind: "system", templateId: tpl.id });
    }
  }
  for (const role of opts.customRoles) {
    if (role.name.toLowerCase().includes(q)) {
      matches.push({ kind: "custom", roleId: role.id });
    }
  }
  for (const member of opts.staff) {
    if (member.name.toLowerCase().includes(q)) {
      matches.push({ kind: "staff", staffId: member.id });
    }
    const custom = opts.customRoles.find((r) => r.id === member.customRoleId);
    if (custom && custom.name.toLowerCase().includes(q)) {
      matches.push({ kind: "staff", staffId: member.id });
    }
    const tpl = findRoleTemplate(member.roleTemplateId);
    if (tpl && tpl.id.toLowerCase().includes(q)) {
      matches.push({ kind: "staff", staffId: member.id });
    }
  }
  return matches;
}

export function roleMatchesPermissionQuery(
  permissions: Permission[],
  query: string,
  _businessType: BusinessType,
  lang: Language,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return permissions.some((p) => {
    if (p.toLowerCase().includes(q)) return true;
    return permissionLabel(lang, p).toLowerCase().includes(q);
  });
}
