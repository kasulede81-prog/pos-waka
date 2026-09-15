import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "../types";

vi.mock("../lib/supabase", () => ({
  hasSupabaseConfig: false,
  supabase: null,
}));

vi.mock("../offline/localDb", () => ({
  readSyncQueue: vi.fn(async () => [] as SyncOperation[]),
  removeSyncOperation: vi.fn(async () => undefined),
  appendSyncOperation: vi.fn(async () => undefined),
}));

vi.mock("../offline/cloudSync", () => ({
  processCloudSyncOperation: vi.fn(async () => true),
}));

import { flushSyncQueue } from "../offline/syncEngine";
import { readSyncQueue, removeSyncOperation } from "../offline/localDb";

describe("localQueuePreservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not remove queue ops when Supabase is not configured", async () => {
    const op: SyncOperation = {
      id: "op-1",
      kind: "pending_sales",
      createdAt: "2026-06-01T10:00:00.000Z",
      payload: { saleId: "sale-1" },
      attempts: 0,
      lastAttemptAt: null,
    };
    vi.mocked(readSyncQueue).mockResolvedValueOnce([op]).mockResolvedValueOnce([op]);

    const result = await flushSyncQueue();
    expect(vi.mocked(removeSyncOperation)).not.toHaveBeenCalled();
    expect(result.remaining).toBe(1);
    expect(result.failed).toBe(1);
  });
});
