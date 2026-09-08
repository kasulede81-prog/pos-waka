/**
 * PHASE 0A — WAKA-05 executable regression tests for the pull cursors.
 *
 * AUDIT FINDING (WAKA-05, P0) — FIXED:
 *   Every incremental puller settled its cursor with
 *     `checkpointAt > since ? checkpointAt : new Date().toISOString()`
 *   so a page that returned zero rows advanced the persisted cursor to the
 *   LOCAL clock. On a device running fast that writes a cursor into the
 *   server's future, and `.gt("updated_at", <future cursor>)` then excludes
 *   every row the server stamps in the gap — permanently, because the cursor
 *   only ever moves forward.
 *
 *   The fix routes every checkpoint through `serverCheckpoint(since, observed)`,
 *   where `observed` is only ever a timestamp the server stamped on a row.
 *
 * The sales cursor has its own file (`cloudSyncSalesCursorWaka05.offline.test.ts`).
 * This file covers the remaining cursors, the multi-page keyset progression, and
 * the debt-payment cursor that feeds ledger-authoritative customer reconciliation
 * — the R1 / §J sequencing constraint the audit attaches to WAKA-01.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { markBootstrapSyncComplete, readSyncCheckpoints } from "../lib/syncCheckpoints";

/** The device's last successful sync, well in the past. */
const LAST_SYNC_AT = "2026-07-01T00:00:00.000Z";
/** A server timestamp AFTER the faked client clock (see FAST_CLIENT_NOW). */
const SERVER_AHEAD_OF_CLIENT = "2026-07-20T00:00:00.000Z";
/** Client clock, deliberately behind SERVER_AHEAD_OF_CLIENT. */
const CLIENT_NOW = new Date("2026-07-10T00:00:00.000Z");
/** Client clock running 10 minutes fast, per the audit's reproduction. */
const FAST_CLIENT_NOW = new Date("2026-07-10T00:10:00.000Z");

const CUSTOMER_ID = "99999999-9999-4999-8999-999999999999";

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

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function makeClient(
  scope: OfflineScope,
  tables: Record<string, unknown[]>,
  opts?: { keyset?: boolean },
): void {
  fake.client = createFakeSupabaseClient({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
    keyset: opts?.keyset,
  });
}

function customerRow(scope: OfflineScope, id: string, updatedAt: string) {
  return {
    id,
    shop_id: scope.shopId,
    name: "Nakato Grace",
    phone_e164: "+256700000001",
    created_at: LAST_SYNC_AT,
    updated_at: updatedAt,
    metadata: { debtBalanceUgx: 50_000, version: 2 },
  };
}

function productRow(scope: OfflineScope, id: string, updatedAt: string) {
  return {
    id,
    shop_id: scope.shopId,
    name: "Sugar 1kg",
    price_ugx: 5_000,
    cost_ugx: 4_000,
    stock_on_hand: 10,
    is_active: true,
    created_at: LAST_SYNC_AT,
    updated_at: updatedAt,
    metadata: {},
  };
}

function debtPaymentRow(scope: OfflineScope, id: string, createdAt: string) {
  return {
    id,
    shop_id: scope.shopId,
    customer_id: CUSTOMER_ID,
    amount_ugx: 10_000,
    created_at: createdAt,
    // WAKA-05: business-date value, deliberately NOT the cursor column.
    client_created_at: "2026-01-01T00:00:00.000Z",
    metadata: {},
  };
}

/** Keeps `localEmpty` false so the pull stays in incremental mode. */
const HYDRATED_STORE = {
  _hydrated: true,
  products: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Existing",
      priceUgx: 1_000,
      costUgx: 800,
      stock: 1,
      updatedAt: LAST_SYNC_AT,
      version: 1,
    },
  ],
  sales: [],
  customers: [],
  debtPayments: [],
  dayCloses: [],
};

