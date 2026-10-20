/**
 * Hospitality prep-batch access contract.
 *
 * Preparing a batch is an inventory operation (`stock.adjust`), not a shop
 * configuration edit. The Inventory entry point uses this contract so a stock
 * keeper / manager can prepare, waste and cancel batches without gaining the
 * `settings.shop` gate that protects recipes, product kinds and menu sections.
 */
import type { Product } from "../types";
import type { SessionActor } from "./sessionActor";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";
import { actorHasEffectivePermission } from "./actorAuthorization";
import { effectiveRecipe, productPrepMode } from "./recipeEngine";
import { productMenuConfig } from "./menuModifiers";

export type HospitalityPrepAccess = {
  /** Recorded batch preparation / waste / cancellation. */
  canPrepareBatches: boolean;
  /** Recipe, product-kind, menu-section and other Menu Builder edits. */
  canConfigureMenu: boolean;
};

export function resolveHospitalityPrepAccess(
  actor: SessionActor | null | undefined,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): HospitalityPrepAccess {
  return {
    canPrepareBatches: actorHasEffectivePermission(actor, "stock.adjust", snapshot, authMode),
    canConfigureMenu: actorHasEffectivePermission(actor, "settings.shop", snapshot, authMode),
  };
}

/**
 * A product the saved batch-preparation action accepts: finished menu item,
 * batch mode already configured by a settings-authorized user, and a recipe.
 * The preparation sheet must never offer to switch a dish's prep mode — that is
 * a Menu Builder configuration edit.
 */
export function isBatchPreparableProduct(product: Product): boolean {
  const menu = productMenuConfig(product);
  if ((menu?.productKind ?? "finished_menu") !== "finished_menu") return false;
  return productPrepMode(product) === "batch_prepared" && effectiveRecipe(product) !== null;
}
