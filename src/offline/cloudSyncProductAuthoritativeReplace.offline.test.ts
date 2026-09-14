/**
 * Admin-reset safety net — authoritative full-pull product reconciliation.
 *
 * ROOT CAUSE (see the forensic investigation this fixes): `pullProductsFull`'s
 * "what got deleted" detection relies on `is_active = false` (a soft delete).
 * The admin shop-reset RPC does a hard `DELETE`, so that query always comes
 * back empty after a reset — and a plain id-merge (`mergeByIdChunked`) only
 * ever adds/updates, never removes. A forced full pull that correctly found
 * 0 server products still left every stale local product completely
 * untouched, forever.
 *
 * These tests run the REAL `pullCloudAndMergeIntoStore` against the REAL
 * `localDb`/`entityStore` (fake-indexeddb) and the REAL `usePosStore`. Only
 * the network boundary (`src/lib/supabase`) is faked, per the existing
 * WAKA-01 harness convention (`cloudSyncMergeWaka01.offline.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../types";
import {
  activateOfflineScope,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { resetShopCtxTickForTests } from "../lib/shopSyncContext";
import { markBootstrapSyncComplete } from "../lib/syncCheckpoints";

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

const KEEP_1 = "a0000000-0000-4000-8000-000000000001";
const KEEP_2 = "a0000000-0000-4000-8000-000000000002";
const KEEP_3 = "a0000000-0000-4000-8000-000000000003";
const STALE_1 = "b0000000-0000-4000-8000-000000000001";
const STALE_2 = "b0000000-0000-4000-8000-000000000002";
const UNSYNCED_NEW = "c0000000-0000-4000-8000-000000000001";

function cloudProductRow(scope: OfflineScope, id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    shop_id: scope.shopId,
    name: `Product ${id.slice(-4)}`,
    sku: `SKU-${id.slice(-4)}`,
    unit: "piece",
    base_unit: "piece",
    selling_mode: "unit",
    selling_price_per_unit_ugx: 5000,
    cost_price_per_unit_ugx: 3000,
    stock_on_hand: 10,
    minimum_stock_alert: 5,
    is_active: true,
    metadata: { category: "Groceries", version: 1 },
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-13T22:01:00.000Z",
    ...overrides,
  };
}

function localProduct(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name: `Product ${id.slice(-4)}`,
    sellingMode: "unit",
    baseUnit: "piece",
    sellingPricePerUnitUgx: 5000,
    costPricePerUnitUgx: 3000,
    stockOnHand: 10,
    minimumStockAlert: 5,
    category: "Groceries",
    sku: `SKU-${id.slice(-4)}`,
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
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

async function productIds(): Promise<string[]> {
  return (await getStore()).products.map((p) => p.id).sort();
}

describe("Admin-reset safety net — authoritative full-pull product replacement", () => {
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

  it("TEST 1 — full pull drops local-only products the server no longer has", async () => {
    await setStore({
      products: [
        localProduct(KEEP_1),
        localProduct(KEEP_2),
        localProduct(KEEP_3),
        localProduct(STALE_1),
        localProduct(STALE_2),
      ],
    });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: {
        ...organizationTablesFor(scope),
        products: [
          cloudProductRow(scope, KEEP_1),
          cloudProductRow(scope, KEEP_2),
          cloudProductRow(scope, KEEP_3),
        ],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" })).resolves.toBe(
      true,
    );

    expect(await productIds()).toEqual([KEEP_1, KEEP_2, KEEP_3].sort());
  });

  it("TEST 2 — a reset shop (server returns 0 products) empties every stale local product", async () => {
    await setStore({
      products: Array.from({ length: 25 }, (_, i) =>
        localProduct(`d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      ),
    });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: {
        ...organizationTablesFor(scope),
        products: [],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" })).resolves.toBe(
      true,
    );

    expect((await getStore()).products).toHaveLength(0);
  });

  it("TEST 3 — a failed full pull never touches local products", async () => {
    await setStore({ products: [localProduct(KEEP_1), localProduct(STALE_1)] });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: { ...organizationTablesFor(scope) },
      tableErrors: { products: { message: "simulated network failure", code: "500" } },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    // The pull itself may report failure or partial success depending on which
    // other entities also errored — the only thing this test asserts is that
    // local products are byte-for-byte untouched either way.
    await pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" }).catch(() => undefined);

    expect(await productIds()).toEqual([KEEP_1, STALE_1].sort());
  });

  it("does not delete a locally-created product that has not been pushed yet", async () => {
    await setStore({ products: [localProduct(KEEP_1), localProduct(UNSYNCED_NEW)] });
    const { appendSyncOperation } = await import("./localDb");
    await appendSyncOperation({
      id: "op-1",
      kind: "product",
      payload: { id: UNSYNCED_NEW },
      createdAt: new Date().toISOString(),
      attempts: 0,
      shopId: scope.shopId,
    });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: {
        ...organizationTablesFor(scope),
        products: [cloudProductRow(scope, KEEP_1)],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" })).resolves.toBe(
      true,
    );

    // KEEP_1 came from the server; UNSYNCED_NEW survives because it has a
    // pending local mutation the pull must not silently discard.
    expect(await productIds()).toEqual([KEEP_1, UNSYNCED_NEW].sort());
  });

  it("TEST 9 — an ordinary incremental sync never drops a local-only product", async () => {
    // A brand-new shop scope always needs its first (full) bootstrap pull —
    // `needsBootstrapPull` returns true until `bootstrapComplete` is set,
    // regardless of whether the local store already has products. Mark
    // bootstrap already-done so this pull genuinely takes the incremental
    // path, matching the steady-state device this test means to model.
    markBootstrapSyncComplete("2026-09-01T00:00:00.000Z");
    await setStore({ products: [localProduct(KEEP_1), localProduct(STALE_1)] });

    fake.client = createFakeSupabaseClient({
      // A brand-new shop scope's one-shot `needsProductCostAuthorityRefresh()`
      // routes the very first products fetch through `pullProductsFull` even
      // in incremental mode, so this needs the same is_active filtering as
      // the full-pull tests above.
      columnFilterTables: ["products"],
      tables: {
        ...organizationTablesFor(scope),
        products: [cloudProductRow(scope, KEEP_1, { updated_at: "2026-09-14T00:00:00.000Z" })],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    // No forceFull, bootstrap already complete, local is not empty -> mode resolves to "incremental".
    await expect(pullCloudAndMergeIntoStore({ pullReason: "background_sync" })).resolves.toBe(true);

    // STALE_1 is not mentioned by the (incremental) cloud payload at all —
    // ordinary incremental sync must leave it exactly as it was.
    expect(await productIds()).toEqual([KEEP_1, STALE_1].sort());
  });

  it("TEST 10 — an explicit soft-delete (is_active=false) still removes the product in full mode", async () => {
    await setStore({ products: [localProduct(KEEP_1), localProduct(STALE_1)] });

    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: {
        ...organizationTablesFor(scope),
        products: [
          cloudProductRow(scope, KEEP_1),
          cloudProductRow(scope, STALE_1, { is_active: false }),
        ],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "admin_shop_reset_signal" })).resolves.toBe(
      true,
    );

    expect(await productIds()).toEqual([KEEP_1]);
  });
});
