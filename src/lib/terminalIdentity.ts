import type { ShopPreferences, UserRole } from "../types";
import type { SessionActor } from "./sessionActor";
import { authOperatorRole } from "./sessionActor";

export type TerminalIdentityView = {
  operatorAuthUserId: string;
  sellerUserId: string;
  sellerLinkedAuthUserId: string | null;
  operatorName: string;
  operatorRole: UserRole;
  sellerName: string;
  sellerRole: UserRole;
  /** Owner JWT operating while a PIN staff profile is the commercial seller. */
  splitIdentity: boolean;
};

/** Resolve operator vs commercial seller labels for shared-terminal UX (Phase 11d). */
export function resolveTerminalIdentityView(
  actor: SessionActor,
  preferences: Pick<ShopPreferences, "staffAccounts">,
  jwtOperatorName?: string | null,
): TerminalIdentityView {
  const operatorRole = authOperatorRole(actor);
  const sellerRole = actor.role;
  const activeStaff = actor.activeStaffId
    ? (preferences.staffAccounts ?? []).find((s) => s.id === actor.activeStaffId)
    : null;

  const splitIdentity = Boolean(
    actor.authUserId &&
      actor.userId.startsWith("staff:") &&
      actor.authUserId !== actor.userId,
  );

  const sellerName = splitIdentity
    ? activeStaff?.name?.trim() || actor.displayName?.trim() || "—"
    : jwtOperatorName?.trim() || actor.displayName?.trim() || actor.userId;

  const operatorName = splitIdentity
    ? jwtOperatorName?.trim() || "Owner"
    : sellerName;

  return {
    operatorAuthUserId: actor.authUserId ?? actor.userId,
    sellerUserId: actor.userId,
    sellerLinkedAuthUserId: actor.linkedAuthUserId ?? null,
    operatorName,
    operatorRole,
    sellerName,
    sellerRole,
    splitIdentity,
  };
}
