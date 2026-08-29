import { hasSupabaseConfig } from "./supabase";
import type { Permission, ShopPreferences, UserRole } from "../types";
import { canUseDevRoleSimulator, resolveAuthRole } from "./permissions";
import { resolveStaffPermissions } from "./enterpriseRoles";
import type { User } from "@supabase/supabase-js";

export type SessionActor = {
  /** Commercial seller id — `staff:<id>` on shared-terminal PIN (Path S); frozen. */
  userId: string;
  /** Seller-facing role for POS sell context (may differ from authenticated operator). */
  role: UserRole;
  displayName?: string;
  /** Seller permission snapshot (custom staff roles / cached snapshot). */
  permissions?: Permission[];
  roleTemplateId?: string | null;
  customRoleId?: string | null;
  customRoleName?: string | null;
  /**
   * Commercial Auth seller for shared-terminal PIN (Path S).
   * Set when `userId` is `staff:<id>` and the profile has `linkedAuthUserId`.
   * Never replaces `userId`.
   */
  linkedAuthUserId?: string | null;
  /** Authenticated writer / device operator (JWT or Path L staff session). */
  authUserId?: string;
  /**
   * Shop membership / JWT role — never downgraded when owner selects PIN staff.
   * Not the permission operator on Path S; use `authOperatorRole`.
   */
  authRole?: UserRole;
  /** JWT/membership permission snapshot (Path L / Auth cashier). */
  authPermissions?: Permission[];
  /** Active PIN staff on shared terminal (`preferences.activeStaffId`). */
  activeStaffId?: string | null;
};

/**
 * Owner JWT + PIN staff on a shared terminal (Path S).
 * `authUserId` stays the shop account; `userId` is `staff:<id>`.
 */
export function isPathSOperatingStaff(
  actor: Pick<SessionActor, "userId" | "authUserId">,
): boolean {
  const authId = actor.authUserId?.trim() ?? "";
  const userId = actor.userId?.trim() ?? "";
  return Boolean(authId && userId.startsWith("staff:") && authId !== userId);
}

/**
 * JWT / shop_members role — never downgraded on Path S PIN.
 * Use for shared-terminal lock detection and cloud writer identity, not UI permission gates.
 */
export function authMembershipRole(actor: Pick<SessionActor, "authRole" | "role">): UserRole {
  return actor.authRole ?? actor.role;
}

/**
 * Effective operating role for routes, store actions, home, and receipts.
 * Path S PIN staff uses seller `role` (least privilege). Auth cashier / Path L unchanged.
 */
export function authOperatorRole(
  actor: Pick<SessionActor, "authRole" | "role" | "userId" | "authUserId">,
): UserRole {
  if (isPathSOperatingStaff(actor)) return actor.role;
  return actor.authRole ?? actor.role;
}

/**
 * Effective operator permission snapshot.
 * Path S PIN staff uses the staff row snapshot; otherwise JWT `authPermissions`.
 */
export function authOperatorPermissions(
  actor: Pick<SessionActor, "authPermissions" | "permissions" | "userId" | "authUserId">,
): Permission[] | undefined {
  if (isPathSOperatingStaff(actor)) return actor.permissions;
  return actor.authPermissions;
}

/**
 * Shift owner id — authenticated writer (Phase 11b).
 * Path S: owner UUID while seller is `staff:<id>`. Path L / Auth cashier: same as `userId`.
 */
export function shiftOwnerUserId(
  actor: Pick<SessionActor, "authUserId" | "userId"> | null | undefined,
): string | null {
  if (!actor) return null;
  const writer = actor.authUserId?.trim() ?? "";
  if (writer) return writer;
  return actor.userId;
}

function isAuthUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/** Normalize a linked Auth UUID from staff profile or session. */
export function normalizeLinkedAuthUserId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return isAuthUuid(trimmed) ? trimmed : null;
}

/**
 * Commercial seller Auth UUID for cloud push.
 * Prefer explicit link; Auth cashiers already use UUID `userId`.
 */
export function commercialAuthUserIdFromActor(
  actor: Pick<SessionActor, "userId" | "linkedAuthUserId"> | null | undefined,
): string | null {
  if (!actor) return null;
  const linked = normalizeLinkedAuthUserId(actor.linkedAuthUserId);
  if (linked) return linked;
  return isAuthUuid(actor.userId) ? actor.userId : null;
}

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
    linkedAuthUserId?: string | null;
  } | null;
}): SessionActor {
  if (params.staffSession) {
    const fromSession = normalizeLinkedAuthUserId(params.staffSession.linkedAuthUserId);
    const fromAccount = normalizeLinkedAuthUserId(
      (params.preferences.staffAccounts ?? []).find((s) => s.id === params.staffSession!.staffId)
        ?.linkedAuthUserId,
    );
    const staffUserId = `staff:${params.staffSession.staffId}`;
    return {
      userId: staffUserId,
      role: params.staffSession.role,
      displayName: params.staffSession.staffName,
      permissions: params.staffSession.permissions,
      roleTemplateId: params.staffSession.roleTemplateId,
      customRoleId: params.staffSession.customRoleId,
      linkedAuthUserId: fromSession ?? fromAccount,
      authUserId: staffUserId,
      authRole: params.staffSession.role,
      authPermissions: params.staffSession.permissions,
      activeStaffId: params.staffSession.staffId,
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
    linkedAuthUserId: activeStaff
      ? normalizeLinkedAuthUserId(activeStaff.linkedAuthUserId)
      : normalizeLinkedAuthUserId(params.user?.id),
    authUserId: baseUserId,
    authRole: simulatedRole,
    activeStaffId: activeStaff?.id ?? params.preferences.activeStaffId ?? null,
  };
}
