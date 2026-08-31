import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "../types";

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const state = vi.hoisted(() => ({
  activeShopId: null as string | null,
  accountKey: "sb:test-user",
  queue: [] as (SyncOperation & { accountKey?: string })[],
  snapshots: new Map<string, unknown>(),
  processCalls: [] as { shopId?: string; kind: string }[],
}));

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => state.accountKey,
}));

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }),
    },
  },
}));

vi.mock("../lib/monitoring", () => ({
  reportSyncIssue: vi.fn(),
}));

vi.mock("../lib/globalSyncMutex", () => ({
  withGlobalSyncMutex: async (_name: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../lib/syncTiming", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/syncTiming")>();
  return { ...actual, SYNC_QUEUE_FLUSH_CONCURRENCY: 1 };
});

vi.mock("../offline/localDb", () => ({
  readSyncQueue: async () => {
    const { getPersistenceNamespace } = await import("../offline/shopScope");
    const ns = getPersistenceNamespace();
    if (!ns) return [];
    return state.queue.filter((op) => op.accountKey === ns);
  },
  appendSyncOperation: async (op: SyncOperation & { accountKey?: string }) => {
    const { getPersistenceNamespace } = await import("../offline/shopScope");
    const ns = getPersistenceNamespace();
    if (!ns) return;
    const row = { ...op, accountKey: ns };
    const existing = state.queue.findIndex((q) => q.id === row.id);
    if (existing >= 0) state.queue[existing] = row;
    else state.queue.push(row);
  },
  removeSyncOperation: async (id: string) => {
    state.queue = state.queue.filter((q) => q.id !== id);
  },
}));

vi.mock("../offline/cloudSync", () => ({
  processCloudSyncOperation: async (op: SyncOperation) => {
    state.processCalls.push({ shopId: op.shopId, kind: op.kind });
    return true;
  },
}));

vi.mock("../lib/organizationDeletionState", () => ({
  assertOrganizationOperationsAllowed: async () => undefined,
}));

describe("MB-1 branch-safe partition", () => {
  beforeEach(async () => {
    const { resetActiveShopForTests, setActiveShopId } = await import("../offline/shopScope");
    resetActiveShopForTests();
    setActiveShopId(SHOP_A);
    state.activeShopId = SHOP_A;
    state.queue = [];
    state.processCalls = [];
    state.snapshots.clear();
    vi.clearAllMocks();
  });

  it("T1/T5 — enqueued Shop A operation keeps A identity after switch to B", async () => {
    const { enqueueSync, flushSyncQueueInner } = await import("../offline/syncEngine");
    const { setActiveShopId } = await import("../offline/shopScope");

    await enqueueSync({
      id: "op-a-purchase",
      kind: "pending_purchases",
      payload: { purchaseId: "p1" },
      createdAt: new Date().toISOString(),
    });

    expect(state.queue[0]?.shopId).toBe(SHOP_A);
    expect(state.queue[0]?.accountKey).toBe(`sb:test-user:${SHOP_A}`);

    state.activeShopId = SHOP_B;
    setActiveShopId(SHOP_B);
    const flushB = await flushSyncQueueInner();
    expect(state.processCalls).toHaveLength(0);
    expect(flushB.remaining).toBe(0);

    state.activeShopId = SHOP_A;
    setActiveShopId(SHOP_A);
    await flushSyncQueueInner();
    expect(state.processCalls).toEqual([{ shopId: SHOP_A, kind: "pending_purchases" }]);
  });

  it("T4 — queue isolation: B context cannot consume A operation", async () => {
    state.queue.push({
      id: "op-a",
      kind: "pending_sales",
      payload: { saleId: "s1" },
      createdAt: new Date().toISOString(),
      attempts: 0,
      shopId: SHOP_A,
      accountKey: `sb:test-user:${SHOP_A}`,
    });
    state.queue.push({
      id: "op-b",
      kind: "pending_sales",
      payload: { saleId: "s2" },
      createdAt: new Date().toISOString(),
      attempts: 0,
      shopId: SHOP_B,
      accountKey: `sb:test-user:${SHOP_B}`,
    });

    const { readSyncQueue } = await import("../offline/localDb");
    const { setActiveShopId } = await import("../offline/shopScope");
    state.activeShopId = SHOP_A;
    setActiveShopId(SHOP_A);
    const aOps = await readSyncQueue();
    expect(aOps.map((o) => o.id)).toEqual(["op-a"]);

    state.activeShopId = SHOP_B;
    setActiveShopId(SHOP_B);
    const bOps = await readSyncQueue();
    expect(bOps.map((o) => o.id)).toEqual(["op-b"]);
  });

  it("T9 — legacy queue without shopId is quarantined, not sent to active shop", async () => {
    const { setActiveShopId } = await import("../offline/shopScope");
    state.queue.push({
      id: "legacy-op",
      kind: "pending_purchases",
      payload: { purchaseId: "legacy-p" },
      createdAt: new Date().toISOString(),
      attempts: 0,
      accountKey: "sb:test-user",
    });

    state.activeShopId = SHOP_B;
    setActiveShopId(SHOP_B);
    const { flushSyncQueueInner } = await import("../offline/syncEngine");
    await flushSyncQueueInner();
    expect(state.processCalls).toHaveLength(0);
  });

  it("T6 — purchase op carries shopId for durable idempotency alignment", async () => {
    const { enqueueSync } = await import("../offline/syncEngine");
    await enqueueSync({
      id: "purchase-op",
      kind: "pending_purchases",
      payload: { purchaseId: "purchase-a-1" },
      createdAt: new Date().toISOString(),
    });
    expect(state.queue[0]?.shopId).toBe(SHOP_A);
    expect(state.queue[0]?.accountKey).toBe(`sb:test-user:${SHOP_A}`);
  });

  it("T20 — R3 adjustment shopId is immutable across active-shop switch", async () => {
    const { enqueueSync } = await import("../offline/syncEngine");
    const { setActiveShopId } = await import("../offline/shopScope");
    await enqueueSync({
      id: "r3-adj-a",
      kind: "pending_stock_updates",
      payload: {
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        delta: -1,
        referenceType: "adjustment",
        referenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      createdAt: new Date().toISOString(),
      shopId: SHOP_A,
    });
    expect(state.queue[0]?.shopId).toBe(SHOP_A);

    state.activeShopId = SHOP_B;
    setActiveShopId(SHOP_B);
    const { flushSyncQueueInner } = await import("../offline/syncEngine");
    await flushSyncQueueInner();
    expect(state.processCalls).toHaveLength(0);
    expect(state.queue[0]?.shopId).toBe(SHOP_A);

    state.activeShopId = SHOP_A;
    setActiveShopId(SHOP_A);
    await flushSyncQueueInner();
    expect(state.processCalls).toEqual([{ shopId: SHOP_A, kind: "pending_stock_updates" }]);
    expect(state.queue.find((o) => o.id === "r3-adj-a")).toBeUndefined();
  });

  it("T21 — sale_void shopId is immutable across active-shop switch", async () => {
    const { enqueueSync } = await import("../offline/syncEngine");
    const { setActiveShopId } = await import("../offline/shopScope");
    await enqueueSync({
      id: "sale-void-a",
      kind: "pending_stock_updates",
      payload: {
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        delta: 2,
        referenceType: "sale_void",
        referenceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      },
      createdAt: new Date().toISOString(),
      shopId: SHOP_A,
    });
    expect(state.queue[0]?.shopId).toBe(SHOP_A);

    state.activeShopId = SHOP_B;
    setActiveShopId(SHOP_B);
    const { flushSyncQueueInner } = await import("../offline/syncEngine");
    await flushSyncQueueInner();
    expect(state.processCalls).toHaveLength(0);
    expect(state.queue[0]?.shopId).toBe(SHOP_A);

    state.activeShopId = SHOP_A;
    setActiveShopId(SHOP_A);
    await flushSyncQueueInner();
    expect(state.processCalls).toEqual([{ shopId: SHOP_A, kind: "pending_stock_updates" }]);
    expect(state.queue.find((o) => o.id === "sale-void-a")).toBeUndefined();
  });

  it("T22 — purchase_void shopId is immutable across active-shop switch", async () => {
    const { enqueueSync } = await import("../offline/syncEngine");
    const { setActiveShopId } = await import("../offline/shopScope");
    await enqueueSync({
      id: "purchase-void-a",
      kind: "pending_stock_updates",
      payload: {
        productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        delta: -10,
        referenceType: "purchase_void",
        referenceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
      createdAt: new Date().toISOString(),
      shopId: SHOP_A,
    });
    expect(state.queue[0]?.shopId).toBe(SHOP_A);

    state.activeShopId = SHOP_B;
    setActiveShopId(SHOP_B);
    const { flushSyncQueueInner } = await import("../offline/syncEngine");
    await flushSyncQueueInner();
    expect(state.processCalls).toHaveLength(0);
    expect(state.queue[0]?.shopId).toBe(SHOP_A);

    state.activeShopId = SHOP_A;
    setActiveShopId(SHOP_A);
    await flushSyncQueueInner();
    expect(state.processCalls).toEqual([{ shopId: SHOP_A, kind: "pending_stock_updates" }]);
    expect(state.queue.find((o) => o.id === "purchase-void-a")).toBeUndefined();
  });
});

describe("MB-1 shop scope utilities", () => {
  beforeEach(async () => {
    const { resetActiveShopForTests } = await import("../offline/shopScope");
    resetActiveShopForTests();
  });

  it("builds persistence namespace sb:user:shop", async () => {
    const { buildPersistenceNamespace, setActiveShopId } = await import("../offline/shopScope");
    vi.doMock("../offline/accountScope", () => ({
      getActiveAccountKey: () => "sb:alice",
    }));
    setActiveShopId(SHOP_A);
    expect(buildPersistenceNamespace("sb:alice", SHOP_A)).toBe(`sb:alice:${SHOP_A}`);
  });

  it("parses shop UUID from namespace", async () => {
    const { parseShopIdFromPersistenceNamespace } = await import("../offline/shopScope");
    expect(parseShopIdFromPersistenceNamespace(`sb:u:${SHOP_A}`)).toBe(SHOP_A);
    expect(parseShopIdFromPersistenceNamespace("sb:u")).toBeNull();
  });
});

describe("MB-1 inferShopIdFromQueueRow", () => {
  it("infers from shopId stamp or namespaced accountKey only", async () => {
    const { inferShopIdFromQueueRow } = await import("../offline/shopScopeMigration");
    expect(
      inferShopIdFromQueueRow({
        id: "1",
        kind: "pending_purchases",
        payload: {},
        createdAt: "",
        attempts: 0,
        shopId: SHOP_A,
      }),
    ).toBe(SHOP_A);
    expect(
      inferShopIdFromQueueRow({
        id: "2",
        kind: "pending_purchases",
        payload: {},
        createdAt: "",
        attempts: 0,
        accountKey: `sb:u:${SHOP_B}`,
      }),
    ).toBe(SHOP_B);
    expect(
      inferShopIdFromQueueRow({
        id: "3",
        kind: "pending_purchases",
        payload: {},
        createdAt: "",
        attempts: 0,
        accountKey: "sb:u",
      }),
    ).toBeNull();
  });
});
