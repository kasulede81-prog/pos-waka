/**
 * PHASE 0A — WAKA-07 executable regression: composite (time, id) keyset.
 *
 * AUDIT FINDING (WAKA-07, P1):
 *   Incremental pullers used `.gt(updated_at, cursor).order(updated_at).limit(500)`.
 *   A 500-row page of rows sharing one `updated_at` made `checkpointAt == cursor`,
 *   so the next page was identical. After 40 wasted trips the timestamp was
 *   persisted and every remaining row at that timestamp was skipped forever.
 *
 *   The fix pages with (updated_at, id) — or (created_at, id) for debt payments —
 *   and carries the last row's id between pages. The persisted WAKA-05 checkpoint
 *   is still the newest server timestamp observed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import {
  markBootstrapSyncComplete,
  markProductCostAuthorityRefreshDone,
} from "../lib/syncCheckpoints";

const LAST_SYNC_AT = "2026-07-01T00:00:00.000Z";
const SHARED_AT = "2026-08-01T12:00:00.000Z";
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

function uuidTail(i: number): string {
  return String(i).padStart(12, "0");
}

function productRow(scope: OfflineScope, i: number) {
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${uuidTail(i)}`,
    shop_id: scope.shopId,
    name: `Bulk ${i}`,
    price_ugx: 5_000,
    cost_ugx: 4_000,
    stock_on_hand: 10,
    is_active: true,
    created_at: SHARED_AT,
    updated_at: SHARED_AT,
    metadata: {},
  };
}

function customerRow(scope: OfflineScope, i: number) {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${uuidTail(i)}`,
    shop_id: scope.shopId,
    name: `Customer ${i}`,
    phone_e164: "+256700000001",
    created_at: SHARED_AT,
    updated_at: SHARED_AT,
    metadata: { debtBalanceUgx: 0, version: 1 },
  };
}

function debtPaymentRow(scope: OfflineScope, i: number) {
  return {
    id: `dddddddd-dddd-4ddd-8ddd-${uuidTail(i)}`,
    shop_id: scope.shopId,
    customer_id: CUSTOMER_ID,
    amount_ugx: 1_000,
    created_at: SHARED_AT,
    client_created_at: "2026-01-01T00:00:00.000Z",
    metadata: {},
  };
}

async function setStore(patch: Record<string, unknown>): Promise<void> {
  const { usePosStore } = await import("../store/usePosStore");
  usePosStore.setState(patch as never);
}

function makeClient(scope: OfflineScope, tables: Record<string, unknown[]>): void {
  fake.client = createFakeSupabaseClient({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
    keyset: true,
  });
}

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

describe("WAKA-07 — composite keyset across a same-timestamp page boundary", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    scope = activateOfflineScope();
    markBootstrapSyncComplete(LAST_SYNC_AT);
    markProductCostAuthorityRefreshDone();
    await setStore(HYDRATED_STORE);
  });

  it("pulls all 600 products that share one updated_at, with no duplicates", async () => {
    const total = 600;
    makeClient(scope, { products: Array.from({ length: total }, (_, i) => productRow(scope, i)) });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.products).toHaveLength(total);
    expect(new Set(result!.products.map((p) => p.id)).size).toBe(total);
    expect(result?.checkpoints?.productsAt).toBe(SHARED_AT);
  });

  it("pulls all 600 customers that share one updated_at, with no duplicates", async () => {
    const total = 600;
    makeClient(scope, { customers: Array.from({ length: total }, (_, i) => customerRow(scope, i)) });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.customers).toHaveLength(total);
    expect(new Set(result!.customers.map((c) => c.id)).size).toBe(total);
    expect(result?.checkpoints?.customersAt).toBe(SHARED_AT);
  });

  it("pulls all 600 debt payments that share one created_at (created_at keyset)", async () => {
    const total = 600;
    makeClient(scope, {
      customer_debt_payments: Array.from({ length: total }, (_, i) => debtPaymentRow(scope, i)),
    });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.debtPayments).toHaveLength(total);
    expect(new Set(result!.debtPayments.map((p) => p.id)).size).toBe(total);
    expect(result?.checkpoints?.debtPaymentsAt).toBe(SHARED_AT);
  });

  it("empty pages still leave the products cursor exactly where it was", async () => {
    makeClient(scope, { products: [] });

    const { pullShopDataFromCloud } = await import("./cloudSync");
    const result = await pullShopDataFromCloud({ pullReason: "full_sync" });

    expect(result?.products).toEqual([]);
    expect(result?.checkpoints?.productsAt).toBe(LAST_SYNC_AT);
  });
});
