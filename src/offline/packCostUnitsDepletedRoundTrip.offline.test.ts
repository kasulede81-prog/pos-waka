/**
 * P0 FIX — FRACTIONAL PACK-PRICED SALE COGS — persistence/sync proof.
 *
 * A fractional-quantity sale (e.g. 2.5 kg) leaves a product's
 * `packCostUnitsDepleted` counter fractional (e.g. 2.5). Two bugs used to
 * silently floor that fraction away:
 *   1. `resolvePackCostUnitsDepleted` (costPrecision.ts) floored on every
 *      read — fixed in the same P0 change.
 *   2. `rowToProduct` (cloudSync.ts) floored on every cloud pull/merge —
 *      also fixed in the same P0 change.
 *
 * These tests run the REAL `pushProductCatalogToCloud` and
 * `pullCloudAndMergeIntoStore` against the REAL `localDb`/`usePosStore`,
 * per the existing WAKA-01 harness convention — only the network boundary
 * (`src/lib/supabase`) is faked — to prove a fractional depletion value
 * survives local persistence → cloud push → cloud pull → reconstruction,
 * end to end, through the actual production code path (not a re-implemented
 * copy of the logic under test).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../types";
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

const BASIMAT = "e0000000-0000-4000-8000-000000000001";

function basimatProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: BASIMAT,
    name: "Basimat",
    sellingMode: "weighted",
    baseUnit: "kg",
    sellingPricePerUnitUgx: 4000,
    costPricePerUnitUgx: 3000,
    buyingPackCostUgx: 75_000,
    conversionRate: 25,
    stockOnHand: 121.5,
    minimumStockAlert: 5,
    category: "Groceries",
    sku: "SKU-BASI",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function cloudProductRow(scope: OfflineScope, id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    shop_id: scope.shopId,
    name: "Basimat",
    sku: "SKU-BASI",
    unit: "kg",
    base_unit: "kg",
    selling_mode: "weighted",
    selling_price_per_unit_ugx: 4000,
    cost_price_per_unit_ugx: 3000,
    stock_on_hand: 121.5,
    minimum_stock_alert: 5,
    is_active: true,
    metadata: { category: "Groceries", version: 1, exactCostPricePerUnitUgx: 3000, buyingPackCostUgx: 75_000 },
    conversion_rate: 25,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-13T22:01:00.000Z",
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

describe("P0 FIX — packCostUnitsDepleted survives push/pull without flooring fractional progress", () => {
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

  it("PUSH — pushProductCatalogToCloud sends the fractional depletion counter unfloored", async () => {
    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: { ...organizationTablesFor(scope), products: [] },
    });

    const { pushProductCatalogToCloud } = await import("./cloudSync");
    const product = basimatProduct({ packCostUnitsDepleted: 2.5 });

    const ok = await pushProductCatalogToCloud(product, { shopId: scope.shopId, userId: "user-1" }, { includeStock: true });
    expect(ok).toBe(true);

    const write = fake.client!.writes.find((w) => w.table === "products" && w.op === "upsert");
    expect(write).toBeDefined();
    const payload = write!.payload as { metadata: { packCostUnitsDepleted: number } };
    expect(payload.metadata.packCostUnitsDepleted).toBe(2.5);
    expect(payload.metadata.packCostUnitsDepleted).not.toBe(2); // not floored on the way out
  });

  it("PULL — pullCloudAndMergeIntoStore reconstructs the fractional depletion counter without flooring it", async () => {
    fake.client = createFakeSupabaseClient({
      user: { id: HARNESS_USER_ID, email: "harness@waka.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      columnFilterTables: ["products"],
      tables: {
        ...organizationTablesFor(scope),
        products: [cloudProductRow(scope, BASIMAT, { metadata: { category: "Groceries", version: 1, packCostUnitsDepleted: 2.5 } })],
      },
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, cloudRecovery: true, pullReason: "cloud_recovery" }),
    ).resolves.toBe(true);

    const product = (await getStore()).products.find((p) => p.id === BASIMAT);
    expect(product).toBeDefined();
    expect(product!.packCostUnitsDepleted).toBe(2.5);
    expect(product!.packCostUnitsDepleted).not.toBe(2); // not floored on the way in
  });

  it("FULL ROUND TRIP — a local fractional depletion value (2.5) survives push → cloud row → pull → reconstructed product, unchanged", async () => {
    fake.client = createFakeSupabaseClient({
      columnFilterTables: ["products"],
      tables: { ...organizationTablesFor(scope), products: [] },
    });

    // 1. A device finalizes a fractional sale locally: packCostUnitsDepleted becomes 2.5.
    const localAfterSale = basimatProduct({ packCostUnitsDepleted: 2.5 });

    // 2. That product gets pushed to the cloud (the real productToRow path).
    const { pushProductCatalogToCloud, pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await pushProductCatalogToCloud(localAfterSale, { shopId: scope.shopId, userId: "user-1" }, { includeStock: true });
    const pushedRow = fake.client!.writes.find((w) => w.table === "products" && w.op === "upsert")!.payload;

    // 3. Simulate the cloud now serving exactly what was pushed (as a second
    //    device, or the same device after a cache clear, would pull it back).
    fake.client = createFakeSupabaseClient({
      user: { id: HARNESS_USER_ID, email: "harness@waka.test", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
      columnFilterTables: ["products"],
      tables: { ...organizationTablesFor(scope), products: [pushedRow as Record<string, unknown>] },
    });
    await setStore({ products: [] }); // simulate a fresh device with nothing local yet

    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, cloudRecovery: true, pullReason: "cloud_recovery" }),
    ).resolves.toBe(true);

    // 4. The reconstructed product must still show 2.5 — not 2, not 3, not 0.
    const reconstructed = (await getStore()).products.find((p) => p.id === BASIMAT);
    expect(reconstructed).toBeDefined();
    expect(reconstructed!.packCostUnitsDepleted).toBe(2.5);
  });
});
