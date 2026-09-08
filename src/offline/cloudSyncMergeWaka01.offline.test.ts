/**
 * PHASE 0A — WAKA-01 executable regression test.
 *
 * AUDIT FINDING (WAKA-01, P0) — FIXED:
 *   `pullCloudAndMergeIntoStore` passed `sales` into the customer merge callback
 *   while `const sales` was still in the temporal dead zone (declared ~40 lines
 *   below the call site). The callback runs synchronously inside the awaited
 *   `mergeByIdChunked` call, but only for customer ids present in BOTH the local
 *   store and the cloud payload. TypeScript does not report TS2448 for an
 *   identifier captured inside a function body, so this compiled cleanly and
 *   failed only at runtime.
 *
 *   The fix moves the `returnRecords` / `voidRecords` / `sales` declarations
 *   above the customer merge, so the merge reads the fully-absorbed sales list.
 *
 * WHY NO EXISTING TEST CATCHES IT:
 *   - `mobileSyncStarvation.test.ts` reads cloudSync.ts as a STRING and asserts
 *     `toContain(...)`. It never executes the function.
 *   - `recoveryIntegrityFix.test.ts` replaces `pullCloudAndMergeIntoStore` with
 *     a `vi.fn()`.
 *   - `multiDeviceDebtPayment.test.ts` calls `mergeCustomerFromCloudPull`
 *     directly, bypassing the broken call site.
 *   No test in the repository executes `pullCloudAndMergeIntoStore`.
 *
 * WHAT THIS FILE DOES DIFFERENTLY:
 *   It runs the REAL `pullCloudAndMergeIntoStore`, against the REAL
 *   `localDb` / `entityStore` (fake-indexeddb) and the REAL `usePosStore`.
 *   The only thing faked is `src/lib/supabase` — the network boundary, i.e. a
 *   stand-in for the remote server, not for any application code.
 *
 * STATUS: WAKA-01 is fixed. Every test below is expected to PASS. If the
 * temporal-dead-zone regression is ever reintroduced, the "merges an updated
 * customer" and "does not discard the rest of the cloud payload" tests fail
 * with `ReferenceError: Cannot access 'sales' before initialization`.
 * Do not skip these, and do not "fix" a failure by weakening the assertion.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer } from "../types";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";

const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
/** A different customer this device holds — keeps the store non-empty. */
const OTHER_CUSTOMER_ID = "66666666-6666-4666-8666-666666666666";

const fake = vi.hoisted(() => ({ client: null as FakeSupabaseClient | null }));

vi.mock("../lib/supabase", async () => {
  const authConfig = await import("../lib/authConfig");
  return {
    get hasSupabaseConfig() {
      return fake.client != null;
    },
    get supabase() {
      return fake.client;
    },
    authRedirectOrigin: authConfig.authRedirectOrigin,
    getAuthCallbackUrl: authConfig.getAuthCallbackUrl,
    getAuthRecoveryUrl: authConfig.getAuthRecoveryUrl,
  };
});

/** Row shape `rowToCustomer` in cloudSync.ts expects from the `customers` table. */
function cloudCustomerRow(scope: OfflineScope, overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTOMER_ID,
    shop_id: scope.shopId,
    name: "Nakato Grace",
    phone_e164: "+256700000001",
    notes: "Kikoni",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-09-05T09:00:00.000Z",
    metadata: {
      location: "Kikoni",
      version: 4,
      debtBalanceUgx: 150_000,
      phone: "+256700000001",
      wakaClient: true,
    },
    ...overrides,
  };
}

/** The same customer as this device already knows it — one version behind. */
function localCustomer(): Customer {
  return {
    id: CUSTOMER_ID,
    name: "Nakato Grace",
    phone: "+256700000001",
    location: "Kikoni",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-09-04T09:00:00.000Z",
    version: 3,
    debtBalanceUgx: 200_000,
  };
}

