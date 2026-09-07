/**
 * POST-AUDIT-01/02 — archived stock movement remainder hydration + account isolation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { StockMovement } from "../types";
import { createDefaultPreferences } from "../data/defaultSeed";
import { entityKey } from "../offline/entityStore";
import {
  ACTIVE_STOCK_MOVEMENT_CAP,
  mergeStockMovementsWithArchive,
} from "./stockMovementLedger";
import { usePosStore } from "../store/usePosStore";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function movement(id: string, extra: Partial<StockMovement> = {}): StockMovement {
  return {
    id,
    at: extra.at ?? "2026-01-01T00:00:00.000Z",
    productId: extra.productId ?? "p1",
    productName: extra.productName ?? "Item",
    deltaBaseUnits: extra.deltaBaseUnits ?? -1,
    kind: extra.kind ?? "sale_out",
    summary: extra.summary ?? `Move ${id}`,
    refId: extra.refId ?? id,
    supplierId: extra.supplierId ?? null,
    ...extra,
  };
}

function restartStore(): void {
  usePosStore.getState().resetForSignOut();
  usePosStore.getState().hydrateEssentials({
    products: [],
    customers: [],
    preferences: createDefaultPreferences(),
  });
}

afterEach(() => {
  usePosStore.getState().resetForSignOut();
});

describe("POST-AUDIT-01 archived stock movement remainder hydration", () => {
  it("TEST 1 — persisted archivedStockMovement rows restore into live state", () => {
    restartStore();
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);
    usePosStore.getState().hydrateRemainder({
      archivedStockMovements: [movement("arch-1")],
    });
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.id)).toEqual(["arch-1"]);
  });

  it("TEST 2 — empty or missing archive bucket stays empty without throwing", () => {
    restartStore();
    expect(() => {
      usePosStore.getState().hydrateRemainder({ archivedStockMovements: [] });
    }).not.toThrow();
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);

    restartStore();
    expect(() => {
      usePosStore.getState().hydrateRemainder({ returnRecords: [] });
    }).not.toThrow();
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);
  });

  it("TEST 7 — malformed persisted archive rows are skipped", () => {
    restartStore();
    usePosStore.getState().hydrateRemainder({
      archivedStockMovements: [
        movement("arch-ok"),
        { id: "" } as StockMovement,
        null as unknown as StockMovement,
        "bad" as unknown as StockMovement,
      ],
    });
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.id)).toEqual(["arch-ok"]);
  });

  it("TEST 6 — merge keeps archive seed and lets newer in-memory rows win", () => {
    restartStore();
    usePosStore.setState({
      stockMovements: [movement("active-1", { summary: "Live active" })],
      archivedStockMovements: [movement("arch-live", { summary: "Live arch", deltaBaseUnits: -3 })],
    });
    usePosStore.getState().hydrateRemainder({
      stockMovements: [movement("active-1", { summary: "Stale active" })],
      archivedStockMovements: [
        movement("arch-live", { summary: "Stale arch", deltaBaseUnits: -1 }),
        movement("arch-persisted"),
      ],
    });
    const state = usePosStore.getState();
    expect(state.stockMovements.find((m) => m.id === "active-1")?.summary).toBe("Live active");
    expect(state.archivedStockMovements.map((m) => m.id).sort()).toEqual(["arch-live", "arch-persisted"]);
    expect(state.archivedStockMovements.find((m) => m.id === "arch-live")?.summary).toBe("Live arch");
    expect(state.archivedStockMovements.find((m) => m.id === "arch-live")?.deltaBaseUnits).toBe(-3);
  });

  it("TEST 8 / 9 — snapshot and backup remainder sources restore archived movements", () => {
    const snapArchive = [movement("arch-snap")];
    const backupArchive = [movement("arch-backup")];

    restartStore();
    usePosStore.getState().hydrateRemainder({
      archivedStockMovements: snapArchive ?? [],
    });
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.id)).toEqual(["arch-snap"]);

    restartStore();
    usePosStore.getState().hydrateRemainder({
      archivedStockMovements: backupArchive ?? [],
    });
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.id)).toEqual(["arch-backup"]);
  });
});

describe("POST-AUDIT-02 archived stock movement account isolation", () => {
  it("TEST 3 — Shop A and Shop B archivedStockMovement buckets are distinct namespaces", () => {
    const shopAKey = entityKey("sb:shop-a", "archivedStockMovement", "move-1");
    const shopBKey = entityKey("sb:shop-b", "archivedStockMovement", "move-1");
    expect(shopAKey).not.toBe(shopBKey);
    expect(shopAKey).toBe("sb:shop-a::archivedStockMovement::move-1");
    expect(shopBKey).toBe("sb:shop-b::archivedStockMovement::move-1");

    const shopABucket = new Map([[shopAKey, movement("move-1", { summary: "Shop A" })]]);
    const shopBBucket = new Map([[shopBKey, movement("move-1", { summary: "Shop B" })]]);
    const loadBucket = (accountKey: string, bucket: Map<string, StockMovement>) =>
      [...bucket.entries()]
        .filter(([key]) => key.startsWith(`${accountKey}::archivedStockMovement::`))
        .map(([, row]) => row);

    expect(loadBucket("sb:shop-a", shopABucket).map((m) => m.summary)).toEqual(["Shop A"]);
    expect(loadBucket("sb:shop-b", shopBBucket).map((m) => m.summary)).toEqual(["Shop B"]);
    expect(loadBucket("sb:shop-b", shopABucket)).toEqual([]);
    expect(loadBucket("sb:shop-a", shopBBucket)).toEqual([]);
  });

  it("TEST 4 — resetForSignOut and hydrateEssentials clear archivedStockMovements", () => {
    usePosStore.setState({ archivedStockMovements: [movement("arch-session")] });
    usePosStore.getState().resetForSignOut();
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);

    usePosStore.setState({ archivedStockMovements: [movement("arch-session")] });
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);
  });

  it("TEST 5 — hydrate(Shop B) after Shop A reset loads B only", () => {
    const shopAKey = entityKey("sb:shop-a", "archivedStockMovement", "arch-shop-a");
    const shopBKey = entityKey("sb:shop-b", "archivedStockMovement", "arch-shop-b");
    expect(shopAKey).not.toBe(shopBKey);

    const persisted = new Map<string, StockMovement>([
      [shopAKey, movement("arch-shop-a", { summary: "Shop A archive" })],
      [shopBKey, movement("arch-shop-b", { summary: "Shop B archive" })],
    ]);
    const hydrateAccount = (accountKey: string) =>
      [...persisted.entries()]
        .filter(([key]) => key.startsWith(`${accountKey}::archivedStockMovement::`))
        .map(([, row]) => row);

    restartStore();
    usePosStore.setState({
      archivedStockMovements: hydrateAccount("sb:shop-a"),
    });
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.id)).toEqual(["arch-shop-a"]);

    usePosStore.getState().resetForSignOut();
    usePosStore.getState().hydrateEssentials({
      products: [],
      customers: [],
      preferences: createDefaultPreferences(),
    });
    expect(usePosStore.getState().archivedStockMovements).toEqual([]);

    usePosStore.getState().hydrateRemainder({
      archivedStockMovements: hydrateAccount("sb:shop-b"),
    });
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.id)).toEqual(["arch-shop-b"]);
    expect(usePosStore.getState().archivedStockMovements.map((m) => m.summary)).toEqual(["Shop B archive"]);
    expect(usePosStore.getState().archivedStockMovements.some((m) => m.id === "arch-shop-a")).toBe(false);
  });
});

describe("POST-AUDIT-01/02 production boundary and inventory regression", () => {
  it("entity remainder loads archivedStockMovement before hydrationStage complete", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    const remainderFn = storeSrc.indexOf("async function hydrateEntityRemainderFromManifest");
    const backgroundFn = storeSrc.indexOf("export async function bootstrapPosBackgroundFromDisk");
    const archiveBucket = storeSrc.indexOf('getEntitiesByBucket<StockMovement>("archivedStockMovement")');
    const archiveCall = storeSrc.indexOf("archivedStockMovements: archivedStockMovementsRaw");
    const completeAfterRemainder = storeSrc.indexOf('hydrationStage: "complete"', backgroundFn);
    expect(remainderFn).toBeGreaterThan(0);
    expect(archiveBucket).toBeGreaterThan(remainderFn);
    expect(archiveBucket).toBeLessThan(backgroundFn);
    expect(archiveCall).toBeGreaterThan(archiveBucket);
    expect(completeAfterRemainder).toBeGreaterThan(backgroundFn);
  });

  it("snapshot and backup remainder call sites pass archivedStockMovements", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    expect(storeSrc).toContain("archivedStockMovements: restoredSnap.archivedStockMovements ?? []");
    expect(storeSrc).toContain("archivedStockMovements: (snap as { archivedStockMovements?: StockMovement[] }).archivedStockMovements ?? []");
  });

  it("does not revive unused full hydrate() as the production boot path", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    expect(storeSrc).toMatch(/hydrateEntityRemainderFromManifest\(manifest\)/);
    expect(storeSrc).not.toMatch(/getState\(\)\.hydrate\(/);
  });

  it("TEST 10 — mergeStockMovementsWithArchive still overflows the active cap", () => {
    const incoming = Array.from({ length: ACTIVE_STOCK_MOVEMENT_CAP + 2 }, (_, i) =>
      movement(`move-${i}`, { at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }),
    );
    const merged = mergeStockMovementsWithArchive([], incoming, []);
    expect(merged.stockMovements).toHaveLength(ACTIVE_STOCK_MOVEMENT_CAP);
    expect(merged.archivedStockMovements).toHaveLength(2);
    expect(new Set([...merged.stockMovements, ...merged.archivedStockMovements].map((m) => m.id)).size).toBe(
      ACTIVE_STOCK_MOVEMENT_CAP + 2,
    );
  });

  it("hydrateEssentials still clears archivedStockMovements alongside other remainder collections", () => {
    const storeSrc = src("src/store/usePosStore.ts");
    const essentials = storeSrc.slice(
      storeSrc.indexOf("hydrateEssentials: (data) =>"),
      storeSrc.indexOf("hydrateRemainder: (data) =>"),
    );
    expect(essentials).toContain("archivedStockMovements: []");
    expect(essentials).toContain("dayDrawerOpens: []");
  });
});
