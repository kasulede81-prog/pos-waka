import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Sale } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import {
  resolveSalesOrderForIncrementalPersist,
  flushIncrementalPersist,
} from "./incrementalPersist";
import type { PosState } from "../store/usePosStore";

const ENTITY_STORE_VERSION = 3 as const;

vi.mock("./localDb", () => ({
  writeSnapshot: vi.fn(),
}));

vi.mock("./entityStore", () => ({
  ENTITY_STORE_VERSION: 3,
  ensureEntityManifest: vi.fn(),
  writeEntityManifest: vi.fn(),
  putEntitiesBatch: vi.fn(),
  deleteEntityRecord: vi.fn(),
  migrateSnapshotToEntities: vi.fn(),
  readEntityManifest: vi.fn(),
}));

import { ensureEntityManifest, writeEntityManifest, deleteEntityRecord } from "./entityStore";

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
    ...partial,
  } as PosState;
}

describe("SYNC-01 resolveSalesOrderForIncrementalPersist", () => {
  it("TEST 1 — incomplete hydration must not shrink the manifest", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "C", "D", "E"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: true,
    });
    expect(next).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("TEST 2 — completed hydration may normalize to RAM", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "C", "D", "E"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: false,
    });
    expect(next).toEqual(["A", "B"]);
  });

  it("TEST 3 — IDs removed from previous RAM are not resurrected while hydrating", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "GONE"],
      prevSales: [sale("A"), sale("B"), sale("GONE")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: true,
    });
    expect(next).toEqual(["A", "B"]);
    expect(next).not.toContain("GONE");
  });

  it("TEST 3b — voided tombstones are not resurrected while hydrating", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "VOID"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [],
      voidedSaleIds: { VOID: "2026-09-07T09:00:00.000Z" },
      salesHistoryHydrationActive: true,
    });
    expect(next).toEqual(["A", "B"]);
    expect(next).not.toContain("VOID");
  });

  it("TEST 3c — archived sales leave salesOrder while hydrating", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "OLD"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [sale("OLD", "2026-08-01T10:00:00.000Z")],
      salesHistoryHydrationActive: true,
    });
    expect(next).toEqual(["A", "B"]);
    expect(next).not.toContain("OLD");
  });

  it("TEST 4 — new sale appears and missing tail IDs are kept", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "C"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("N", "2026-09-07T12:00:00.000Z"), sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: true,
    });
    expect(next).toEqual(["N", "A", "B", "C"]);
  });

  it("TEST 5 — cloud merge adding a remote sale does not drop history", () => {
    const next = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "C", "D", "E"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("CLOUD"), sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: true,
    });
    expect(next).toEqual(["CLOUD", "A", "B", "C", "D", "E"]);
  });

  it("TEST 6 — persist/reload of the protected order keeps historical IDs", () => {
    const first = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: ["A", "B", "C", "D", "E"],
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: true,
    });
    const reloaded = resolveSalesOrderForIncrementalPersist({
      existingSalesOrder: first,
      prevSales: [sale("A"), sale("B")],
      nextSales: [sale("A"), sale("B")],
      nextArchivedSales: [],
      salesHistoryHydrationActive: true,
    });
    expect(reloaded).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("empty RAM while hydrating keeps the existing manifest", () => {
    expect(
      resolveSalesOrderForIncrementalPersist({
        existingSalesOrder: ["A", "B"],
        prevSales: [],
        nextSales: [],
        nextArchivedSales: [],
        salesHistoryHydrationActive: true,
      }),
    ).toEqual(["A", "B"]);
  });

  it("empty shop with hydration inactive stays empty", () => {
    expect(
      resolveSalesOrderForIncrementalPersist({
        existingSalesOrder: [],
        prevSales: [],
        nextSales: [],
        nextArchivedSales: [],
        salesHistoryHydrationActive: false,
      }),
    ).toEqual([]);
  });
});

