import type { StaffAccount, UserRole } from "../types";
import { invokeSupabaseEdgeFunction } from "./supabaseEdgeInvoke";
import { normalizeLinkedAuthUserId } from "./sessionActor";
import { supabase } from "./supabase";

export const STAFF_INVITE_TOKEN_KEY = "waka.staffInvite.token";

export const STAFF_INVITE_POS_ROLES = [
  "manager",
  "cashier",
  "stock_keeper",
  "supervisor",
  "waiter",
  "kitchen",
  "bar",
] as const;

export type StaffInvitePosRole = (typeof STAFF_INVITE_POS_ROLES)[number];

export type StaffInviteMembershipRole = "manager" | "cashier" | "stock_keeper" | "waiter" | "viewer";

export function membershipRoleForPosRole(posRole: string): StaffInviteMembershipRole {
  if (posRole === "supervisor") return "cashier";
  if (posRole === "kitchen" || posRole === "bar") return "waiter";
  if (posRole === "manager" || posRole === "cashier" || posRole === "stock_keeper" || posRole === "waiter") {
    return posRole;
  }
  return "cashier";
}

/** Map an existing POS staff role onto invite pos_role (never owner). */
export function invitePosRoleForStaff(role: UserRole | string | null | undefined): StaffInvitePosRole {
  const value = String(role ?? "").trim().toLowerCase();
  if ((STAFF_INVITE_POS_ROLES as readonly string[]).includes(value)) {
    return value as StaffInvitePosRole;
  }
  return "cashier";
}

/**
 * Legacy PIN worker eligible for Phase 9 cloud upgrade:
 * active, no linked Auth user_id yet.
 */
export function isLegacyPinStaffUpgradeable(staff: StaffAccount): boolean {
  if (staff.active === false) return false;
  return normalizeLinkedAuthUserId(staff.linkedAuthUserId) == null;
}

export function persistStaffInviteToken(token: string): void {
  const value = token.trim();
  if (!value) return;
  try {
    sessionStorage.setItem(STAFF_INVITE_TOKEN_KEY, value);
  } catch {
    /* quota / private mode */
  }
}

export function peekStaffInviteToken(): string | null {
  try {
    const value = sessionStorage.getItem(STAFF_INVITE_TOKEN_KEY)?.trim() ?? "";
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function clearStaffInviteToken(): void {
  try {
    sessionStorage.removeItem(STAFF_INVITE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export type StaffInviteAcceptResult =
  | { ok: true; shopId: string; membershipRole: string; staffId: string | null; linkedExisting: boolean }
  | { ok: false; error: string };

export async function acceptStaffInviteToken(token: string): Promise<StaffInviteAcceptResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const raw = token.trim();
  if (!raw) return { ok: false, error: "invalid_token" };

  try {
    const { data, error } = await supabase.rpc("shop_accept_staff_invite", { p_token: raw });
    const row = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      shop_id?: string;
      membership_role?: string;
      staff_id?: string | null;
      linked_existing?: boolean;
    };
    if (error) return { ok: false, error: error.message || "accept_failed" };
    if (row.ok !== true || !row.shop_id) {
      return { ok: false, error: String(row.error ?? "accept_failed") };
    }
    return {
      ok: true,
      shopId: row.shop_id,
      membershipRole: String(row.membership_role ?? ""),
      staffId: row.staff_id ?? null,
      linkedExisting: row.linked_existing === true,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error && err.message.trim() ? err.message : "accept_failed",
    };
  }
}

export async function hasPendingStaffInviteForMe(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_has_pending_staff_invite_for_me");
  if (error) return false;
  return data === true;
}

export async function sendStaffInvite(input: {
  shopId: string;
  email: string;
  posRole: StaffInvitePosRole;
  staffId?: string | null;
}): Promise<{ ok: true; invitationId: string } | { ok: false; message: string }> {
  const result = await invokeSupabaseEdgeFunction<{
    invitation_id?: string;
    email_sent?: boolean;
  }>("staff-invite", {
    shop_id: input.shopId,
    email: input.email.trim().toLowerCase(),
    membership_role: membershipRoleForPosRole(input.posRole),
    pos_role: input.posRole,
    staff_id: input.staffId || null,
  });
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  const invitationId = String(result.data.invitation_id ?? "");
  if (!invitationId) return { ok: false, message: "Invite was not created." };
  return { ok: true, invitationId };
}

export type StaffInvitationRow = {
  id: string;
  email: string;
  membership_role: string;
  pos_role: string;
  staff_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export function staffHasPendingUpgradeInvite(
  staff: StaffAccount,
  invites: StaffInvitationRow[],
): boolean {
  const email = (staff.email ?? "").trim().toLowerCase();
  if (!email) return false;
  return invites.some(
    (invite) =>
      !invite.accepted_at &&
      !invite.revoked_at &&
      invite.staff_id != null &&
      invite.email.trim().toLowerCase() === email,
  );
}

export async function listStaffInvitations(shopId: string): Promise<StaffInvitationRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("shop_list_staff_invitations", { p_shop_id: shopId });
  const row = (data ?? {}) as { ok?: boolean; invitations?: StaffInvitationRow[] };
  if (error || row.ok !== true) return [];
  return Array.isArray(row.invitations) ? row.invitations : [];
}

export async function revokeStaffInvitation(invitationId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("shop_revoke_staff_invite", { p_invitation_id: invitationId });
  const row = (data ?? {}) as { ok?: boolean };
  return !error && row.ok === true;
}

export function staffAcceptReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://pos.waka.ug");
    if (url.pathname === "/staff/accept") {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Same-browser login return that preserves the invitation token in `next`.
 * Token is also mirrored to sessionStorage by StaffAcceptPage; this keeps URL recovery intact.
 */
export function staffAcceptLoginHref(token: string | null | undefined): string {
  const trimmed = (token ?? "").trim();
  const next = trimmed
    ? `/staff/accept?token=${encodeURIComponent(trimmed)}`
    : "/staff/accept";
  return `/login?next=${encodeURIComponent(next)}`;
}
