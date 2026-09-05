import type { SessionActor } from "./sessionActor";
import { actorHasEffectivePermission, actorHasPermission } from "./actorAuthorization";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

/**
 * Inventory-owned cost / value / profit presentation.
 * `reports.profit` is the financial gate; `stock.adjust` keeps inventory operators
 * (stock keeper, owner/manager) who already mutate cost in the store.
 */
export function actorCanSeeInventoryCostValue(
  actor: SessionActor | null | undefined,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  return (
    actorHasEffectivePermission(actor, "reports.profit", snapshot, authMode) ||
    actorHasPermission(actor, "stock.adjust")
  );
}
