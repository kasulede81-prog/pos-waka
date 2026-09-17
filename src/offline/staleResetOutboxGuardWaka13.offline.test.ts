/**
 * Admin-reset safety net — outbox (sync queue) protection.
 *
 * ROOT CAUSE: a device that had pending, unsynced product/sale/stock/customer
 * edits queued BEFORE an admin shop-reset would, on its next flush, still try
 * to push those pre-reset mutations. `pushProductCatalogToCloud` upserts on
 * `id` (`onConflict: "id"`), so pushing a pre-reset queued product op would
 * literally re-insert the row the reset just hard-deleted — resurrecting
 * exactly the stale data the reset was meant to remove.
 *
 * THE FIX (`flushSyncQueueInner`, src/offline/syncEngine.ts): before flushing,
 * if the queue holds any op of a "business data" kind
 * (product/sale/pending_sales/pending_stock_updates/stock_move/customer) and
 * this shop has an outstanding, unacknowledged admin force-full-resync signal
 * (`staleForceFullResyncCutoff`), any such op created BEFORE that signal's
 * timestamp is dropped (never pushed) instead of being attempted.
 *
 * This file runs the REAL `flushSyncQueueInner` against REAL IndexedDB
 * (fake-indexeddb). Only `src/lib/supabase` is faked, per the established
 * WAKA offline-test convention (see `cloudSyncMergeWaka01.offline.test.ts`,
 * `syncQueueQuarantineWaka11.offline.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "../types";
import {
  activateOfflineScope,
  HARNESS_USER_ID,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { resetShopCtxTickForTests } from "../lib/shopSyncContext";

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

const RESET_SIGNAL_AT = "2026-09-13T22:01:21.000Z";
const OP_PRE_RESET_PRODUCT = "op-pre-reset-product";
const OP_PRE_RESET_SALE = "op-pre-reset-sale";
const OP_POST_RESET_PRODUCT = "op-post-reset-product";
const OP_NON_GUARDED_KIND = "op-purchase";

function op(
  id: string,
  kind: SyncOperation["kind"],
  createdAt: string,
  shopId: string,
  payload: unknown = { id: `${id}-payload` },
): SyncOperation {
  return {
    id,
    kind,
    payload,
    createdAt,
    attempts: 0,
    lastAttemptAt: null,
    shopId,
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function clientWithSignal(
  scope: OfflineScope,
  forceFullResyncAt: string | null,
  serverNowIso?: string,
): FakeSupabaseClient {
  return createFakeSupabaseClient({
    user: {
      id: HARNESS_USER_ID,
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: organizationTablesFor(scope),
    rpc: {
      shop_fetch_recovery_signal: {
        clear_back_office_pin_at: null,
        clear_staff_credentials_at: null,
        password_reset_requested_at: null,
        force_full_resync_at: forceFullResyncAt,
      },
      ...(serverNowIso ? { shop_server_now: serverNowIso } : {}),
    },
  });
}

describe("Admin-reset safety net — outbox drops stale pre-reset business mutations", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    resetShopCtxTickForTests();
    scope = activateOfflineScope();
    await setStore({
      _hydrated: true,
      products: [],
      sales: [],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
  });

  it("drops a guarded-kind op queued before the reset signal, without ever attempting to push it", async () => {
    fake.client = clientWithSignal(scope, RESET_SIGNAL_AT);
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_PRE_RESET_PRODUCT, "product", "2026-09-10T00:00:00.000Z", scope.shopId));
    await appendSyncOperation(op(OP_PRE_RESET_SALE, "sale", "2026-09-01T00:00:00.000Z", scope.shopId));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_PRE_RESET_PRODUCT)).toBeUndefined();
    expect(remaining.find((r) => r.id === OP_PRE_RESET_SALE)).toBeUndefined();
    // Never delivered: the fake server recorded no push attempt for either op.
    expect(fake.client?.writes.length ?? 0).toBe(0);
  });

  it("keeps a guarded-kind op queued AFTER the reset signal (a genuinely new post-reset edit)", async () => {
    fake.client = clientWithSignal(scope, RESET_SIGNAL_AT);
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_POST_RESET_PRODUCT, "product", "2026-09-14T00:00:00.000Z", scope.shopId));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    // Not silently dropped by the stale-reset guard — it is still durable
    // (a real push attempt may fail against this minimal fake server, which
    // is fine; the point under test is that the drop-on-sight guard did not
    // remove it).
    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_POST_RESET_PRODUCT)).toBeTruthy();
  });

  it("never drops a non-guarded op kind, even if it predates the reset signal", async () => {
    fake.client = clientWithSignal(scope, RESET_SIGNAL_AT);
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    // "pending_shifts" is deliberately unresolvable (no matching shift exists
    // locally), so its handler returns `false` (retry) rather than silently
    // ACKing — that keeps this test's proof (the op survives) about the
    // stale-reset guard specifically, not about an unrelated ACK-if-missing
    // shortcut some other kind's handler happens to take.
    await appendSyncOperation(
      op(OP_NON_GUARDED_KIND, "pending_shifts", "2026-09-01T00:00:00.000Z", scope.shopId, {
        shiftId: "11111111-1111-4111-8111-000000000099",
      }),
    );

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_NON_GUARDED_KIND)).toBeTruthy();
  });

  it("CLOCK SKEW — a device clock running behind the server does not drop a genuinely post-reset op", async () => {
    // Real/server-time story: the reset happens at RESET_SIGNAL_AT, and the
    // user creates a brand-new product 30 minutes later (in real/server
    // time). But this device's clock reads 3 hours BEHIND real time, so the
    // op gets locally stamped as if it happened 2.5 hours BEFORE the reset —
    // a raw string comparison of `op.createdAt < staleResetCutoff` would
    // wrongly treat it as pre-reset and drop it forever.
    const deviceClockBehindMs = 3 * 60 * 60_000;
    const opCreatedAtDeviceClock = new Date(
      Date.parse("2026-09-13T22:31:21.000Z") - deviceClockBehindMs,
    ).toISOString();
    // The fake server's `shop_server_now` reflects the ACTUAL current time
    // (whenever this test runs) plus the same skew, so `fetchShopServerNow()`
    // inside the flush computes the same device-behind-server offset used
    // above, regardless of what day the test suite actually runs on.
    const serverNowIso = new Date(Date.now() + deviceClockBehindMs).toISOString();

    fake.client = clientWithSignal(scope, RESET_SIGNAL_AT, serverNowIso);
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_POST_RESET_PRODUCT, "product", opCreatedAtDeviceClock, scope.shopId));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_POST_RESET_PRODUCT)).toBeTruthy();
  });

  it("REGRESSION — an ordinary flush with no outstanding reset signal drops nothing", async () => {
    fake.client = clientWithSignal(scope, null);
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_PRE_RESET_PRODUCT, "product", "2026-09-01T00:00:00.000Z", scope.shopId));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_PRE_RESET_PRODUCT)).toBeTruthy();
  });

  // P1 remediation (financial certification audit, P1#2): the reset-signal
  // RPC lookup itself can fail (timeout/network error). Before the fix, a
  // failed lookup was treated identically to "no signal" and the op was
  // pushed — a stale pre-reset product/sale/customer/stock op could then
  // resurrect the row the reset had just deleted, with no later pull able to
  // tell it apart from a legitimate server row. The fix holds guarded-kind
  // ops in the queue (neither pushed nor dropped) until a later flush can
  // confirm the actual signal state.
  it("P1 FIX — RPC error on the signal lookup: a guarded-kind op is HELD, not pushed and not dropped", async () => {
    fake.client = createFakeSupabaseClient({
      user: { id: HARNESS_USER_ID, email: "harness@waka.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      tables: organizationTablesFor(scope),
      rpcErrors: { shop_fetch_recovery_signal: new Error("network_error") },
    });
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_PRE_RESET_PRODUCT, "product", "2026-09-10T00:00:00.000Z", scope.shopId));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    // Held, not dropped: still present in the queue afterward.
    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_PRE_RESET_PRODUCT)).toBeTruthy();
    // Held, not pushed: the fake server recorded no write attempt for it.
    expect(fake.client?.writes.length ?? 0).toBe(0);
  });

  it("P1 FIX — RPC timeout on the signal lookup: a guarded-kind op is HELD, not pushed and not dropped", async () => {
    // The real lookup races the RPC against a 4s timeout and rejects on
    // timeout; simulating that as an outright rejection exercises the same
    // catch-and-fail-closed path in resolveStaleResetGuardState.
    fake.client = createFakeSupabaseClient({
      user: { id: HARNESS_USER_ID, email: "harness@waka.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      tables: organizationTablesFor(scope),
      rpcErrors: { shop_fetch_recovery_signal: new Error("recovery_signal_check_timeout") },
    });
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_PRE_RESET_SALE, "sale", "2026-09-10T00:00:00.000Z", scope.shopId));

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const remaining = await readSyncQueue();
    expect(remaining.find((r) => r.id === OP_PRE_RESET_SALE)).toBeTruthy();
    expect(fake.client?.writes.length ?? 0).toBe(0);
  });

  it("P1 FIX — an RPC error only holds guarded-kind ops; non-guarded kinds still flush normally", async () => {
    fake.client = createFakeSupabaseClient({
      user: { id: HARNESS_USER_ID, email: "harness@waka.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      tables: organizationTablesFor(scope),
      rpcErrors: { shop_fetch_recovery_signal: new Error("network_error") },
    });
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await appendSyncOperation(op(OP_PRE_RESET_PRODUCT, "product", "2026-09-10T00:00:00.000Z", scope.shopId));
    await appendSyncOperation(
      op(OP_NON_GUARDED_KIND, "pending_shifts", "2026-09-01T00:00:00.000Z", scope.shopId, {
        shiftId: "11111111-1111-4111-8111-000000000099",
      }),
    );

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    const remaining = await readSyncQueue();
    // Guarded kind: held back by the failed lookup.
    expect(remaining.find((r) => r.id === OP_PRE_RESET_PRODUCT)).toBeTruthy();
    // Non-guarded kind: the reset-signal guard never applies to it at all,
    // so it is attempted normally regardless of the lookup's outcome.
    expect(remaining.find((r) => r.id === OP_NON_GUARDED_KIND)).toBeTruthy();
  });

  // NOTE: the "already acknowledged this exact signal" dedupe path
  // (`readAppliedForceResyncAt` / `writeAppliedForceResyncAt`) is gated on
  // `typeof window`, and this offline test project deliberately never
  // defines `window` (see vitest.offline.setup.ts) so that browser-only
  // branches stay off and the suite stays deterministic. That dedupe logic
  // is covered where `window` is actually available: the
  // "staleForceFullResyncCutoff / hasUnacknowledgedForceFullResync" and
  // "applyPendingForceFullResyncForCurrentShop" describe blocks in
  // src/lib/shopRecoverySignals.test.ts.
});