describe("SYNC-01 flushIncrementalPersist race", () => {
  beforeEach(() => {
    vi.mocked(ensureEntityManifest).mockReset();
    vi.mocked(writeEntityManifest).mockReset();
    vi.mocked(deleteEntityRecord).mockReset();
    vi.mocked(ensureEntityManifest).mockResolvedValue({
      version: ENTITY_STORE_VERSION,
      preferences: createDefaultPreferences(),
      salesOrder: ["A", "B", "C", "D", "E"],
      archivedSalesOrder: [],
      tombstones: {},
      voidedSaleIds: {},
      updatedAt: "2026-09-07T08:00:00.000Z",
    });
    vi.mocked(writeEntityManifest).mockResolvedValue(undefined);
    vi.mocked(deleteEntityRecord).mockResolvedValue(undefined);
  });

  it("sale persist while hydration is active does not drop historical IDs", async () => {
    const prev = baseState({
      sales: [sale("A"), sale("B")],
      salesHistoryHydration: { active: true, loaded: 2, total: 5 },
    });
    const next = baseState({
      sales: [sale("A"), { ...sale("B"), pendingSync: true }],
      salesHistoryHydration: { active: true, loaded: 2, total: 5 },
    });

    await flushIncrementalPersist(prev, next);

    expect(writeEntityManifest).toHaveBeenCalled();
    const written = vi.mocked(writeEntityManifest).mock.calls.at(-1)?.[0];
    expect(written?.salesOrder).toEqual(["A", "B", "C", "D", "E"]);
    expect(deleteEntityRecord).not.toHaveBeenCalledWith("sale", "C");
    expect(deleteEntityRecord).not.toHaveBeenCalledWith("sale", "D");
    expect(deleteEntityRecord).not.toHaveBeenCalledWith("sale", "E");
  });

  it("return-style sale mutation while hydrating keeps historical IDs", async () => {
    const original = sale("A");
    const returned: Sale = { ...original, pendingSync: true, totalUgx: 800 };
    const prev = baseState({
      sales: [original, sale("B")],
      salesHistoryHydration: { active: true, loaded: 2, total: 5 },
    });
    const next = baseState({
      sales: [returned, sale("B")],
      returnRecords: [
        {
          id: "ret-1",
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
      salesHistoryHydration: { active: true, loaded: 2, total: 5 },
    });

    await flushIncrementalPersist(prev, next);

    const written = vi.mocked(writeEntityManifest).mock.calls.at(-1)?.[0];
    expect(written?.salesOrder).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("cloud-merge persist while hydrating keeps historical IDs", async () => {
    const prev = baseState({
      sales: [sale("A"), sale("B")],
      salesHistoryHydration: { active: true, loaded: 2, total: 5 },
    });
    const next = baseState({
      sales: [sale("CLOUD", "2026-09-07T12:00:00.000Z"), sale("A"), sale("B")],
      salesHistoryHydration: { active: true, loaded: 3, total: 5 },
    });

    await flushIncrementalPersist(prev, next);

    const written = vi.mocked(writeEntityManifest).mock.calls.at(-1)?.[0];
    expect(written?.salesOrder).toEqual(["CLOUD", "A", "B", "C", "D", "E"]);
  });

  it("legitimate RAM removal while hydrating still leaves salesOrder", async () => {
    vi.mocked(ensureEntityManifest).mockResolvedValue({
      version: ENTITY_STORE_VERSION,
      preferences: createDefaultPreferences(),
      salesOrder: ["A", "B", "GONE"],
      archivedSalesOrder: [],
      tombstones: {},
      voidedSaleIds: {},
      updatedAt: "2026-09-07T08:00:00.000Z",
    });
    const prev = baseState({
      sales: [sale("A"), sale("B"), sale("GONE")],
      salesHistoryHydration: { active: true, loaded: 3, total: 3 },
    });
    const next = baseState({
      sales: [sale("A"), sale("B")],
      salesHistoryHydration: { active: true, loaded: 2, total: 3 },
    });

    await flushIncrementalPersist(prev, next);

    const written = vi.mocked(writeEntityManifest).mock.calls.at(-1)?.[0];
    expect(written?.salesOrder).toEqual(["A", "B"]);
    expect(deleteEntityRecord).toHaveBeenCalledWith("sale", "GONE");
  });
});
