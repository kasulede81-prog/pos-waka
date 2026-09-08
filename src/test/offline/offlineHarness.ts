/**
 * PHASE 0A — helpers for the executable offline test project.
 *
 * These helpers only set up scope and identity. They never stand in for
 * application logic: the real `localDb`, `entityStore`, `syncEngine` and
 * `cloudSync` modules do all the work in every test that uses them.
 *
 * Isolation strategy: each test gets a FRESH shop UUID, which produces a fresh
 * persistence namespace (`sb:<uid>:<shopId>`). Every IndexedDB key in
 * `localDb.ts` / `entityStore.ts` is namespaced, so a new shop id is a clean
 * slate without having to delete and reopen the database (`localDb.ts` caches
 * its connection in a module-level promise, so deleting the database mid-file
 * would leave that cache pointing at a closed connection).
 */

import { setActiveAccountKey } from "../../offline/accountScope";
import { setActiveShopId } from "../../offline/shopScope";

let shopCounter = 0;

/** Deterministic, valid v4-shaped shop UUIDs — `isValidShopId` requires them. */
export function nextShopId(): string {
  shopCounter += 1;
  const tail = String(shopCounter).padStart(12, "0");
  return `11111111-1111-4111-8111-${tail}`;
}

export const HARNESS_USER_ID = "00000000-0000-4000-8000-000000000001";
export const HARNESS_ACCOUNT_KEY = `sb:${HARNESS_USER_ID}`;

export type OfflineScope = {
  userId: string;
  accountKey: string;
  shopId: string;
  namespace: string;
};

/**
 * Activate a clean account + shop scope. Returns the scope so a test can assert
 * on the namespace that the real persistence layer will use.
 */
export function activateOfflineScope(opts?: { shopId?: string }): OfflineScope {
  const shopId = opts?.shopId ?? nextShopId();
  setActiveAccountKey(HARNESS_ACCOUNT_KEY);
  setActiveShopId(shopId);
  try {
    localStorage.clear();
  } catch {
    /* shim always present in this project; tolerate absence */
  }
  return {
    userId: HARNESS_USER_ID,
    accountKey: HARNESS_ACCOUNT_KEY,
    shopId,
    namespace: `${HARNESS_ACCOUNT_KEY}:${shopId}`,
  };
}

export function clearOfflineScope(): void {
  setActiveShopId(null);
  setActiveAccountKey(null);
}

/**
 * Rows that let `resolvePrimaryOrganizationForUser` and
 * `assertOrganizationOperationsAllowed` resolve successfully for this shop.
 *
 * Without these the pull aborts early with `organization_deleted`, and a test
 * would fail for a reason unrelated to what it is testing.
 */
export function organizationTablesFor(scope: OfflineScope): Record<string, unknown[]> {
  return {
    profiles: [{ id: scope.userId, primary_shop_id: scope.shopId }],
    shop_members: [
      {
        shop_id: scope.shopId,
        user_id: scope.userId,
        role: "owner",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    shops: [
      {
        id: scope.shopId,
        organization_id: "22222222-2222-4222-8222-222222222222",
      },
    ],
  };
}
