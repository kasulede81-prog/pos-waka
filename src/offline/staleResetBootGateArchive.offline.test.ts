/**
 * Admin-reset safety net — the BOOT GATE path (WAKA-14).
 *
 * Confirmed production ordering (shop 1a110d2e, five devices, all `recoveryReason: "app_boot_gate"`): the boot gate
 * pulls and ACKNOWLEDGES the reset signal BEFORE the outbox flush runs. From then on the flush guard
 * (staleResetOutboxGuardWaka13) is inert, and the authoritative full pull deliberately KEEPS a local sale that still
 * has a pending queue op (cloudSyncSalesCustomersAuthoritativeReplace: "does not delete a locally-created sale that
 * has not been pushed yet"). A pre-reset unsynced sale was therefore pushed later and RESURRECTED data the admin reset
 * had deleted.
 *
 * Runs the REAL applyAdminForceFullResync + REAL flushSyncQueueInner + REAL IndexedDB (fake-indexeddb); only
 * src/lib/supabase is faked (established WAKA offline-test convention).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale, SyncOperation } from "../types";
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

const RESET_AT = "2026-09-16T08:34:55.604Z";
const PRE_SALE = "a0000000-0000-4000-8000-0000000000a1";
const PRE_SALE_NO_OP = "a0000000-0000-4000-8000-0000000000a2";
const POST_SALE = "a0000000-0000-4000-8000-0000000000b1";
const SERVER_SALE = "a0000000-0000-4000-8000-0000000000c1";

function sale(id: string, createdAt: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    status: "completed",
    lines: [],
    subtotalUgx: 3000,
    totalUgx: 3000,
    cashPaidUgx: 3000,
    debtUgx: 0,
    estimatedProfitUgx: 500,
    createdAt,
    pendingSync: true,
    ...overrides,
  };
}

function op(id: string, kind: SyncOperation["kind"], createdAt: string, shopId: string, payload: unknown): SyncOperation {
  return { id, kind, payload, createdAt, attempts: 0, lastAttemptAt: null, shopId };
}

function client(scope: OfflineScope, serverSales: Record<string, unknown>[] = []): FakeSupabaseClient {
  return createFakeSupabaseClient({
    columnFilterTables: ["sales"],
    user: { id: HARNESS_USER_ID, email: "harness@waka.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
    tables: { ...organizationTablesFor(scope), sales: serverSales },
    rpc: {
      shop_fetch_recovery_signal: {
        clear_back_office_pin_at: null,
        clear_staff_credentials_at: null,
        password_reset_requested_at: null,
        force_full_resync_at: RESET_AT,
      },
    },
  });
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}
async function storeSaleIds(): Promise<string[]> {
  const { usePosStore } = await import("../store/usePosStore");
  return usePosStore.getState().sales.map((s) => s.id).sort();
}

describe("boot gate archives, then drops, stale pre-reset outbox ops (no resurrection)", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    resetShopCtxTickForTests();
    scope = activateOfflineScope();
    await setStore({ _hydrated: true, products: [], sales: [], customers: [], debtPayments: [], dayCloses: [] });
  });

  it("archives the pre-reset pending sale + op, removes the op, empties the local sale, and NEVER pushes it", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await setStore({ sales: [sale(PRE_SALE, "2026-09-10T10:00:00.000Z")] });
    await appendSyncOperation(
      op("op-pre-sale", "pending_sales", "2026-09-10T10:00:01.000Z", scope.shopId, { saleId: PRE_SALE, kind: "complete" }),
    );
    fake.client = client(scope);

    const { applyAdminForceFullResync } = await import("../lib/shopRecoverySignals");
    await expect(applyAdminForceFullResync(scope.shopId, RESET_AT, "app_boot_gate")).resolves.toBe(true);

    // evidence first: the op AND the sale body are in the durable archive
    const { readStaleResetArchive } = await import("../lib/staleResetOutbox");
    const archive = await readStaleResetArchive();
    expect(archive).toHaveLength(1);
    expect(archive[0].reason).toBe("boot_gate");
    expect(archive[0].cutoff).toBe(RESET_AT);
    expect(archive[0].operations.map((o) => o.id)).toEqual(["op-pre-sale"]);
    expect(archive[0].sales.map((s) => s.id)).toEqual([PRE_SALE]);

    // then the stale op is gone from the outbox and the sale is gone locally (authoritative replace)
    expect((await readSyncQueue()).find((o) => o.id === "op-pre-sale")).toBeUndefined();
    expect(await storeSaleIds()).toEqual([]);

    // the signal is acknowledged (flush guard is now inert) — and STILL nothing is pushed
    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    // (an audit row for the applied resync may be written; no SALE row / sale RPC may ever be)
    expect(fake.client?.writes.filter((w) => /sale/.test(w.table)) ?? []).toEqual([]);
    expect(fake.client?.rpcCalls.filter((c) => /push_sale|sale_complete/.test(c.fn)) ?? []).toEqual([]);
  });

  it("archives a pre-reset sale that is still marked pendingSync but has NO queue op (it would otherwise vanish silently)", async () => {
    await setStore({ sales: [sale(PRE_SALE_NO_OP, "2026-09-11T10:00:00.000Z")] });
    fake.client = client(scope);
    const { applyAdminForceFullResync } = await import("../lib/shopRecoverySignals");
    await applyAdminForceFullResync(scope.shopId, RESET_AT, "app_boot_gate");

    const { readStaleResetArchive } = await import("../lib/staleResetOutbox");
    const archive = await readStaleResetArchive();
    expect(archive.flatMap((e) => e.sales.map((s) => s.id))).toEqual([PRE_SALE_NO_OP]);
    expect(await storeSaleIds()).toEqual([]);
  });

  it("archives adjustment ops (void / return) that reference a dropped sale, leaves unrelated ops alone", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await setStore({ sales: [sale(PRE_SALE, "2026-09-10T10:00:00.000Z")] });
    await appendSyncOperation(op("op-sale", "pending_sales", "2026-09-10T10:00:01.000Z", scope.shopId, { saleId: PRE_SALE }));
    await appendSyncOperation(
      op("op-return", "pending_returns", "2026-09-10T11:00:00.000Z", scope.shopId, { saleId: PRE_SALE, returnId: "r1" }),
    );
    await appendSyncOperation(
      op("op-shift", "pending_shifts", "2026-09-10T11:00:00.000Z", scope.shopId, { shiftId: "11111111-1111-4111-8111-000000000099" }),
    );
    fake.client = client(scope);
    const { applyAdminForceFullResync } = await import("../lib/shopRecoverySignals");
    await applyAdminForceFullResync(scope.shopId, RESET_AT, "app_boot_gate");

    const ids = (await readSyncQueue()).map((o) => o.id);
    expect(ids).not.toContain("op-sale");
    expect(ids).not.toContain("op-return");
    expect(ids).toContain("op-shift"); // unrelated, non-guarded kind is never dropped
    const { readStaleResetArchive } = await import("../lib/staleResetOutbox");
    expect((await readStaleResetArchive())[0].operations.map((o) => o.id).sort()).toEqual(["op-return", "op-sale"]);
  });

  it("keeps a POST-reset sale and its op (a genuinely new sale after the reset is never archived or dropped)", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await setStore({ sales: [sale(POST_SALE, "2026-09-17T09:00:00.000Z")] });
    await appendSyncOperation(op("op-post", "pending_sales", "2026-09-17T09:00:01.000Z", scope.shopId, { saleId: POST_SALE }));
    fake.client = client(scope);
    const { applyAdminForceFullResync } = await import("../lib/shopRecoverySignals");
    await applyAdminForceFullResync(scope.shopId, RESET_AT, "app_boot_gate");

    expect((await readSyncQueue()).map((o) => o.id)).toContain("op-post");
    expect(await storeSaleIds()).toEqual([POST_SALE]); // protected by its pending op
    const { readStaleResetArchive } = await import("../lib/staleResetOutbox");
    expect(await readStaleResetArchive()).toEqual([]);
  });

  it("does nothing (and touches no queue) when the pull fails or nothing is stale", async () => {
    const { readSyncQueue } = await import("./localDb");
    fake.client = client(scope);
    const { applyAdminForceFullResync } = await import("../lib/shopRecoverySignals");
    // an empty device may try a cloud-snapshot restore that is denied without a session actor: irrelevant here
    await applyAdminForceFullResync(scope.shopId, RESET_AT, "app_boot_gate").catch(() => false);
    // (the applied-resync audit row may be queued; no business op exists and nothing is archived)
    expect((await readSyncQueue()).filter((o) => o.kind !== "audit_log")).toEqual([]);
    const { readStaleResetArchive } = await import("../lib/staleResetOutbox");
    expect(await readStaleResetArchive()).toEqual([]);
  });

  it("FLUSH GUARD path (signal not yet acknowledged) also archives instead of silently deleting", async () => {
    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    await setStore({ sales: [sale(PRE_SALE, "2026-09-10T10:00:00.000Z"), sale(SERVER_SALE, "2026-09-10T10:00:00.000Z", { pendingSync: false })] });
    await appendSyncOperation(op("op-flush-pre", "pending_sales", "2026-09-10T10:00:01.000Z", scope.shopId, { saleId: PRE_SALE }));
    fake.client = client(scope);

    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();

    expect((await readSyncQueue()).find((o) => o.id === "op-flush-pre")).toBeUndefined();
    expect(fake.client?.writes.filter((w) => /sale/.test(w.table)) ?? []).toEqual([]);
    const { readStaleResetArchive } = await import("../lib/staleResetOutbox");
    const archive = await readStaleResetArchive();
    expect(archive[0].reason).toBe("flush_guard");
    expect(archive[0].operations.map((o) => o.id)).toEqual(["op-flush-pre"]);
    expect(archive[0].sales.map((s) => s.id)).toEqual([PRE_SALE]); // only the unsynced one; the acked sale is not archived

    // a second flush must not archive the same sale body again
    await flushSyncQueueInner();
    expect((await readStaleResetArchive()).flatMap((e) => e.sales.map((s) => s.id))).toEqual([PRE_SALE]);
  });
});
