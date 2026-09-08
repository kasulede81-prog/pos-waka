import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "../types";
import type { SyncProcessResult } from "../lib/saleAdjustmentSync";
import { resetBlockedReturnRecoveryForTests } from "../lib/blockedReturnRecovery";
import { resetHistoricalSaleHeaderRepairForTests } from "../lib/historicalSaleHeaderRepair";

const SHOP = "11111111-1111-4111-8111-111111111111";
const QUEUE_ID = "436fb9c2-6584-4d65-a5d9-4c2a1c95fcaf";

const state = vi.hoisted(() => ({
  queue: [] as SyncOperation[],
  probeOk: false,
  processResult: "block" as SyncProcessResult,
  processCalls: [] as string[],
  probeCalls: 0,
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

vi.mock("./localDb", () => ({
  readSyncQueue: async () => state.queue,
  appendSyncOperation: async (op: SyncOperation) => {
    const existing = state.queue.findIndex((row) => row.id === op.id);
    if (existing >= 0) state.queue[existing] = op;
    else state.queue.push(op);
  },
  removeSyncOperation: async (id: string) => {
    state.queue = state.queue.filter((row) => row.id !== id);
  },
}));

vi.mock("./cloudSync", () => ({
  processCloudSyncOperation: async () => false,
  processCloudSyncOperationResult: async (op: SyncOperation) => {
    state.processCalls.push(op.id);
    return state.processResult;
  },
  probeBlockedReturnRecovery: async () => {
    state.probeCalls += 1;
    const { recordBlockedReturnProbe } = await import("../lib/blockedReturnRecovery");
    if (!state.probeOk) {
      recordBlockedReturnProbe({
        ok: false,
        blocker: "ceiling",
        ceilingError: "refund_exceeds_remaining",
        cloudSaleTotalUgx: 0,
        saleRowPresent: true,
        queueIdSuffix: "fcaf",
      });
      return false;
    }
    recordBlockedReturnProbe({
      ok: true,
      blocker: "none",
      cloudSaleTotalUgx: 2000,
      saleRowPresent: true,
      queueIdSuffix: "fcaf",
    });
    return true;
  },
}));

vi.mock("../lib/organizationDeletionState", () => ({
  assertOrganizationOperationsAllowed: async () => undefined,
}));

function blockedReturn(): SyncOperation {
  return {
    id: QUEUE_ID,
    kind: "pending_returns",
    payload: {
      returnId: "2fb42c22-25b6-4771-8bb9-c8bd00e937e2",
      saleId: "3dbdd270-8138-477e-935c-90f11a2dc3c3",
    },
    createdAt: "2026-09-07T22:43:57.603Z",
    attempts: 48,
    lastAttemptAt: "2026-09-08T06:08:30.953Z",
    shopId: SHOP,
    lastError: "refund_exceeds_remaining",
  };
}

describe("blocked pending_returns recovery flush", () => {
  beforeEach(async () => {
    const { resetActiveShopForTests, setActiveShopId } = await import("./shopScope");
    resetActiveShopForTests();
    setActiveShopId(SHOP);
    resetBlockedReturnRecoveryForTests();
    resetHistoricalSaleHeaderRepairForTests();
    const { usePosStore } = await import("../store/usePosStore");
    usePosStore.setState({ sales: [], archivedSales: [], returnRecords: [], archivedReturnRecords: [] });
    state.queue = [blockedReturn()];
    state.probeOk = false;
    state.processResult = { status: "block", lastError: "refund_exceeds_remaining" };
    state.processCalls = [];
    state.probeCalls = 0;
  });

  it("does not call the processor when the read-only probe fails", async () => {
    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();
    expect(state.probeCalls).toBe(1);
    expect(state.processCalls).toEqual([]);
    expect(state.queue).toHaveLength(1);
    expect(result.remaining).toBe(1);
    state.probeCalls = 0;
    await flushSyncQueueInner();
    expect(state.probeCalls).toBe(1);
    expect(state.processCalls).toEqual([]);
  });

  it("allows one processor pass after ceilings pass, then does not hammer", async () => {
    state.probeOk = true;
    const { flushSyncQueueInner } = await import("./syncEngine");
    await flushSyncQueueInner();
    expect(state.processCalls).toEqual([QUEUE_ID]);
    expect(state.queue[0]?.lastError).toBe("refund_exceeds_remaining");
    state.processCalls = [];
    await flushSyncQueueInner();
    expect(state.probeCalls).toBe(1);
    expect(state.processCalls).toEqual([]);
    expect(state.queue).toHaveLength(1);
  });

  it("ACKs and removes the queue row when the RPC returns ok", async () => {
    state.probeOk = true;
    state.processResult = "ack";
    const { flushSyncQueueInner } = await import("./syncEngine");
    const result = await flushSyncQueueInner();
    expect(state.processCalls).toEqual([QUEUE_ID]);
    expect(state.queue).toHaveLength(0);
    expect(result.remaining).toBe(0);
  });
});
