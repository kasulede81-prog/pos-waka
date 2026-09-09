/**
 * PHASE 0A — WAKA-09 executable regressions.
 *
 * AUDIT FINDING (WAKA-09, P1) — FIXED:
 *   `pullSalesFull` collected live sales with `.in("status", ["completed","draft"])`
 *   and then queried `.eq("status", "voided")` for tombstones. The
 *   `sales_status_check` constraint only allows
 *   `draft · completed · void · refunded · cancelled` — `'voided'` is not a
 *   legal value, so the second query always returned zero rows.
 *
 *   `voidedSaleIds` came back empty from every full / bootstrap / recovery
 *   pull. Device B kept its local copy of a sale Device A had voided, the merge
 *   reported success, and the voided sale kept contributing to revenue.
 *
 *   Incremental pull was already correct (no status filter; `parseSaleRows`
 *   classifies `void` / `refunded`). This file exercises the REAL
 *   `pullCloudAndMergeIntoStore` full path against REAL IndexedDB.
 *
 * The fake PostgREST client applies `.eq` / `.in` on `sales` so the illegal
 * `'voided'` filter cannot accidentally match a real `'void'` row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, Sale } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  activateOfflineScope,
  HARNESS_ACCOUNT_KEY,
  HARNESS_USER_ID,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { readSyncCheckpoints } from "../lib/syncCheckpoints";
import { resetShopCtxTickForTests } from "../lib/shopSyncContext";

const SALE_VOID_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_LIVE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SALE_SHOP_A_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SHOP_A = "99999999-9999-4999-8999-999999999999";
const SERVER_NOW = "2026-07-10T00:00:00.000Z";

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

function product(): Product {
  return {
    id: PRODUCT_ID,
    name: "Cooking oil 1L",
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 8_000,
    costPricePerUnitUgx: 6_000,
    stockOnHand: 12,
    minimumStockAlert: 2,
    category: "grocery",
    sku: "OIL-1L",
    updatedAt: "2026-09-05T09:00:00.000Z",
    version: 1,
  };
}

function localSale(id: string, total = 10_000): Sale {
  return {
    id,
    status: "completed",
    lines: [],
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: 2_000,
    createdAt: "2026-09-05T09:00:00.000Z",
    pendingSync: false,
  };
}

function cloudSaleRow(scope: OfflineScope, id: string, status: string, shopId = scope.shopId) {
  return {
    id,
    shop_id: shopId,
    status,
    total_ugx: 10_000,
    subtotal_ugx: 10_000,
    cash_amount_ugx: 10_000,
    debt_amount_ugx: 0,
    created_at: "2026-09-05T09:00:00.000Z",
    updated_at: "2026-09-05T09:00:00.000Z",
    sale_line_items: [],
    metadata: {},
  };
}

function snapshotPayload(sales: Sale[]) {
  return {
    products: [product()],
    customers: [],
    sales,
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
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

function makeClient(
  scope: OfflineScope,
  tables: Record<string, unknown[]>,
  opts?: { throwSales?: boolean; serverNow?: string },
): void {
  const client = createFakeSupabaseClient({
    user: {
      id: HARNESS_USER_ID,
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
    rpc: { shop_server_now: opts?.serverNow ?? SERVER_NOW },
    columnFilterTables: ["sales"],
  });
  if (opts?.throwSales) {
    const origFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table === "sales") throw new Error("sales_pull_denied");
      return origFrom(table);
    }) as FakeSupabaseClient["from"];
  }
  fake.client = client;
}

describe("WAKA-09 — snapshot write / rotation / fallback", () => {
  let scope: OfflineScope;

  beforeEach(() => {
    scope = activateOfflineScope();
  });

  it("1 — a valid snapshot writes and restores from IndexedDB", async () => {
    const { writeSnapshot, readSnapshot } = await import("./localDb");
    await writeSnapshot(snapshotPayload([localSale(SALE_LIVE_ID)]));
    const restored = await readSnapshot();
    expect(restored?.sales?.map((s) => s.id)).toEqual([SALE_LIVE_ID]);
    expect(restored?.products?.map((p) => p.id)).toEqual([PRODUCT_ID]);
    expect(restored?.preferences).toBeTruthy();
  });

  it("2 — snapshot rotation keeps the previous payload as last-good", async () => {
    const { writeSnapshot, readSnapshot, getLocalDb } = await import("./localDb");
    await writeSnapshot(snapshotPayload([localSale(SALE_LIVE_ID)]));
    await writeSnapshot(snapshotPayload([localSale(SALE_VOID_ID)]));

    const main = await readSnapshot();
    expect(main?.sales?.map((s) => s.id)).toEqual([SALE_VOID_ID]);

    const db = await getLocalDb();
    const lastGood = (await db.get("kv", `${scope.namespace}::last_good_snapshot`)) as {
      sales?: Sale[];
    } | null;
    expect(lastGood?.sales?.map((s) => s.id)).toEqual([SALE_LIVE_ID]);
  });

  it("3 — an incomplete snapshot write does not become the active snapshot", async () => {
    const { writeSnapshot, readSnapshot } = await import("./localDb");
    await writeSnapshot(snapshotPayload([localSale(SALE_LIVE_ID)]));
    await writeSnapshot({ products: [] } as never);
    const restored = await readSnapshot();
    expect(restored?.sales?.map((s) => s.id)).toEqual([SALE_LIVE_ID]);
  });

  it("4 — a corrupted active snapshot falls back to last-good without destroying it", async () => {
    const { writeSnapshot, readSnapshotWithFallback, getLocalDb } = await import("./localDb");
    await writeSnapshot(snapshotPayload([localSale(SALE_LIVE_ID)]));
    await writeSnapshot(snapshotPayload([localSale(SALE_VOID_ID)]));

    const db = await getLocalDb();
    await db.put("kv", { not: "a snapshot" }, `${scope.namespace}::snapshot`);

    const restored = await readSnapshotWithFallback();
    expect(restored?.sales?.map((s) => s.id)).toEqual([SALE_LIVE_ID]);
  });
});

describe("WAKA-09 — full/bootstrap pull tombstones voided sales", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    resetShopCtxTickForTests();
    scope = activateOfflineScope();
    await setStore({
      _hydrated: true,
      products: [product()],
      sales: [localSale(SALE_VOID_ID, 25_000)],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
  });

  it("9 — pullCloudAndMergeIntoStore full pull tombstones a locally held voided sale", async () => {
    makeClient(scope, {
      sales: [
        cloudSaleRow(scope, SALE_VOID_ID, "void"),
        cloudSaleRow(scope, SALE_LIVE_ID, "completed"),
      ],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "full_sync" })).resolves.toBe(true);

    const state = await getStore();
    expect(state.sales.find((s) => s.id === SALE_VOID_ID)).toBeUndefined();
    expect(state.sales.find((s) => s.id === SALE_LIVE_ID)).toBeTruthy();

    const { readEntityManifest } = await import("./entityStore");
    const manifest = await readEntityManifest();
    expect(manifest?.voidedSaleIds?.[SALE_VOID_ID]).toBeTruthy();
  });

  it("5 — recovery does not claim success when sales hydration fails", async () => {
    makeClient(scope, { sales: [cloudSaleRow(scope, SALE_VOID_ID, "void")] }, { throwSales: true });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, cloudRecovery: true, pullReason: "cloud_recovery" }),
    ).rejects.toThrow("cloud_pull_entity_failed");

    const state = await getStore();
    expect(state.sales.find((s) => s.id === SALE_VOID_ID)?.totalUgx).toBe(25_000);
    expect(readSyncCheckpoints().bootstrapComplete).toBe(false);
  });

  it("6 — a successful full pull seeds checkpoints from server now, not the client clock", async () => {
    makeClient(
      scope,
      {
        sales: [
          cloudSaleRow(scope, SALE_VOID_ID, "void"),
          cloudSaleRow(scope, SALE_LIVE_ID, "completed"),
        ],
      },
      { serverNow: SERVER_NOW },
    );

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const cp = readSyncCheckpoints();
    expect(cp.bootstrapComplete).toBe(true);
    expect(cp.lastSalesSyncAt).toBe(SERVER_NOW);
  });

  it("6b — a failed sales pull does not mark bootstrap complete", async () => {
    makeClient(scope, { sales: [cloudSaleRow(scope, SALE_LIVE_ID, "completed")] }, { throwSales: true });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);
    expect(readSyncCheckpoints().bootstrapComplete).toBe(false);
    expect((await getStore()).sales.find((s) => s.id === SALE_VOID_ID)).toBeTruthy();
  });

  it("7 — Shop A void tombstones do not apply while Shop B is active", async () => {
    makeClient(scope, {
      sales: [
        cloudSaleRow(scope, SALE_SHOP_A_ID, "void", SHOP_A),
        cloudSaleRow(scope, SALE_LIVE_ID, "completed"),
      ],
    });
    await setStore({
      _hydrated: true,
      products: [product()],
      sales: [localSale(SALE_LIVE_ID), localSale(SALE_SHOP_A_ID)],
      customers: [],
      debtPayments: [],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);

    const state = await getStore();
    expect(state.sales.find((s) => s.id === SALE_LIVE_ID)).toBeTruthy();
    expect(state.sales.find((s) => s.id === SALE_SHOP_A_ID)).toBeTruthy();
    const { readEntityManifest } = await import("./entityStore");
    const manifest = await readEntityManifest();
    expect(manifest?.voidedSaleIds?.[SALE_SHOP_A_ID]).toBeFalsy();
  });

  it("8 — a failed recovery leaves local state intact and is retryable", async () => {
    makeClient(
      scope,
      {
        sales: [
          cloudSaleRow(scope, SALE_VOID_ID, "void"),
          cloudSaleRow(scope, SALE_LIVE_ID, "completed"),
        ],
      },
      { throwSales: true },
    );

    const { pullCloudAndMergeIntoStore, pullShopDataFromCloud } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, cloudRecovery: true })).rejects.toThrow(
      "cloud_pull_entity_failed",
    );

    expect((await getStore()).sales.find((s) => s.id === SALE_VOID_ID)?.totalUgx).toBe(25_000);

    makeClient(scope, {
      sales: [
        cloudSaleRow(scope, SALE_VOID_ID, "void"),
        cloudSaleRow(scope, SALE_LIVE_ID, "completed"),
      ],
    });
    const preview = await pullShopDataFromCloud({ forceFull: true });
    expect(preview?.voidedSaleIds).toContain(SALE_VOID_ID);
    await expect(pullCloudAndMergeIntoStore({ forceFull: true })).resolves.toBe(true);
    expect((await getStore()).sales.find((s) => s.id === SALE_VOID_ID)).toBeUndefined();
    expect((await getStore()).sales.find((s) => s.id === SALE_LIVE_ID)).toBeTruthy();
  });
});

describe("WAKA-09 — shop-scoped snapshot isolation", () => {
  it("7b — restoring Shop A snapshot cannot leak into Shop B's namespace", async () => {
    const { writeSnapshot, readSnapshot } = await import("./localDb");
    const shopA = activateOfflineScope();
    await writeSnapshot(snapshotPayload([localSale(SALE_SHOP_A_ID)]));

    const shopB = activateOfflineScope();
    await writeSnapshot(snapshotPayload([localSale(SALE_LIVE_ID)]));

    expect((await readSnapshot())?.sales?.map((s) => s.id)).toEqual([SALE_LIVE_ID]);

    const { setActiveShopId } = await import("./shopScope");
    const { setActiveAccountKey } = await import("./accountScope");
    setActiveAccountKey(HARNESS_ACCOUNT_KEY);
    setActiveShopId(shopA.shopId);
    expect((await readSnapshot())?.sales?.map((s) => s.id)).toEqual([SALE_SHOP_A_ID]);

    setActiveShopId(shopB.shopId);
    expect((await readSnapshot())?.sales?.map((s) => s.id)).toEqual([SALE_LIVE_ID]);
  });
});
