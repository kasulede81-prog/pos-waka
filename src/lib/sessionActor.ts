import { hasSupabaseConfig } from "./supabase";
import type { Permission, ShopPreferences, UserRole } from "../types";
import { canUseDevRoleSimulator, resolveAuthRole } from "./permissions";
import { resolveStaffPermissions } from "./enterpriseRoles";
import type { User } from "@supabase/supabase-js";

export type SessionActor = {
  userId: string;
  role: UserRole;
  displayName?: string;
  /** Effective permissions when acting as staff (custom roles / cached snapshot). */
  permissions?: Permission[];
  roleTemplateId?: string | null;
  customRoleId?: string | null;
  customRoleName?: string | null;
};

function devOverrideAllowed(): boolean {
  return !hasSupabaseConfig || Boolean(import.meta.env.DEV);
}

/**
 * `devRoleOverride` in preferences applies only when dev override is allowed and
 * the authenticated role (before override) is owner — avoids cashiers escalating in prod.
 */
export function resolveSessionActor(params: {
  mode: "supabase" | "local";
  user: User | null;
  email: string | null | undefined;
  preferences: ShopPreferences;
  /** From `shop_members` — preferred over user metadata for Supabase sessions. */
  shopMemberRole?: UserRole | null;
  /** Offline staff login — never treat as owner while store hydrates. */
  staffSession?: {
    staffId: string;
    staffName: string;
    role: UserRole;
    permissions?: Permission[];
    roleTemplateId?: string | null;
    customRoleId?: string | null;
  } | null;
}): SessionActor {
  if (params.staffSession) {
    return {
      userId: `staff:${params.staffSession.staffId}`,
      role: params.staffSession.role,
      displayName: params.staffSession.staffName,
      permissions: params.staffSession.permissions,
      roleTemplateId: params.staffSession.roleTemplateId,
      customRoleId: params.staffSession.customRoleId,
    };
  }

  const meta = params.user?.user_metadata as Record<string, unknown> | undefined;
  const authRole = resolveAuthRole({
    mode: params.mode,
    userMetadata: meta,
    shopMemberRole: params.shopMemberRole,
  });
  const devAllowed = devOverrideAllowed();
  const override = params.preferences.devRoleOverride;
  const simulatedRole: UserRole =
    devAllowed && override && canUseDevRoleSimulator(authRole) ? override : authRole;
  /** Owner switched to a staff profile on this device (lock screen / switch user). */
  const activeStaff =
    authRole === "owner" && params.preferences.activeStaffId
      ? (params.preferences.staffAccounts ?? []).find(
          (s) => s.id === params.preferences.activeStaffId && s.active,
        )
      : undefined;
  const role: UserRole = activeStaff?.role ?? simulatedRole;
  const customRoleName =
    activeStaff?.customRoleId != null
      ? (params.preferences.customStaffRoles ?? []).find((r) => r.id === activeStaff.customRoleId)?.name
      : undefined;
  const staffPermissions = activeStaff
    ? resolveStaffPermissions(activeStaff, params.preferences.customStaffRoles)
    : undefined;

  const baseUserId =
    params.user?.id ?? (params.email ? `local:${params.email.trim().toLowerCase()}` : "local:anonymous");
  const userId = activeStaff ? `staff:${activeStaff.id}` : baseUserId;

  const displayName =
    activeStaff?.name ||
    (params.user?.user_metadata as Record<string, string> | undefined)?.full_name?.trim() ||
    params.user?.email ||
    params.email ||
    undefined;

  return {
    userId,
    role,
    displayName,
    permissions: staffPermissions,
    roleTemplateId: activeStaff?.roleTemplateId,
    customRoleId: activeStaff?.customRoleId,
    customRoleName,
  };
}
