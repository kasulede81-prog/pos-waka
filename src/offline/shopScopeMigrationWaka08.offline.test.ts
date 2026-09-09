/**
 * PHASE 0A — WAKA-08 executable regression tests: multi-shop local isolation.
 *
 * AUDIT FINDING (WAKA-08, P1) — FIXED:
 *   `migrateLegacyPersistenceToShop` copied legacy account KV rows
 *   (`sb:<uid>::…`) into the first shop's namespace and left the originals in
 *   place. The claim flag was per shop, so the second shop on the same device
 *   saw leftover legacy + empty own namespace and inherited Shop A's snapshot.
 *
 *   The fix moves (copy then delete) the legacy KV rows and records a single
 *   account-wide "legacy claimed by shop X" flag. Leftover unscoped rows are
 *   dropped when another shop already owns a scoped partition.
 *
 * WHAT THIS FILE DOES:
 *   Real `localDb` / `entityStore` / `syncEngine` / `shopScopeMigration` /
 *   `switchActiveShop` / `bootstrapPosFromDisk` / `pullCloudAndMergeIntoStore`
 *   against fake-indexeddb. Only the network boundary (`src/lib/supabase`) is
 *   faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Product, SyncOperation } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  HARNESS_ACCOUNT_KEY,
  HARNESS_USER_ID,
  clearOfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { setActiveAccountKey } from "./accountScope";
import { setActiveShopId } from "./shopScope";
import { getLocalDb, readKv, readSnapshotWithFallback, readSyncQueue } from "./localDb";
import { getEntitiesByBucket, putEntity } from "./entityStore";
import { migrateLegacyPersistenceToShop } from "./shopScopeMigration";
import { enqueueSync, flushSyncQueueInner } from "./syncEngine";
import { writeSyncCheckpoints, readSyncCheckpoints } from "../lib/syncCheckpoints";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_A = "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PRODUCT_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CUSTOMER_A = "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CUSTOMER_B = "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const OP_A = "op-shop-a-purchase";

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

// bootstrapPosFromDisk schedules post-bootstrap cloud work. In this project that
// dynamic import hits a store ↔ hydrate cycle; skip it so the isolation tests
// are not racing a background recovery lock.
vi.mock("../lib/postAuthCloudHydrate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/postAuthCloudHydrate")>();
  return {
    ...actual,
    shouldRequireRecoveryLock: async () => true,
  };
});

function product(id: string, name: string): Product {
  return {
    id,
    name,
    sellingMode: "unit",
    baseUnit: "ea",
    buyingUnit: null,
    conversionRate: null,
    sellingPricePerUnitUgx: 5_000,
    costPricePerUnitUgx: 4_000,
    stockOnHand: 10,
    minimumStockAlert: 2,
    category: "test",
    sku: name.replace(/\s+/g, "-").toLowerCase(),
    updatedAt: "2026-09-01T10:00:00.000Z",
    version: 1,
  };
}

function customer(id: string, name: string): Customer {
  return {
    id,
    name,
    phone: "+256700000000",
    location: name,
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    version: 1,
    debtBalanceUgx: 0,
  };
}

function snapshotFor(products: Product[], customers: Customer[] = []) {
  return {
    products,
    customers,
    sales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
}

function membershipTables() {
  return {
    profiles: [{ id: HARNESS_USER_ID, primary_shop_id: SHOP_A }],
    shop_members: [
      {
        shop_id: SHOP_A,
        user_id: HARNESS_USER_ID,
        role: "owner",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        shop_id: SHOP_B,
        user_id: HARNESS_USER_ID,
        role: "manager",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    shops: [
      { id: SHOP_A, organization_id: ORG_ID },
      { id: SHOP_B, organization_id: ORG_ID },
    ],
  };
}

function installFakeClient(tables: Record<string, unknown[]> = {}) {
  fake.client = createFakeSupabaseClient({
    user: {
      id: HARNESS_USER_ID,
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...membershipTables(), ...tables },
    rpc: {
      list_user_shops: [
        {
          shop_id: SHOP_A,
          shop_name: "Shop A",
          organization_id: ORG_ID,
          role: "owner",
          is_primary: true,
        },
        {
          shop_id: SHOP_B,
          shop_name: "Shop B",
          organization_id: ORG_ID,
          role: "manager",
          is_primary: false,
        },
      ],
    },
  });
}

function activateShop(shopId: string): void {
  setActiveAccountKey(HARNESS_ACCOUNT_KEY);
  setActiveShopId(shopId);
}

async function wipeOfflineDb(): Promise<void> {
  const db = await getLocalDb();
  await db.clear("kv");
  await db.clear("records");
  await db.clear("syncQueue");
  if (db.objectStoreNames.contains("backups")) await db.clear("backups");
}

async function seedLegacySnapshot(): Promise<void> {
  const db = await getLocalDb();
  const snap = snapshotFor([product(PRODUCT_A, "Shop A Sugar")], [customer(CUSTOMER_A, "Shop A Customer")]);
  await db.put("kv", snap, `${HARNESS_ACCOUNT_KEY}::snapshot`);
  await db.put("kv", snap, `${HARNESS_ACCOUNT_KEY}::last_good_snapshot`);
}

async function kvKeys(): Promise<string[]> {
  const db = await getLocalDb();
  return (await db.getAllKeys("kv")).map(String);
}

function cloudCustomerRow(shopId: string, id: string, name: string) {
  return {
    id,
    shop_id: shopId,
    name,
    phone_e164: "+256700000099",
    notes: name,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-09-06T09:00:00.000Z",
    metadata: {
      location: name,
      version: 2,
      debtBalanceUgx: 0,
      phone: "+256700000099",
      wakaClient: true,
    },
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

describe("WAKA-08 — multi-shop IndexedDB / queue / snapshot isolation", () => {
  beforeEach(async () => {
    localStorage.clear();
    await wipeOfflineDb();
    clearOfflineScope();
    activateShop(SHOP_A);
    installFakeClient();
    await setStore({
      _hydrated: true,
      products: [],
      customers: [],
      sales: [],
      debtPayments: [],
    });
  });

  it("moves legacy KV to Shop A and leaves Shop B empty (audit reproduction)", async () => {
    await seedLegacySnapshot();

    const moved = await migrateLegacyPersistenceToShop(SHOP_A);
    expect(moved).toEqual({ migrated: true, reason: "copied" });
    expect(localStorage.getItem(`waka.mb1.shop-scope.legacy-claimed.v1::${HARNESS_ACCOUNT_KEY}`)).toBe(
      SHOP_A,
    );

    const keysAfterA = await kvKeys();
    expect(keysAfterA.some((k) => k.startsWith(`${HARNESS_ACCOUNT_KEY}::`))).toBe(false);
    expect(keysAfterA.some((k) => k.startsWith(`${HARNESS_ACCOUNT_KEY}:${SHOP_A}::`))).toBe(true);

    activateShop(SHOP_A);
    const snapA = await readSnapshotWithFallback();
    expect(snapA?.products?.map((p) => p.id)).toEqual([PRODUCT_A]);
    expect(snapA?.products?.[0]?.name).toBe("Shop A Sugar");

    activateShop(SHOP_B);
    const second = await migrateLegacyPersistenceToShop(SHOP_B);
    expect(second.migrated).toBe(false);
    expect(second.reason).toBe("claimed_elsewhere");

    expect(await readSnapshotWithFallback()).toBeNull();
    expect((await kvKeys()).some((k) => k.startsWith(`${HARNESS_ACCOUNT_KEY}:${SHOP_B}::`))).toBe(false);
  });

  it("does not copy leftover legacy into Shop B when Shop A already has a scoped partition", async () => {
    const db = await getLocalDb();
    const snap = snapshotFor([product(PRODUCT_A, "Shop A Sugar")]);
    await db.put("kv", snap, `${HARNESS_ACCOUNT_KEY}::snapshot`);
    await db.put("kv", snap, `${HARNESS_ACCOUNT_KEY}:${SHOP_A}::snapshot`);

    activateShop(SHOP_B);
    const result = await migrateLegacyPersistenceToShop(SHOP_B);
    expect(result).toEqual({ migrated: false, reason: "claimed_elsewhere" });

    activateShop(SHOP_B);
    expect(await readSnapshotWithFallback()).toBeNull();
    expect((await kvKeys()).some((k) => k.startsWith(`${HARNESS_ACCOUNT_KEY}::`))).toBe(false);

    activateShop(SHOP_A);
    expect((await readSnapshotWithFallback())?.products?.[0]?.name).toBe("Shop A Sugar");
  });

  it("Shop A records cannot appear in Shop B, and Shop B records cannot appear in Shop A", async () => {
    activateShop(SHOP_A);
    await putEntity("product", PRODUCT_A, product(PRODUCT_A, "Shop A Sugar"), "2026-09-01T10:00:00.000Z");
    await putEntity("customer", CUSTOMER_A, customer(CUSTOMER_A, "Shop A Customer"));

    activateShop(SHOP_B);
    await putEntity("product", PRODUCT_B, product(PRODUCT_B, "Shop B Salt"), "2026-09-01T10:00:00.000Z");
    await putEntity("customer", CUSTOMER_B, customer(CUSTOMER_B, "Shop B Customer"));

    activateShop(SHOP_A);
    const aProducts = await getEntitiesByBucket<Product>("product");
    const aCustomers = await getEntitiesByBucket<Customer>("customer");
    expect(aProducts.map((p) => p.name)).toEqual(["Shop A Sugar"]);
    expect(aCustomers.map((c) => c.name)).toEqual(["Shop A Customer"]);
    expect(aProducts.some((p) => p.id === PRODUCT_B)).toBe(false);
    expect(aCustomers.some((c) => c.id === CUSTOMER_B)).toBe(false);

    activateShop(SHOP_B);
    const bProducts = await getEntitiesByBucket<Product>("product");
    const bCustomers = await getEntitiesByBucket<Customer>("customer");
    expect(bProducts.map((p) => p.name)).toEqual(["Shop B Salt"]);
    expect(bCustomers.map((c) => c.name)).toEqual(["Shop B Customer"]);
    expect(bProducts.some((p) => p.id === PRODUCT_A)).toBe(false);
    expect(bCustomers.some((c) => c.id === CUSTOMER_A)).toBe(false);
  });

  it("a queued Shop A mutation cannot run while Shop B is active or against Shop B", async () => {
    activateShop(SHOP_A);
    await enqueueSync({
      id: OP_A,
      kind: "pending_purchases",
      payload: { purchaseId: "ccccccc1-cccc-4ccc-8ccc-ccccccccccc1" },
      createdAt: "2026-09-01T10:00:00.000Z",
    });

    const queuedA = await readSyncQueue();
    expect(queuedA).toHaveLength(1);
    expect(queuedA[0]?.id).toBe(OP_A);
    expect((queuedA[0] as SyncOperation & { shopId?: string }).shopId).toBe(SHOP_A);
    expect((queuedA[0] as SyncOperation & { accountKey?: string }).accountKey).toBe(
      `${HARNESS_ACCOUNT_KEY}:${SHOP_A}`,
    );

    const { switchActiveShop } = await import("../lib/activeShopSwitch");
    const switched = await switchActiveShop(SHOP_B);
    expect(switched.ok).toBe(true);

    expect(await readSyncQueue()).toEqual([]);

    await setStore({ _hydrated: true });
    const writesBefore = fake.client?.writes.length ?? 0;
    const rpcsBefore = fake.client?.rpcCalls.length ?? 0;
    const flushB = await flushSyncQueueInner();
    expect(flushB.remaining).toBe(0);
    expect(flushB.failed).toBe(0);
    expect(fake.client?.writes.length ?? 0).toBe(writesBefore);
    const newRpcs = (fake.client?.rpcCalls ?? []).slice(rpcsBefore);
    expect(newRpcs.some((c) => c.args && c.args["p_shop_id"] === SHOP_B)).toBe(false);

    const db = await getLocalDb();
    const raw = (await db.getAll("syncQueue")) as Array<SyncOperation & { shopId?: string; accountKey?: string }>;
    const stillA = raw.find((op) => op.id === OP_A);
    expect(stillA, "Shop A op must remain in its own partition").toBeTruthy();
    expect(stillA?.shopId).toBe(SHOP_A);
    expect(stillA?.accountKey).toBe(`${HARNESS_ACCOUNT_KEY}:${SHOP_A}`);

    activateShop(SHOP_A);
    expect((await readSyncQueue()).map((op) => op.id)).toEqual([OP_A]);
  });

  it("shop-switch bootstrap does not hydrate Shop A snapshot into Shop B", async () => {
    await seedLegacySnapshot();
    activateShop(SHOP_A);
    await migrateLegacyPersistenceToShop(SHOP_A);

    const { bootstrapPosFromDisk } = await import("../store/usePosStore");
    await bootstrapPosFromDisk();
    expect((await getStore()).products.map((p) => p.name)).toContain("Shop A Sugar");

    writeSyncCheckpoints({
      bootstrapComplete: true,
      lastProductsSyncAt: "2026-09-01T10:00:00.000Z",
    });
    expect(readSyncCheckpoints().lastProductsSyncAt).toBe("2026-09-01T10:00:00.000Z");

    const { switchActiveShop } = await import("../lib/activeShopSwitch");
    expect((await switchActiveShop(SHOP_B)).ok).toBe(true);

    const stateB = await getStore();
    expect(stateB.products.some((p) => p.id === PRODUCT_A || p.name === "Shop A Sugar")).toBe(false);
    expect(stateB.customers.some((c) => c.id === CUSTOMER_A || c.name === "Shop A Customer")).toBe(false);
    expect(await readKv("snapshot")).toBeNull();
    expect(readSyncCheckpoints().lastProductsSyncAt).toBeNull();
    expect(readSyncCheckpoints().bootstrapComplete).toBe(false);

    activateShop(SHOP_A);
    expect(readSyncCheckpoints().lastProductsSyncAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("isolation survives a Shop B sync cycle after the Shop A → Shop B switch", async () => {
    await seedLegacySnapshot();
    activateShop(SHOP_A);
    await migrateLegacyPersistenceToShop(SHOP_A);
    const { bootstrapPosFromDisk } = await import("../store/usePosStore");
    await bootstrapPosFromDisk();

    const { switchActiveShop } = await import("../lib/activeShopSwitch");
    expect((await switchActiveShop(SHOP_B)).ok).toBe(true);

    const afterSwitch = await getStore();
    expect(afterSwitch.products.some((p) => p.id === PRODUCT_A || p.name === "Shop A Sugar")).toBe(false);

    installFakeClient({
      customers: [cloudCustomerRow(SHOP_B, CUSTOMER_B, "Shop B Customer")],
      products: [],
      sales: [],
    });
    // Keep whatever bootstrap hydrated (would be Shop A data if WAKA-08 still leaked).
    // Seed a Shop B customer only when B is actually empty so the pull takes the
    // normal merge path instead of cloud-recovery restore.
    await setStore({
      ...afterSwitch,
      _hydrated: true,
      customers:
        afterSwitch.customers.length > 0
          ? afterSwitch.customers
          : [customer(CUSTOMER_B, "Shop B Customer")],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ pullReason: "full_sync" })).resolves.toBe(true);

    const state = await getStore();
    expect(state.products.some((p) => p.id === PRODUCT_A || p.name === "Shop A Sugar")).toBe(false);
    expect(state.customers.some((c) => c.id === CUSTOMER_A || c.name === "Shop A Customer")).toBe(false);
    expect(state.customers.some((c) => c.id === CUSTOMER_B && c.name === "Shop B Customer")).toBe(true);

    activateShop(SHOP_A);
    const snapA = await readSnapshotWithFallback();
    const entitiesA = await getEntitiesByBucket<Product>("product");
    const customersA = await getEntitiesByBucket<Customer>("customer");
    const aNames = [
      ...(snapA?.products ?? []).map((p) => p.name),
      ...entitiesA.map((p) => p.name),
    ];
    expect(aNames).toContain("Shop A Sugar");
    expect(customersA.some((c) => c.id === CUSTOMER_B || c.name === "Shop B Customer")).toBe(false);
    expect((snapA?.customers ?? []).some((c) => c.id === CUSTOMER_B)).toBe(false);
  });
});