describe("WAKA-05 — pull cursors are server-derived", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLIENT_NOW);
    scope = activateOfflineScope();
    markBootstrapSyncComplete(LAST_SYNC_AT);
    await setStore(HYDRATED_STORE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * CASE 1 — EMPTY PAGE. The audit's reproduction, run for every cursor at once.
   *
   * The client clock is 10 minutes fast. Before the fix each of these cursors
   * jumped to that fast local time and started excluding real server rows.
   */
  it("empty pages leave EVERY cursor exactly where it was, even with a fast client clock", async () => {
    vi.setSystemTime(FAST_CLIENT_NOW);
    makeClient(scope, {
      sales: [],
      products: [],
      customers: [],
      customer_debt_payments: [],
      expenses: [],
      sale_returns: [],
      sale_voids: [],
      shop_purchases: [],
      suppliers: [],
      supplier_payments: [],
    });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });
    expect(result).toBeTruthy();

    const cp = result!.checkpoints!;
    const cursors: Array<[string, string]> = [
      ["salesAt", cp.salesAt],
      ["productsAt", cp.productsAt],
      ["customersAt", cp.customersAt],
      ["debtPaymentsAt", cp.debtPaymentsAt],
      ["expensesAt", cp.expensesAt],
      ["returnsAt", cp.returnsAt],
      ["purchasesAt", cp.purchasesAt],
      ["suppliersAt", cp.suppliersAt],
      ["supplierPaymentsAt", cp.supplierPaymentsAt],
      ["cashDrawerAdjustmentsAt", cp.cashDrawerAdjustmentsAt],
      ["dayDrawerOpensAt", cp.dayDrawerOpensAt],
    ];

    for (const [name, value] of cursors) {
      expect(value, `${name} must not advance on an empty page`).toBe(LAST_SYNC_AT);
    }
    // Nothing anywhere reached for the local clock.
    const fastNow = FAST_CLIENT_NOW.toISOString();
    for (const [name, value] of cursors) {
      expect(value, `${name} must not be the client clock`).not.toBe(fastNow);
    }
  });

  /**
   * CASE 2 — NON-EMPTY PAGE. The cursor moves to the newest row the server
   * actually returned, per entity.
   */
  it("a non-empty page advances the cursor to the newest server timestamp", async () => {
    const newestCustomer = "2026-08-11T11:00:00.000Z";
    const newestProduct = "2026-08-12T12:00:00.000Z";
    const newestPayment = "2026-08-13T13:00:00.000Z";

    makeClient(scope, {
      customers: [
        customerRow(scope, CUSTOMER_ID, "2026-08-01T01:00:00.000Z"),
        customerRow(scope, "99999999-9999-4999-8999-999999999998", newestCustomer),
      ],
      products: [
        productRow(scope, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-08-02T02:00:00.000Z"),
        productRow(scope, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", newestProduct),
      ],
      customer_debt_payments: [
        debtPaymentRow(scope, "dddddddd-dddd-4ddd-8ddd-000000000001", "2026-08-03T03:00:00.000Z"),
        debtPaymentRow(scope, "dddddddd-dddd-4ddd-8ddd-000000000002", newestPayment),
      ],
    });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.checkpoints?.customersAt).toBe(newestCustomer);
    expect(result?.checkpoints?.productsAt).toBe(newestProduct);
    expect(result?.checkpoints?.debtPaymentsAt).toBe(newestPayment);
  });

  /**
   * CASE 3 — SERVER TIMESTAMP NEWER THAN THE CLIENT CLOCK.
   *
   * A device whose clock is behind the server must still adopt the server's
   * value verbatim. Any clamp to local time would re-introduce the skip.
   */
  it("adopts a server timestamp that is AHEAD of the client clock", async () => {
    // Client believes it is 2026-07-10; the server stamped 2026-07-20.
    expect(new Date(SERVER_AHEAD_OF_CLIENT).getTime()).toBeGreaterThan(CLIENT_NOW.getTime());

    makeClient(scope, {
      customers: [customerRow(scope, CUSTOMER_ID, SERVER_AHEAD_OF_CLIENT)],
      customer_debt_payments: [
        debtPaymentRow(scope, "dddddddd-dddd-4ddd-8ddd-000000000003", SERVER_AHEAD_OF_CLIENT),
      ],
    });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.checkpoints?.customersAt).toBe(SERVER_AHEAD_OF_CLIENT);
    expect(result?.checkpoints?.debtPaymentsAt).toBe(SERVER_AHEAD_OF_CLIENT);
  });

  /**
   * CASE 4 — MULTI-PAGE PROGRESSION.
   *
   * With keyset semantics switched on, the fake server honours
   * `.gt(created_at, cursor)` / `.order` / `.limit`, so the client has to walk
   * the cursor forward page by page. 501 rows = one full 500-row page plus a
   * remainder page. The final cursor must be the newest row overall, and every
   * row must arrive exactly once.
   */
  it("walks a multi-page keyset to the newest row without skipping or repeating", async () => {
    const total = 501;
    const rows = Array.from({ length: total }, (_, i) =>
      debtPaymentRow(
        scope,
        `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
        // Strictly increasing, unique server timestamps.
        new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + i * 1000).toISOString(),
      ),
    );
    const newest = rows[total - 1]!.created_at;

    makeClient(scope, { customer_debt_payments: rows }, { keyset: true });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.checkpoints?.debtPaymentsAt).toBe(newest);
    expect(result?.debtPayments).toHaveLength(total);
    expect(new Set(result!.debtPayments.map((p) => p.id)).size).toBe(total);
  });

  /**
   * The business-date value survives the split introduced by migration 182:
   * `created_at` drives the cursor, `client_created_at` drives the trading day.
   */
  it("maps client_created_at to the payment's business date, not the cursor column", async () => {
    makeClient(scope, {
      customer_debt_payments: [
        debtPaymentRow(scope, "dddddddd-dddd-4ddd-8ddd-000000000004", "2026-08-20T20:00:00.000Z"),
      ],
    });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    // Cursor took the server column…
    expect(result?.checkpoints?.debtPaymentsAt).toBe("2026-08-20T20:00:00.000Z");
    // …while the payment kept the cashier's own clock for reporting.
    expect(result?.debtPayments[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

/**
 * §J SEQUENCING CONSTRAINT / R1.
 *
 * "Do not ship WAKA-01 alone. Restoring the merge re-enables the
 *  ledger-authoritative customer recompute on devices that may be missing debt
 *  payments because of WAKA-05."
 *
 * WAKA-01 is fixed, so `mergeCustomerFromCloudPull(..., {ledgerAuthoritative})`
 * now actually runs. These tests prove the debt-payment cursor that feeds it can
 * no longer skip a payment, which is what made the recompute dangerous.
 */
describe("WAKA-05 + WAKA-01 — the debt-payment cursor no longer strands the ledger recompute", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FAST_CLIENT_NOW);
    scope = activateOfflineScope();
    markBootstrapSyncComplete(LAST_SYNC_AT);
    await setStore(HYDRATED_STORE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The audit's exact reproduction, end to end through the real merge:
   *   1. Fast device pulls, gets nothing, and (pre-fix) stamps a future cursor.
   *   2. Another device records a payment at real server time — which is BEHIND
   *      the fast device's clock.
   *   3. The fast device pulls again.
   * Pre-fix the payment is excluded forever. Post-fix the cursor never moved, so
   * it is delivered.
   */
  it("a payment written while the client clock ran ahead is still delivered on the next pull", async () => {
    const { pullCloudAndMergeIntoStore, pullShopDataFromCloud } = await import("./cloudSync");

    // Pass 1 — nothing new on the server.
    makeClient(scope, { customer_debt_payments: [] }, { keyset: true });
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const afterEmpty = readSyncCheckpoints().lastDebtPaymentsSyncAt;
    expect(afterEmpty, "empty pull must not move the debt cursor").toBe(LAST_SYNC_AT);
    expect(afterEmpty).not.toBe(FAST_CLIENT_NOW.toISOString());

    // Pass 2 — the other device's payment, stamped by the SERVER at a time that
    // is behind this device's fast clock but after its real last sync.
    const serverStampedAt = "2026-07-05T00:00:00.000Z";
    expect(new Date(serverStampedAt).getTime()).toBeLessThan(FAST_CLIENT_NOW.getTime());
    makeClient(
      scope,
      { customer_debt_payments: [debtPaymentRow(scope, "dddddddd-dddd-4ddd-8ddd-00000000000a", serverStampedAt)] },
      { keyset: true },
    );

    const second = await pullShopDataFromCloud({ pullReason: "full_sync" });
    expect(second?.debtPayments, "the missed payment must arrive").toHaveLength(1);
    expect(second?.checkpoints?.debtPaymentsAt).toBe(serverStampedAt);
  });

  /** The persisted cursor, not just the in-flight value, stays put. */
  it("persists the unchanged debt cursor through updateCheckpointsAfterIncrementalPull", async () => {
    makeClient(scope, { customer_debt_payments: [] }, { keyset: true });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const cp = readSyncCheckpoints();
    expect(cp.lastDebtPaymentsSyncAt).toBe(LAST_SYNC_AT);
    expect(cp.lastDebtsSyncAt).toBe(LAST_SYNC_AT);
    expect(cp.lastSalesSyncAt).toBe(LAST_SYNC_AT);
    expect(cp.lastCustomersSyncAt).toBe(LAST_SYNC_AT);
  });
});
