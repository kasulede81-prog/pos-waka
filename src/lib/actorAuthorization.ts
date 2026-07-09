/**
 * Enterprise Permission Engine — session actor is the single runtime authority.
 * Roles remain labels; permission snapshots drive authorization.
 */

import type { Permission } from "../types";
import type { SessionActor } from "./sessionActor";
import { hasActorPermission } from "./permissions";
import { hasEffectivePermission, type SubscriptionSnapshot } from "./subscriptionEntitlements";

/** Role matrix or staff permission snapshot — no subscription tier gate. */
export function actorHasPermission(
  actor: SessionActor | null | undefined,
  permission: Permission,
): boolean {
  if (!actor) return false;
  return hasActorPermission(actor.role, permission, actor.permissions);
}

/** Permission snapshot + subscription tier — use for routes, UI, and plan-gated store checks. */
export function actorHasEffectivePermission(
  actor: SessionActor | null | undefined,
  permission: Permission,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  if (!actor) return false;
  return hasEffectivePermission(actor.role, permission, snapshot, authMode, actor.permissions);
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
