import { describe, expect, it, vi } from "vitest";
import type { SyncOperation } from "../types";

const SHOP_A = "11111111-1111-4111-8111-111111111111";

const queue: SyncOperation[] = [
  {
    id: "live-1",
    kind: "pending_sales",
    payload: { saleId: "live-1" },
    createdAt: "2026-09-07T10:00:00.000Z",
    attempts: 1,
    lastAttemptAt: "2026-09-07T11:59:59.000Z",
    shopId: SHOP_A,
  },
];

const frozen = structuredClone(queue);

vi.mock("../offline/localDb", () => ({
  readSyncQueue: vi.fn(async () => queue),
  appendSyncOperation: vi.fn(async () => undefined),
  removeSyncOperation: vi.fn(async () => undefined),
  clearSyncQueue: vi.fn(async () => undefined),
  writeSnapshot: vi.fn(async () => undefined),
  writeKv: vi.fn(async () => undefined),
  readSnapshotWithFallback: vi.fn(async () => null),
  claimLegacySnapshotForCurrentAccount: vi.fn(async () => null),
  getLocalDb: vi.fn(async () => {
    throw new Error("getLocalDb must not run during forensic snapshot");
  }),
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({
      dayCloses: [],
      sessionActor: { userId: "u1", role: "owner", authUserId: "u1", authRole: "owner" },
    }),
  },
}));

vi.mock("../offline/shopScope", () => ({
  getPersistenceNamespace: () => "present",
  getActiveShopId: () => SHOP_A,
  isValidShopId: (id: string | null | undefined) =>
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  parseShopIdFromPersistenceNamespace: () => null,
}));

import { readSyncQueue, appendSyncOperation, removeSyncOperation, clearSyncQueue } from "../offline/localDb";
import { getSyncForensicSnapshot } from "./syncForensicSnapshot";

describe("getSyncForensicSnapshot read-only", () => {
  it("reads the queue and never mutates it or writes IndexedDB", async () => {
    const snap = await getSyncForensicSnapshot();
    expect(snap.rows[0]?.id).toBe("live-1");
    expect(queue).toEqual(frozen);
    expect(vi.mocked(readSyncQueue)).toHaveBeenCalled();
    expect(vi.mocked(appendSyncOperation)).not.toHaveBeenCalled();
    expect(vi.mocked(removeSyncOperation)).not.toHaveBeenCalled();
    expect(vi.mocked(clearSyncQueue)).not.toHaveBeenCalled();
  });
});