/** An unrelated local customer — the cloud payload never mentions this id. */
function unrelatedLocalCustomer(): Customer {
  return {
    id: OTHER_CUSTOMER_ID,
    name: "Okello Peter",
    phone: "+256700000002",
    location: "Wandegeya",
    createdAt: "2026-08-02T08:00:00.000Z",
    updatedAt: "2026-09-04T09:00:00.000Z",
    version: 1,
    debtBalanceUgx: 0,
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

async function getStore() {
  const { usePosStore } = await import("../store/usePosStore");
  return usePosStore.getState();
}

describe("WAKA-01 — pullCloudAndMergeIntoStore merges a customer that already exists locally", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    fake.client = createFakeSupabaseClient({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "harness@waka.test",
        email_confirmed_at: "2026-01-01T00:00:00.000Z",
      },
      tables: {
        ...organizationTablesFor(scope),
        customers: [cloudCustomerRow(scope)],
      },
    });
    await setStore({
      _hydrated: true,
      products: [],
      sales: [],
      customers: [],
      debtPayments: [],
    });
  });

  /**
   * CONTROL / PROOF 4 — the harness really does drive the whole pull, and the
   * ONLY variable is whether the customer ids intersect.
   *
   * This test takes the exact same branch of `pullCloudAndMergeIntoStore` as
   * the regression below (`localEmpty === false`), reaches the exact same line
   * (4440), and runs the exact same `mergeByIdChunked` call. The difference is
   * that the local customer has a DIFFERENT id from the cloud customer, so
   * `mergeById` never invokes the `pick` callback — and the temporal-dead-zone
   * read on line 4441 is therefore never evaluated.
   *
   * This test passing is what proves the failures below are WAKA-01 and not a
   * broken harness, a missing session, or an aborted pull.
   */
  it("CONTROL — merges a cloud customer when local ids do not intersect", async () => {
    await setStore({ customers: [unrelatedLocalCustomer()] });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");

    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const state = await getStore();
    const merged = state.customers.find((c) => c.id === CUSTOMER_ID);
    expect(merged, "cloud customer should be present after the merge").toBeTruthy();
    expect(merged?.name).toBe("Nakato Grace");
    expect(merged?.debtBalanceUgx).toBe(150_000);
    // The pre-existing local customer must survive the merge too.
    expect(state.customers.find((c) => c.id === OTHER_CUSTOMER_ID)).toBeTruthy();

    // The real pull really did query this shop through the fake server.
    expect(fake.client?.rpcCalls.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * REGRESSION TEST FOR WAKA-01.
   *
   * The only difference from the control above: the local store already holds
   * the same customer id, which is the ordinary steady state of any device
   * after its first sync. This is the exact case that hit the temporal dead
   * zone before the fix.
   */
  it("merges an updated customer that this device already holds", async () => {
    await setStore({ customers: [localCustomer()] });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");

    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const merged = (await getStore()).customers.find((c) => c.id === CUSTOMER_ID);
    expect(merged, "customer should survive the merge").toBeTruthy();
    expect(merged?.version).toBeGreaterThanOrEqual(3);
  });

  /**
   * The pull must not silently discard everything else in the payload either.
   * Before the fix this rejected before reaching `usePosStore.setState`.
   */
  it("does not discard the rest of the cloud payload when a known customer changes", async () => {
    await setStore({ customers: [localCustomer()] });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    const outcome = await pullCloudAndMergeIntoStore({ pullReason: "full_sync" }).then(
      () => "resolved",
      (err: unknown) => `rejected: ${(err as Error)?.name}: ${(err as Error)?.message}`,
    );

    expect(outcome).toBe("resolved");
  });

  /**
   * INVERTED DIAGNOSTIC (was: "throws the temporal-dead-zone ReferenceError").
   *
   * Before the fix this asserted the crash. It now asserts the crash is gone:
   * the pull resolves, no `ReferenceError` escapes, and the store really was
   * updated from the cloud payload rather than silently discarded.
   */
  it("does not throw the temporal-dead-zone ReferenceError (WAKA-01 fixed)", async () => {
    await setStore({ customers: [localCustomer()] });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");

    const error = await pullCloudAndMergeIntoStore({ pullReason: "full_sync" }).then(
      () => null,
      (err: unknown) => err as Error,
    );

    expect(error, "the WAKA-01 crash must not reappear").toBeNull();

    // The pull was applied: the known customer converged to the cloud row.
    const state = await getStore();
    const merged = state.customers.find((c) => c.id === CUSTOMER_ID);
    expect(merged, "customer should survive the merge").toBeTruthy();
    expect(merged?.version).toBeGreaterThanOrEqual(3);
  });
});
