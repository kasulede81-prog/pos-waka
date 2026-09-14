/**
 * Admin-reset safety net — authoritative full-pull replace for SALES and
 * CUSTOMERS (extends the same fix already proven for products —
 * `cloudSyncProductAuthoritativeReplace.offline.test.ts`).
 *
 * LIVE INCIDENT CONFIRMED (2026-09-14, shop 2df4b0c8-8b30-489a-8167-41de2549041f,
 * wakamarketplace@gmail.com): an admin "reset shop business data" action
 * correctly hard-deleted every business table server-side (products, sales,
 * customers, etc. all confirmed at 0 rows). The products fix already shipped
 * correctly emptied local products. But `sales` and `customers` had NO
 * equivalent authoritative-replace gate — they only ever merge-add. A device
 * still had 8 stale sales in its local cache after the reset, and ~95
 * seconds later re-published those 8 stale sales to `shop_cloud_snapshots`
 * via a normal (now-permitted, since the reset signal was already
 * acknowledged) snapshot upload — resurrecting them in the cloud.
 *
 * ROOT CAUSE: `voidedSaleSet` (the only removal mechanism sales had) is a
 * STATUS tombstone — built only from rows the server explicitly marked
 * void/refunded/cancelled. A row the reset RPC HARD-DELETED has no status
 * left to tombstone, so it is invisible to that mechanism and survives
 * every merge forever, identical to the original products bug
 * (`is_active=false` soft-delete query finding nothing after a hard DELETE).
 * Customers never had ANY removal mechanism at all.
 *
 * THE FIX (`pullCloudAndMergeIntoStore`, src/offline/cloudSync.ts):
 * `salesAuthoritative` / `customersAuthoritative` gates, mirroring
 * `productsAuthoritative` exactly — a complete pull (`mode==="full"`, not
 * truncated, no relevant `entityErrors`) makes the server's id list
 * authoritative; a local-only survivor is dropped unless this device has an
 * unsynced local mutation for it (`pendingSaleMutationIds` /
 * `pendingCustomerMutationIds`, src/lib/inventoryIntegrity.ts).
 *
 * This file runs the REAL `pullCloudAndMergeIntoStore` against REAL
 * IndexedDB (fake-indexeddb). Only `src/lib/supabase` is faked, per the
 * established WAKA offline-test convention.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Sale } from "../types";
import {
  activateOfflineScope,
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

const KEEP_SALE_1 = "a0000000-0000-4000-8000-000000000001";
const KEEP_SALE_2 = "a0000000-0000-4000-8000-000000000002";
const STALE_SALE_1 = "b0000000-0000-4000-8000-000000000001";
const STALE_SALE_2 = "b0000000-0000-4000-8000-000000000002";
const UNSYNCED_SALE = "c0000000-0000-4000-8000-000000000001";

const KEEP_CUSTOMER_1 = "d0000000-0000-4000-8000-000000000001";
const STALE_CUSTOMER_1 = "e0000000-0000-4000-8000-000000000001";
const UNSYNCED_CUSTOMER = "f0000000-0000-4000-8000-000000000001";

function cloudSaleRow(scope: OfflineScope, id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    shop_id: scope.shopId,
    status: "completed",
    total_ugx: 10_000,
    subtotal_ugx: 10_000,
    cash_amount_ugx: 10_000,
    debt_amount_ugx: 0,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-13T22:01:00.000Z",
    sale_line_items: [],
    metadata: {},
    ...overrides,
  };
}

function localSale(id: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    status: "completed",
    lines: [],
    subtotalUgx: 10_000,
    totalUgx: 10_000,
    cashPaidUgx: 10_000,
    debtUgx: 0,
    estimatedProfitUgx: 2_000,
    createdAt: "2026-09-01T00:00:00.000Z",
    pendingSync: false,
    ...overrides,
  };
}

function cloudCustomerRow(scope: OfflineScope, id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    shop_id: scope.shopId,
    name: `Customer ${id.slice(-4)}`,
    phone_e164: "+256700000000",
    notes: "",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-13T22:01:00.000Z",
    metadata: { location: "Kampala", version: 1, debtBalanceUgx: 0, phone: "+256700000000" },
    ...overrides,
  };
}

function localCustomer(id: string, overrides: Partial<Customer> = {}): Customer {
  return {
    id,
    name: `Customer ${id.slice(-4)}`,
    phone: "+256700000000",
    location: "Kampala",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    debtBalanceUgx: 0,
    ...overrides,
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

async function saleIds(): Promise<string[]> {
  return (await getStore()).sales.map((s) => s.id).sort();
}

async function customerIds(): Promise<string[]> {
  return (await getStore()).customers.map((c) => c.id).sort();
}

describe("Admin-reset safety net — sales authoritative full-pull replace", () => {
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
    });
  });

  it("TEST 1 — full pull drops local-only sales the server no longer has", async () => {
    await setStore({
      sales: [
        localSale(KEEP_SALE_1),
        localSale(KEEP_SALE_2),
        localSale(STALE_SALE_1),
        localSale(STALE_SALE_2),
      ],
    });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["sales"],
      tables: {
        ...organizationTablesFor(scope),
        sales: [cloudSaleRow(scope, KEEP_SALE_1), cloudSaleRow(scope, KEEP_SALE_2)],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect(await saleIds()).toEqual([KEEP_SALE_1, KEEP_SALE_2].sort());
  });

  it("TEST 2 — a reset shop (server returns 0 sales) empties every stale local sale", async () => {
    await setStore({
      sales: Array.from({ length: 8 }, (_, i) =>
        localSale(`d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      ),
    });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["sales"],
      tables: { ...organizationTablesFor(scope), sales: [] },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect((await getStore()).sales).toHaveLength(0);
  });

  it("TEST 3 — a failed full pull never touches local sales", async () => {
    await setStore({ sales: [localSale(KEEP_SALE_1), localSale(STALE_SALE_1)] });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["sales"],
      tables: { ...organizationTablesFor(scope) },
      tableErrors: { sales: { message: "simulated network failure", code: "500" } },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }).catch(
      () => undefined,
    );

    expect(await saleIds()).toEqual([KEEP_SALE_1, STALE_SALE_1].sort());
  });

  it("does not delete a locally-created sale that has not been pushed yet", async () => {
    await setStore({ sales: [localSale(KEEP_SALE_1), localSale(UNSYNCED_SALE)] });
    const { appendSyncOperation } = await import("./localDb");
    await appendSyncOperation({
      id: "op-1",
      kind: "pending_sales",
      payload: { saleId: UNSYNCED_SALE },
      createdAt: new Date().toISOString(),
      attempts: 0,
      shopId: scope.shopId,
    });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["sales"],
      tables: { ...organizationTablesFor(scope), sales: [cloudSaleRow(scope, KEEP_SALE_1)] },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect(await saleIds()).toEqual([KEEP_SALE_1, UNSYNCED_SALE].sort());
  });

  it("TEST 9 — an ordinary incremental sync never drops a local-only sale", async () => {
    const { markBootstrapSyncComplete } = await import("../lib/syncCheckpoints");
    markBootstrapSyncComplete("2026-09-01T00:00:00.000Z");
    await setStore({ sales: [localSale(KEEP_SALE_1), localSale(STALE_SALE_1)] });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["sales"],
      tables: {
        ...organizationTablesFor(scope),
        sales: [cloudSaleRow(scope, KEEP_SALE_1, { updated_at: "2026-09-14T00:00:00.000Z" })],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "background_sync" })).resolves.toBe(true);

    expect(await saleIds()).toEqual([KEEP_SALE_1, STALE_SALE_1].sort());
  });

  it("REGRESSION — a status-voided sale still gets tombstoned in full mode", async () => {
    await setStore({ sales: [localSale(KEEP_SALE_1), localSale(STALE_SALE_1)] });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["sales"],
      tables: {
        ...organizationTablesFor(scope),
        sales: [cloudSaleRow(scope, KEEP_SALE_1), cloudSaleRow(scope, STALE_SALE_1, { status: "void" })],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect(await saleIds()).toEqual([KEEP_SALE_1]);
  });
});

describe("Admin-reset safety net — customers authoritative full-pull replace", () => {
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
    });
  });

  it("TEST 1 — full pull drops a local-only customer the server no longer has", async () => {
    await setStore({ customers: [localCustomer(KEEP_CUSTOMER_1), localCustomer(STALE_CUSTOMER_1)] });

    fake.client = createFakeSupabaseClient({
      tables: { ...organizationTablesFor(scope), customers: [cloudCustomerRow(scope, KEEP_CUSTOMER_1)] },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect(await customerIds()).toEqual([KEEP_CUSTOMER_1]);
  });

  it("TEST 2 — a reset shop (server returns 0 customers) empties every stale local customer", async () => {
    await setStore({
      customers: Array.from({ length: 5 }, (_, i) =>
        localCustomer(`d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      ),
    });

    fake.client = createFakeSupabaseClient({
      tables: { ...organizationTablesFor(scope), customers: [] },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect((await getStore()).customers).toHaveLength(0);
  });

  it("TEST 3 — a failed full pull never touches local customers", async () => {
    await setStore({ customers: [localCustomer(KEEP_CUSTOMER_1), localCustomer(STALE_CUSTOMER_1)] });

    fake.client = createFakeSupabaseClient({
      tables: { ...organizationTablesFor(scope) },
      tableErrors: { customers: { message: "simulated network failure", code: "500" } },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }).catch(
      () => undefined,
    );

    expect(await customerIds()).toEqual([KEEP_CUSTOMER_1, STALE_CUSTOMER_1].sort());
  });

  it("does not delete a locally-created customer that has not been pushed yet", async () => {
    await setStore({ customers: [localCustomer(KEEP_CUSTOMER_1), localCustomer(UNSYNCED_CUSTOMER)] });
    const { appendSyncOperation } = await import("./localDb");
    await appendSyncOperation({
      id: "op-1",
      kind: "customer",
      payload: { id: UNSYNCED_CUSTOMER },
      createdAt: new Date().toISOString(),
      attempts: 0,
      shopId: scope.shopId,
    });

    fake.client = createFakeSupabaseClient({
      tables: { ...organizationTablesFor(scope), customers: [cloudCustomerRow(scope, KEEP_CUSTOMER_1)] },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect(await customerIds()).toEqual([KEEP_CUSTOMER_1, UNSYNCED_CUSTOMER].sort());
  });

  it("does not let a queued DEBT PAYMENT (shares the 'customer' op kind) falsely protect an unrelated customer id", async () => {
    await setStore({ customers: [localCustomer(KEEP_CUSTOMER_1), localCustomer(STALE_CUSTOMER_1)] });
    const { appendSyncOperation } = await import("./localDb");
    // A debt-payment op uses the SAME outer "customer" kind but carries a
    // paymentId, not a customer id — pendingCustomerMutationIds must not
    // mistake this for an edit to STALE_CUSTOMER_1.
    await appendSyncOperation({
      id: "op-debt-1",
      kind: "customer",
      payload: { kind: "debt_payment", paymentId: "some-payment-id", customerId: STALE_CUSTOMER_1 },
      createdAt: new Date().toISOString(),
      attempts: 0,
      shopId: scope.shopId,
    });

    fake.client = createFakeSupabaseClient({
      tables: { ...organizationTablesFor(scope), customers: [cloudCustomerRow(scope, KEEP_CUSTOMER_1)] },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }),
    ).resolves.toBe(true);

    expect(await customerIds()).toEqual([KEEP_CUSTOMER_1]);
  });

  it("TEST 9 — an ordinary incremental sync never drops a local-only customer", async () => {
    const { markBootstrapSyncComplete } = await import("../lib/syncCheckpoints");
    markBootstrapSyncComplete("2026-09-01T00:00:00.000Z");
    await setStore({ customers: [localCustomer(KEEP_CUSTOMER_1), localCustomer(STALE_CUSTOMER_1)] });

    fake.client = createFakeSupabaseClient({
      tables: {
        ...organizationTablesFor(scope),
        customers: [cloudCustomerRow(scope, KEEP_CUSTOMER_1, { updated_at: "2026-09-14T00:00:00.000Z" })],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "background_sync" })).resolves.toBe(true);

    expect(await customerIds()).toEqual([KEEP_CUSTOMER_1, STALE_CUSTOMER_1].sort());
  });
});
