/**
 * PHASE 0A — WAKA-10 executable regressions.
 *
 * AUDIT FINDING (WAKA-10, P1) — FIXED:
 *   Receipt numbers were `scanTodaySalesHead(state.sales).nextReceiptSeq` —
 *   max local `receiptSeq` plus one. Two tills in one shop that each completed
 *   a sale on the same Kampala day before syncing minted the same number
 *   (both printed #14). Sale UUIDs were already unique; the failure is receipt
 *   identity, not sale ids.
 *
 *   The client now stamps a device-qualified identity at completion
 *   (`receiptTerminal` + `receiptSeq`), persists it in sale cloud metadata,
 *   prints that stamped value, and refuses to rewrite it on pull / recovery.
 *
 * This file exercises the REAL `pullCloudAndMergeIntoStore` and
 * `flushSyncQueueInner` against REAL IndexedDB. Only `src/lib/supabase` is faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, Sale, SyncOperation } from "../types";
import {
  activateOfflineScope,
  HARNESS_USER_ID,
  organizationTablesFor,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import { createFakeSupabaseClient, type FakeSupabaseClient } from "../test/offline/fakeSupabase";
import { resetShopCtxTickForTests } from "../lib/shopSyncContext";
import {
  formatPersistedReceiptIdentity,
  saleReceiptIdentityKey,
} from "../lib/receiptIdentity";

const SALE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRODUCT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SERVER_NOW = "2026-09-08T12:00:00.000Z";
const CREATED = "2026-09-08T10:00:00.000Z";
const OP_ID = "op-sale-waka10";

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
    updatedAt: "2026-09-08T09:00:00.000Z",
    version: 1,
  };
}

function localSale(
  id: string,
  identity: { receiptSeq: number; receiptTerminal: string },
  total = 10_000,
): Sale {
  return {
    id,
    status: "completed",
    lines: [],
    subtotalUgx: total,
    totalUgx: total,
    cashPaidUgx: total,
    debtUgx: 0,
    estimatedProfitUgx: 2_000,
    createdAt: CREATED,
    updatedAt: CREATED,
    pendingSync: true,
    receiptSeq: identity.receiptSeq,
    receiptTerminal: identity.receiptTerminal,
  };
}

function cloudSaleRow(
  scope: OfflineScope,
  id: string,
  metadata: Record<string, unknown> = {},
) {
  return {
    id,
    shop_id: scope.shopId,
    status: "completed",
    total_ugx: 10_000,
    subtotal_ugx: 10_000,
    cash_amount_ugx: 10_000,
    debt_amount_ugx: 0,
    created_at: CREATED,
    completed_at: CREATED,
    updated_at: CREATED,
    sale_line_items: [],
    metadata,
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
  rpc: Record<string, unknown> = {},
): FakeSupabaseClient {
  const client = createFakeSupabaseClient({
    user: {
      id: HARNESS_USER_ID,
      email: "harness@waka.test",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
    },
    tables: { ...organizationTablesFor(scope), ...tables },
    rpc: { shop_server_now: SERVER_NOW, ...rpc },
    columnFilterTables: ["sales"],
  });
  fake.client = client;
  return client;
}

describe("WAKA-10 — receipt identity across pull, retry, and recovery", () => {
  let scope: OfflineScope;

  beforeEach(async () => {
    resetShopCtxTickForTests();
    scope = activateOfflineScope();
    await setStore({
      _hydrated: true,
      products: [product()],
      sales: [],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
  });

  it("2 / 8 — two devices' same-day seq 14 sales stay distinct after cloud merge", async () => {
    const saleA = localSale(SALE_A, { receiptSeq: 14, receiptTerminal: "AAAA" });
    await setStore({
      _hydrated: true,
      products: [product()],
      sales: [saleA],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
    makeClient(scope, {
      sales: [
        cloudSaleRow(scope, SALE_A, { receiptSeq: 14, receiptTerminal: "AAAA" }),
        cloudSaleRow(scope, SALE_B, { receiptSeq: 14, receiptTerminal: "BBBB" }),
      ],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "full_sync" })).resolves.toBe(true);

    const state = await getStore();
    const a = state.sales.find((s) => s.id === SALE_A);
    const b = state.sales.find((s) => s.id === SALE_B);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(formatPersistedReceiptIdentity(a!)).toBe("AAAA-014");
    expect(formatPersistedReceiptIdentity(b!)).toBe("BBBB-014");
    expect(saleReceiptIdentityKey(a!)).not.toBe(saleReceiptIdentityKey(b!));
    expect(saleReceiptIdentityKey(a!)).not.toBeNull();
    expect(saleReceiptIdentityKey(b!)).not.toBeNull();
  });

  it("4 / 5 — reconnect pull restores the stamped identity from cloud metadata", async () => {
    makeClient(scope, {
      sales: [cloudSaleRow(scope, SALE_A, { receiptSeq: 14, receiptTerminal: "AAAA" })],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(pullCloudAndMergeIntoStore({ forceFull: true, pullReason: "full_sync" })).resolves.toBe(true);

    const pulled = (await getStore()).sales.find((s) => s.id === SALE_A);
    expect(pulled?.receiptSeq).toBe(14);
    expect(pulled?.receiptTerminal).toBe("AAAA");
    expect(formatPersistedReceiptIdentity(pulled!)).toBe("AAAA-014");
  });

  it("6 — bootstrap/recovery does not rewrite a locally stamped receipt identity", async () => {
    const local = localSale(SALE_A, { receiptSeq: 14, receiptTerminal: "AAAA" });
    await setStore({
      _hydrated: true,
      products: [product()],
      sales: [local],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });
    makeClient(scope, {
      sales: [
        cloudSaleRow(scope, SALE_A, {
          receiptSeq: 99,
          receiptTerminal: "ZZZZ",
          estimatedProfitUgx: 2_000,
        }),
      ],
    });

    const { pullCloudAndMergeIntoStore } = await import("./cloudSync");
    await expect(
      pullCloudAndMergeIntoStore({ forceFull: true, cloudRecovery: true, pullReason: "cloud_recovery" }),
    ).resolves.toBe(true);

    const recovered = (await getStore()).sales.find((s) => s.id === SALE_A);
    expect(recovered?.receiptSeq).toBe(14);
    expect(recovered?.receiptTerminal).toBe("AAAA");
    expect(formatPersistedReceiptIdentity(recovered!)).toBe("AAAA-014");
  });

  it("3 / 4 — retry of the same queued sale pushes one identity and does not mint a second sale", async () => {
    const queued = localSale(SALE_A, { receiptSeq: 14, receiptTerminal: "AAAA" });
    await setStore({
      _hydrated: true,
      products: [product()],
      sales: [queued],
      customers: [],
      debtPayments: [],
      dayCloses: [],
    });

    const client = makeClient(scope, { sales: [], products: [] }, {});
    const origRpc = client.rpc.bind(client);
    let completeCalls = 0;
    client.rpc = async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "shop_push_sale_complete") {
        completeCalls += 1;
        if (completeCalls === 1) {
          client.rpcCalls.push({ fn, args });
          return { data: { ok: false, error: "unavailable" }, error: null };
        }
        return origRpc(fn, args);
      }
      return origRpc(fn, args);
    };
    fake.client = client;
    fake.client.rpc = client.rpc;

    const { appendSyncOperation, readSyncQueue } = await import("./localDb");
    const op: SyncOperation = {
      id: OP_ID,
      kind: "pending_sales",
      shopId: scope.shopId,
      payload: { saleId: SALE_A },
      createdAt: CREATED,
      attempts: 0,
      lastAttemptAt: null,
    };
    await appendSyncOperation(op);

    const { flushSyncQueueInner } = await import("./syncEngine");
    const first = await flushSyncQueueInner();
    expect(completeCalls).toBe(1);
    expect(first.remaining).toBe(1);
    expect((await getStore()).sales.filter((s) => s.id === SALE_A)).toHaveLength(1);
    expect(formatPersistedReceiptIdentity((await getStore()).sales.find((s) => s.id === SALE_A)!)).toBe(
      "AAAA-014",
    );

    const [afterFail] = await readSyncQueue();
    expect(afterFail?.id).toBe(OP_ID);
    await appendSyncOperation({ ...(afterFail as SyncOperation), lastAttemptAt: null });

    fake.client.rpc = async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "shop_push_sale_complete") {
        completeCalls += 1;
        client.rpcCalls.push({ fn, args });
        return { data: { ok: true, product_stocks: [] }, error: null };
      }
      return origRpc(fn, args);
    };

    const second = await flushSyncQueueInner();
    expect(completeCalls).toBe(2);
    expect(second.remaining).toBe(0);

    const payloads = client.rpcCalls
      .filter((c) => c.fn === "shop_push_sale_complete")
      .map((c) => c.args?.p_payload as { sale?: { id?: string; metadata?: Record<string, unknown> } });
    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.sale?.id).toBe(SALE_A);
    expect(payloads[1]?.sale?.id).toBe(SALE_A);
    expect(payloads[0]?.sale?.metadata).toMatchObject({ receiptSeq: 14, receiptTerminal: "AAAA" });
    expect(payloads[1]?.sale?.metadata).toMatchObject({ receiptSeq: 14, receiptTerminal: "AAAA" });
    expect((await getStore()).sales.filter((s) => s.id === SALE_A)).toHaveLength(1);
    expect(formatPersistedReceiptIdentity((await getStore()).sales.find((s) => s.id === SALE_A)!)).toBe(
      "AAAA-014",
    );
  });
});
