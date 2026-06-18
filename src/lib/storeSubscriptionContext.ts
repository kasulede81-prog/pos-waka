/**
 * Bridge subscription state from React into store-layer authorization (no React in the store).
 */

import type { SubscriptionSnapshot } from "./subscriptionEntitlements";

export type StoreSubscriptionContext = {
  snapshot: SubscriptionSnapshot;
  authMode: "supabase" | "local";
};

let ctx: StoreSubscriptionContext = {
  snapshot: { kind: "local_full" },
  authMode: "local",
};

export function setStoreSubscriptionContext(next: StoreSubscriptionContext): void {
  ctx = next;
}

export function getStoreSubscriptionContext(): StoreSubscriptionContext {
  return ctx;
}
