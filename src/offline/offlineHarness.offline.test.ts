/**
 * PHASE 0A — proof that this test project executes the REAL offline layer.
 *
 * Every assertion here would be vacuously true in the default test project,
 * where `src/test/vitest.setup.ts` mocks `src/offline/localDb` so that
 * `readSyncQueue()` always resolves `[]` and the writers are no-ops.
 *
 * Nothing in this file is mocked. `localDb`, `entityStore` and `syncEngine` are
 * the production modules, running against `fake-indexeddb`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { SyncOperation } from "../types";
import {
  activateOfflineScope,
  clearOfflineScope,
  type OfflineScope,
} from "../test/offline/offlineHarness";
import {
  appendSyncOperation,
  clearSyncQueue,
  getLocalDb,
  readKv,
  readSyncQueue,
  removeSyncOperation,
  writeKv,
} from "./localDb";
import { getEntitiesByBucket, putEntity } from "./entityStore";
import { flushSyncQueueInner } from "./syncEngine";

function op(overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id: "op-1",
    kind: "pending_sales",
    payload: { saleId: "33333333-3333-4333-8333-333333333333" },
    createdAt: "2026-09-01T10:00:00.000Z",
    attempts: 0,
    lastAttemptAt: null,
    ...overrides,
  };
}

describe("PHASE 0A harness — real IndexedDB is reachable from tests", () => {
  let scope: OfflineScope;

  beforeEach(() => {
    scope = activateOfflineScope();
  });

  it("opens the real waka-pos-offline database with the production schema", async () => {
    const db = await getLocalDb();
    expect(db.name).toBe("waka-pos-offline");
    expect([...db.objectStoreNames].sort()).toEqual(
      ["backups", "kv", "records", "staffCache", "syncQueue"].sort(),
    );
  });

  it("PROOF 1 — the IndexedDB sync queue can contain an operation", async () => {
    await expect(readSyncQueue()).resolves.toEqual([]);

    await appendSyncOperation(op());

    const queue = await readSyncQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.id).toBe("op-1");
    expect(queue[0]?.kind).toBe("pending_sales");
    // The row really is namespaced by the active account + shop.
    expect((queue[0] as SyncOperation & { accountKey?: string }).accountKey).toBe(scope.namespace);
  });

  it("PROOF 1b — queue rows are scoped: another shop cannot see this shop's operations", async () => {
    await appendSyncOperation(op({ id: "shop-a-op" }));
    expect(await readSyncQueue()).toHaveLength(1);

    activateOfflineScope();
    expect(await readSyncQueue()).toEqual([]);
  });

  it("PROOF 1c — removeSyncOperation actually deletes the durable row", async () => {
    await appendSyncOperation(op({ id: "op-to-remove" }));
    expect(await readSyncQueue()).toHaveLength(1);

    await removeSyncOperation("op-to-remove");
    expect(await readSyncQueue()).toEqual([]);
  });

  it("PROOF 2 — a queue flush reads an actual operation off disk and acts on it", async () => {
    await appendSyncOperation(op({ id: "op-flush", attempts: 0 }));

    // WAKA-06: the default store is not hydrated. The flush must retain the
    // op without incrementing attempts.
    const beforeHydration = await flushSyncQueueInner();
    expect(beforeHydration.remaining).toBe(1);
    expect(beforeHydration.failed).toBe(0);
    expect((await readSyncQueue())[0]?.attempts).toBe(0);

    const { usePosStore } = await import("../store/usePosStore");
    usePosStore.setState({ _hydrated: true });

    // No Supabase is configured in this project, so `processOne` short-circuits
    // to "retry". That is exactly what we want to observe: the flush must have
    // READ a real row to report one failure and leave one remaining.
    const result = await flushSyncQueueInner();

    expect(result.remaining).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skippedBackoff).toBe(0);

    // And the flush wrote the retry bookkeeping back to IndexedDB.
    const [after] = await readSyncQueue();
    expect(after?.id).toBe("op-flush");
    expect(after?.attempts).toBe(1);
    expect(after?.lastAttemptAt).toBeTruthy();
  });

  it("PROOF 3 — a local entity can be persisted and read back", async () => {
    await expect(getEntitiesByBucket("customer")).resolves.toEqual([]);

    await putEntity(
      "customer",
      "44444444-4444-4444-8444-444444444444",
      { id: "44444444-4444-4444-8444-444444444444", name: "Nakato", debtBalanceUgx: 12_000 },
      "2026-09-01T10:00:00.000Z",
    );

    const rows = await getEntitiesByBucket<{ id: string; name: string; debtBalanceUgx: number }>(
      "customer",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Nakato");
    expect(rows[0]?.debtBalanceUgx).toBe(12_000);
  });

  it("PROOF 3b — the KV store round-trips under the active namespace", async () => {
    await writeKv("draft_sale", { lines: [{ productId: "p1", quantity: 2 }] });
    await expect(readKv("draft_sale")).resolves.toEqual({
      lines: [{ productId: "p1", quantity: 2 }],
    });

    const db = await getLocalDb();
    const raw = await db.get("kv", `${scope.namespace}::draft_sale`);
    expect(raw).toBeTruthy();
  });

  it("writes are dropped when no account is active (signed-out safety still holds)", async () => {
    clearOfflineScope();
    await appendSyncOperation(op({ id: "should-not-persist" }));
    await expect(readSyncQueue()).resolves.toEqual([]);

    activateOfflineScope();
    await clearSyncQueue();
    await expect(readSyncQueue()).resolves.toEqual([]);
  });
});
