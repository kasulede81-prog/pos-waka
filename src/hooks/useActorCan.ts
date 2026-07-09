import { useCallback } from "react";
import type { Permission } from "../types";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { actorHasEffectivePermission, actorHasPermission } from "../lib/actorAuthorization";

/** Cached actor permission checks for UI — tier-aware `can` and snapshot-only `canRole`. */
export function useActorCan() {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();

  const can = useCallback(
    (permission: Permission) => actorHasEffectivePermission(actor, permission, snapshot, authMode),
    [actor, snapshot, authMode],
  );

  const canRole = useCallback(
    (permission: Permission) => actorHasPermission(actor, permission),
    [actor],
  );

  return { actor, can, canRole, snapshot, authMode };
}
