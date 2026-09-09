/**
 * R2 — persistArrayDelta must not delete IndexedDB sales that left a partial RAM array.
 *
 * AUDIT (R2, P1): `persistArrayDelta` deletes every entity id that is in the
 * previous RAM array but not the next one. The sales *manifest* is protected
 * during hydration; the sale entity rows were not. A persist of RAM [A,B]
 * after RAM had [A,B,C] removed C from disk.
 *
 * This file uses the real entity store + fake-indexeddb. Nothing is mocked.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Sale } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import type { PosState } from "../store/usePosStore";
import { activateOfflineScope } from "../test/offline/offlineHarness";
import {
  ENTITY_STORE_VERSION,
  getEntitiesByBucket,
  getEntitiesByIds,
  putEntitiesBatch,
  readEntityManifest,
  writeEntityManifest,
} from "./entityStore";
import { appendSyncOperation, readSyncQueue } from "./localDb";
import { flushIncrementalPersist } from "./incrementalPersist";

function sale(id: string, createdAt = "2026-09-07T10:00:00.000Z"): Sale {
  return {
    id,
    lines: [],
    subtotalUgx: 1000,
    totalUgx: 1000,
    cashPaidUgx: 1000,
    debtUgx: 0,
    estimatedProfitUgx: 0,
    createdAt,
    pendingSync: false,
  };
}

function baseState(partial: Partial<PosState>): PosState {
  return {
    products: [],
    customers: [],
    sales: [],
    archivedSales: [],
    preferences: createDefaultPreferences(),
    debtPayments: [],
    dayCloses: [],
    auditLogs: [],
    suppliers: [],
    purchases: [],
    supplierPayments: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    returnRecords: [],
    cashExpenses: [],
    cashDrawerAdjustments: [],
    dayDrawerOpens: [],
    inventoryCountSessions: [],
    archivedAuditLogs: [],
    archivedDayCloses: [],
    archivedVoidRecords: [],
    archivedReturnRecords: [],
    pharmacyPrescriptions: [],
    pharmacyDoctors: [],
    pharmacyControlledRegister: [],
    salesHistoryHydration: null,
    hydrationStage: "complete",
    ...partial,
  } as PosState;
}

async function seedSalesOnDisk(rows: Sale[]): Promise<void> {
  await putEntitiesBatch(
    "sale",
    rows.map((row) => ({ id: row.id, data: row, sortKey: row.createdAt })),
  );
  await writeEntityManifest({
    version: ENTITY_STORE_VERSION,
    preferences: createDefaultPreferences(),
    salesOrder: rows.map((row) => row.id),
    archivedSalesOrder: [],
    tombstones: {},
    voidedSaleIds: {},
    updatedAt: "2026-09-07T08:00:00.000Z",
  });
}

async function saleIdsOnDisk(): Promise<string[]> {
  const rows = await getEntitiesByBucket<Sale>("sale");
  return rows.map((row) => row.id).sort();
}

describe("R2 — persistArrayDelta must not delete historical sales from a partial RAM array", () => {
  beforeEach(() => {
    activateOfflineScope();
  });

  it("1 — IndexedDB A/B/C + partial RAM A/B leaves C on disk", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);

    await flushIncrementalPersist(
      baseState({
        sales: [a, b, c],
        salesHistoryHydration: { active: true, loaded: 2, total: 5 },
        hydrationStage: "interactive",
      }),
      baseState({
        sales: [a, b],
        salesHistoryHydration: { active: true, loaded: 2, total: 5 },
        hydrationStage: "interactive",
      }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B", "C"]);
    expect(await getEntitiesByIds<Sale>("sale", ["C"])).toEqual([c]);
    expect((await readEntityManifest())?.salesOrder).toEqual(["A", "B", "C"]);
  });

  it("2 — authoritative complete RAM may delete a genuinely removed sale", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C");
    await seedSalesOnDisk([a, b, c]);

    await flushIncrementalPersist(
      baseState({ sales: [a, b, c], hydrationStage: "complete" }),
      baseState({ sales: [a, b], hydrationStage: "complete" }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B"]);
    expect((await readEntityManifest())?.salesOrder).toEqual(["A", "B"]);
  });

  it("3 — incremental update of B does not delete unrelated historical C", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);
    const b2: Sale = { ...b, pendingSync: true };

    await flushIncrementalPersist(
      baseState({
        sales: [a, b],
        salesHistoryHydration: { active: true, loaded: 2, total: 3 },
        hydrationStage: "background",
      }),
      baseState({
        sales: [a, b2],
        salesHistoryHydration: { active: true, loaded: 2, total: 3 },
        hydrationStage: "background",
      }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B", "C"]);
  });

  it("4 — bootstrap/interactive head window does not delete the tail", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);

    await flushIncrementalPersist(
      baseState({ sales: [a, b, c], hydrationStage: "critical" }),
      baseState({ sales: [a, b], hydrationStage: "interactive" }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B", "C"]);
  });

  it("5 — void tombstone still removes the sale row while RAM is partial", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C");
    await seedSalesOnDisk([a, b, c]);
    await writeEntityManifest({
      version: ENTITY_STORE_VERSION,
      preferences: createDefaultPreferences(),
      salesOrder: ["A", "B"],
      archivedSalesOrder: [],
      tombstones: {},
      voidedSaleIds: { C: "2026-09-07T11:00:00.000Z" },
      updatedAt: "2026-09-07T08:00:00.000Z",
    });

    await flushIncrementalPersist(
      baseState({
        sales: [a, b, c],
        salesHistoryHydration: { active: true, loaded: 3, total: 5 },
        hydrationStage: "background",
      }),
      baseState({
        sales: [a, b],
        salesHistoryHydration: { active: true, loaded: 3, total: 5 },
        hydrationStage: "background",
      }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B"]);
  });

  it("6 — a later read still finds the protected historical sale", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);

    await flushIncrementalPersist(
      baseState({
        sales: [a, b, c],
        salesHistoryHydration: { active: true, loaded: 2, total: 5 },
        hydrationStage: "interactive",
      }),
      baseState({
        sales: [a, b],
        salesHistoryHydration: { active: true, loaded: 2, total: 5 },
        hydrationStage: "interactive",
      }),
    );

    const manifest = await readEntityManifest();
    expect(manifest?.salesOrder).toEqual(["A", "B", "C"]);
    const reread = await getEntitiesByIds<Sale>("sale", manifest?.salesOrder ?? []);
    expect(reread.map((row) => row.id).sort()).toEqual(["A", "B", "C"]);
    expect(reread.find((row) => row.id === "C")?.createdAt).toBe(c.createdAt);
  });

  it("7 — sale persist does not drop a durable sync-queue row (WAKA-06)", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C");
    await seedSalesOnDisk([a, b, c]);
    await appendSyncOperation({
      id: "op-r2-queue",
      kind: "pending_sales",
      payload: { saleId: "A" },
      createdAt: "2026-09-07T10:00:00.000Z",
      attempts: 0,
      lastAttemptAt: null,
    });

    await flushIncrementalPersist(
      baseState({
        sales: [a, b, c],
        salesHistoryHydration: { active: true, loaded: 2, total: 5 },
        hydrationStage: "interactive",
      }),
      baseState({
        sales: [a, b],
        salesHistoryHydration: { active: true, loaded: 2, total: 5 },
        hydrationStage: "interactive",
      }),
    );

    const queue = await readSyncQueue();
    expect(queue.map((op) => op.id)).toContain("op-r2-queue");
    expect(await saleIdsOnDisk()).toEqual(["A", "B", "C"]);
  });

  it("8 — return on A does not delete unrelated historical C", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);
    const returned: Sale = { ...a, pendingSync: true, totalUgx: 800 };

    await flushIncrementalPersist(
      baseState({
        sales: [a, b],
        salesHistoryHydration: { active: true, loaded: 2, total: 3 },
        hydrationStage: "interactive",
      }),
      baseState({
        sales: [returned, b],
        returnRecords: [
          {
            id: "ret-r2",
            saleId: "A",
            productId: "p1",
            productName: "Item",
            quantity: 1,
            refundAmountUgx: 200,
            reason: "wrong_item",
            actorUserId: "u1",
            actorName: "Cashier",
            createdAt: "2026-09-07T11:00:00.000Z",
          },
        ],
        salesHistoryHydration: { active: true, loaded: 2, total: 3 },
        hydrationStage: "interactive",
      }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B", "C"]);
    expect((await getEntitiesByIds<Sale>("sale", ["A"]))[0]?.totalUgx).toBe(800);
  });

  it("9 — archive of C still removes the sale row while RAM is partial", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);

    await flushIncrementalPersist(
      baseState({
        sales: [a, b, c],
        salesHistoryHydration: { active: true, loaded: 3, total: 5 },
        hydrationStage: "background",
      }),
      baseState({
        sales: [a, b],
        archivedSales: [c],
        salesHistoryHydration: { active: true, loaded: 3, total: 5 },
        hydrationStage: "background",
      }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B"]);
    const archived = await getEntitiesByBucket<Sale>("archivedSale");
    expect(archived.map((row) => row.id)).toContain("C");
  });

  it("10 — interactive stage alone (no salesHistoryHydration) does not delete C", async () => {
    const a = sale("A");
    const b = sale("B");
    const c = sale("C", "2026-08-01T10:00:00.000Z");
    await seedSalesOnDisk([a, b, c]);

    await flushIncrementalPersist(
      baseState({ sales: [a, b, c], salesHistoryHydration: null, hydrationStage: "interactive" }),
      baseState({ sales: [a, b], salesHistoryHydration: null, hydrationStage: "interactive" }),
    );

    expect(await saleIdsOnDisk()).toEqual(["A", "B", "C"]);
    expect((await readEntityManifest())?.salesOrder).toEqual(["A", "B", "C"]);
  });
});
