import { describe, expect, it, vi } from "vitest";
import type { PersistedSnapshot } from "../offline/localDb";
import {
  attachTombstonesToSnapshot,
  mergeTombstoneBundles,
  tombstonesFromManifest,
  tombstonesFromSnapshot,
} from "./tombstoneDurability";
import { migrateSnapshotToEntities, readEntityManifest } from "../offline/entityStore";

const manifestStore: { current: Record<string, unknown> | null } = { current: null };

vi.mock("../offline/localDb", async () => {
  const actual = await vi.importActual<typeof import("../offline/localDb")>("../offline/localDb");
  return {
    ...actual,
    readKv: vi.fn(async (key: string) => {
      if (key === "entity-manifest") return manifestStore.current;
      return null;
    }),
    writeKv: vi.fn(async (key: string, value: unknown) => {
      if (key === "entity-manifest") manifestStore.current = value as Record<string, unknown>;
    }),
    getLocalDb: vi.fn(async () => ({
      put: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(async () => []),
      transaction: () => ({
        store: { put: vi.fn() },
        done: Promise.resolve(),
      }),
      delete: vi.fn(),
    })),
  };
});

vi.mock("../offline/accountScope", () => ({
  getActiveAccountKey: () => "sb:test",
}));

vi.mock("../store/usePosStore", () => ({
  usePosStore: {
    getState: () => ({
      preferences: { shopDisplayName: "Test" },
    }),
  },
}));

describe("tombstoneDurability", () => {
  const product = (id: string, name: string): PersistedSnapshot["products"][number] =>
    ({
      id,
      name,
      category: "",
      sku: "",
      baseUnit: "piece",
      stockOnHand: name === "Live" ? 5 : 0,
      minimumStockAlert: 0,
      sellingPricePerUnitUgx: 1000,
      costPricePerUnitUgx: 500,
      sellingMode: "unit",
      trackStock: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    }) as PersistedSnapshot["products"][number];

  const baseSnap: PersistedSnapshot = {
    products: [product("p-deleted", "Gone"), product("p-live", "Live")],
    customers: [],
    sales: [
      {
        id: "s-voided",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        subtotalUgx: 1000,
        totalUgx: 1000,
        cashPaidUgx: 1000,
        debtUgx: 0,
        paymentMethod: "cash",
        estimatedProfitUgx: 500,
        lines: [],
        pendingSync: false,
        lastSyncError: null,
        status: "completed",
      },
    ],
    preferences: { shopDisplayName: "Test" } as PersistedSnapshot["preferences"],
    debtPayments: [],
    dayCloses: [],
    deletedProductIds: ["p-deleted"],
    voidedSaleIds: ["s-voided"],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("extracts tombstones from snapshot", () => {
    const bundle = tombstonesFromSnapshot(baseSnap);
    expect(Object.keys(bundle.deletedProductIds)).toContain("p-deleted");
    expect(Object.keys(bundle.voidedSaleIds)).toContain("s-voided");
  });

  it("filters deleted products and voided sales on attach", () => {
    const cleaned = attachTombstonesToSnapshot(baseSnap, tombstonesFromSnapshot(baseSnap));
    expect(cleaned.products.map((p) => p.id)).toEqual(["p-live"]);
    expect(cleaned.sales).toHaveLength(0);
  });

  it("preserves tombstones through migrateSnapshotToEntities", async () => {
    manifestStore.current = null;
    await migrateSnapshotToEntities(baseSnap);
    const manifest = await readEntityManifest();
    expect(manifest?.tombstones?.["p-deleted"]).toBeTruthy();
    expect(manifest?.voidedSaleIds?.["s-voided"]).toBeTruthy();
  });

  it("merges tombstone bundles without resetting", () => {
    const a = tombstonesFromManifest({
      tombstones: { p1: "2026-01-01T00:00:00.000Z" },
      voidedSaleIds: {},
    });
    const b = tombstonesFromSnapshot({ deletedProductIds: ["p2"], voidedSaleIds: ["s1"] });
    const merged = mergeTombstoneBundles(a, b);
    expect(Object.keys(merged.deletedProductIds)).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(Object.keys(merged.voidedSaleIds)).toContain("s1");
  });
});
