/**
 * Enterprise Permission Engine — session actor is the single runtime authority.
 * Roles remain labels; permission snapshots drive authorization.
 */

import type { Permission } from "../types";
import type { SessionActor } from "./sessionActor";
import { authOperatorPermissions, authOperatorRole } from "./sessionActor";
import { hasActorPermission } from "./permissions";
import { hasEffectivePermission, type SubscriptionSnapshot } from "./subscriptionEntitlements";

/** Role matrix or operator permission snapshot — no subscription tier gate. */
export function actorHasPermission(
  actor: SessionActor | null | undefined,
  permission: Permission,
): boolean {
  if (!actor) return false;
  return hasActorPermission(
    authOperatorRole(actor),
    permission,
    authOperatorPermissions(actor),
  );
}

/** Operator permission + subscription tier — routes, UI, plan-gated store checks. */
export function actorHasEffectivePermission(
  actor: SessionActor | null | undefined,
  permission: Permission,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  if (!actor) return false;
  return hasEffectivePermission(
    authOperatorRole(actor),
    permission,
    snapshot,
    authMode,
    authOperatorPermissions(actor),
  );
}

/** Non-session contexts (search catalog, hooks with role + snapshot). */
export function permissionsHasEffective(
  role: SessionActor["role"],
  permission: Permission,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
  actorPermissions?: Permission[] | null,
): boolean {
  return hasEffectivePermission(role, permission, snapshot, authMode, actorPermissions);
}
