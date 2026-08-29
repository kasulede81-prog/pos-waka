import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogNode, ShopPreferences } from "../types";
import {
  appendCatalogTombstones,
  applyCatalogDocumentToPreferences,
  buildCatalogPushPayload,
  catalogDocumentFromPreferences,
  mergeCatalogDocuments,
  mergeCatalogNodes,
  mergePinnedShelfState,
  parseCatalogPullPayload,
  pickNewerCatalogNode,
  preferencesPatchTouchesCatalog,
  stampCatalogPreferencePatch,
} from "./catalogCloudSync";
import { createDefaultPreferences } from "../data/defaultSeed";

function node(partial: Partial<CatalogNode> & Pick<CatalogNode, "id" | "legacyShelfKey">): CatalogNode {
  return {
    shopId: "shop-1",
    parentId: null,
    name: partial.legacyShelfKey,
    sortOrder: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("catalogCloudSync merge", () => {
  it("unions concurrently created root folders by id", () => {
    const electronics = node({
      id: "A",
      legacyShelfKey: "Electronics",
      name: "Electronics",
      updatedAt: "2026-08-29T10:00:00.000Z",
    });
    const pharmacy = node({
      id: "B",
      legacyShelfKey: "Pharmacy",
      name: "Pharmacy",
      updatedAt: "2026-08-29T10:01:00.000Z",
    });
    const merged = mergeCatalogNodes({
      local: [electronics],
      incoming: [pharmacy],
      tombstones: [],
    });
    expect(merged.map((n) => n.legacyShelfKey).sort()).toEqual(["Electronics", "Pharmacy"]);
  });

  it("keeps concurrent children under the same parent", () => {
    const electronics = node({
      id: "E",
      legacyShelfKey: "Electronics",
      name: "Electronics",
    });
    const computers = node({
      id: "C",
      parentId: "E",
      legacyShelfKey: "Computers",
      name: "Computers",
      sortOrder: 0,
    });
    const phones = node({
      id: "P",
      parentId: "E",
      legacyShelfKey: "Phones",
      name: "Phones",
      sortOrder: 0,
    });
    const merged = mergeCatalogNodes({
      local: [electronics, computers],
      incoming: [electronics, phones],
      tombstones: [],
    });
    const children = merged.filter((n) => n.parentId === "E").map((n) => n.legacyShelfKey).sort();
    expect(children).toEqual(["Computers", "Phones"]);
    expect(merged.some((n) => n.id === "E")).toBe(true);
  });

  it("newer rename wins and older name cannot resurrect", () => {
    const older = node({
      id: "D",
      legacyShelfKey: "Dell",
      name: "Dell",
      updatedAt: "2026-08-29T09:00:00.000Z",
    });
    const newer = node({
      id: "D",
      legacyShelfKey: "Dell Laptops",
      name: "Dell Laptops",
      updatedAt: "2026-08-29T11:00:00.000Z",
    });
    expect(pickNewerCatalogNode(older, newer).legacyShelfKey).toBe("Dell Laptops");
    const merged = mergeCatalogNodes({
      local: [older],
      incoming: [newer],
      tombstones: [],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.legacyShelfKey).toBe("Dell Laptops");
  });

  it("tombstone removes a folder and blocks resurrection from stale live rows", () => {
    const folder = node({ id: "X", legacyShelfKey: "Spare", updatedAt: "2026-08-29T12:00:00.000Z" });
    const merged = mergeCatalogNodes({
      local: [folder],
      incoming: [folder],
      tombstones: [{ id: "X", deletedAt: "2026-08-29T11:00:00.000Z" }],
    });
    expect(merged).toEqual([]);
  });

  it("does not drop unrelated siblings during concurrent reorder", () => {
    const a = node({ id: "1", legacyShelfKey: "A", sortOrder: 2, updatedAt: "2026-08-29T10:00:00.000Z" });
    const b = node({ id: "2", legacyShelfKey: "B", sortOrder: 1, updatedAt: "2026-08-29T10:00:00.000Z" });
    const extra = node({
      id: "3",
      legacyShelfKey: "C",
      sortOrder: 5,
      updatedAt: "2026-08-29T10:05:00.000Z",
    });
    const merged = mergeCatalogNodes({
      local: [a, b],
      incoming: [a, b, extra],
      tombstones: [],
    });
    expect(merged.map((n) => n.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("same-sibling concurrent reorder is last-write-wins per node updatedAt", () => {
    const local = [
      node({ id: "1", legacyShelfKey: "A", sortOrder: 0, updatedAt: "2026-08-29T10:00:00.000Z" }),
      node({ id: "2", legacyShelfKey: "B", sortOrder: 1, updatedAt: "2026-08-29T10:00:00.000Z" }),
    ];
    const incoming = [
      node({ id: "1", legacyShelfKey: "A", sortOrder: 1, updatedAt: "2026-08-29T11:00:00.000Z" }),
      node({ id: "2", legacyShelfKey: "B", sortOrder: 0, updatedAt: "2026-08-29T11:00:00.000Z" }),
    ];
    const merged = mergeCatalogNodes({ local, incoming, tombstones: [] });
    const byId = Object.fromEntries(merged.map((n) => [n.id, n.sortOrder]));
    expect(byId["1"]).toBe(1);
    expect(byId["2"]).toBe(0);
  });

  it("unions concurrent pins without dropping the other device key", () => {
    const merged = mergePinnedShelfState({
      localKeys: ["Electronics"],
      localUpdatedAt: "2026-08-29T10:00:00.000Z",
      localRevisions: { Electronics: { pinned: true, updatedAt: "2026-08-29T10:00:00.000Z" } },
      incomingKeys: ["Pharmacy"],
      incomingUpdatedAt: "2026-08-29T10:01:00.000Z",
      incomingRevisions: { Pharmacy: { pinned: true, updatedAt: "2026-08-29T10:01:00.000Z" } },
    });
    expect(merged.keys).toEqual(["Pharmacy", "Electronics"]);
  });

  it("hierarchy flag is shop-level LWW and does not drop nodes", () => {
    const local = catalogDocumentFromPreferences({
      ...createDefaultPreferences(),
      catalogHierarchyEnabled: false,
      catalogHierarchyEnabledUpdatedAt: "2026-08-29T09:00:00.000Z",
      posCatalogNodes: [node({ id: "A", legacyShelfKey: "Electronics" })],
    });
    const incoming = catalogDocumentFromPreferences({
      ...createDefaultPreferences(),
      catalogHierarchyEnabled: true,
      catalogHierarchyEnabledUpdatedAt: "2026-08-29T12:00:00.000Z",
      posCatalogNodes: [node({ id: "A", legacyShelfKey: "Electronics" })],
    });
    const merged = mergeCatalogDocuments(local, incoming);
    expect(merged.catalogHierarchyEnabled).toBe(true);
    expect(merged.nodes).toHaveLength(1);
  });

  it("does not disable hierarchy from empty cloud epoch metadata", () => {
    const local = catalogDocumentFromPreferences({
      ...createDefaultPreferences(),
      catalogHierarchyEnabled: true,
    });
    const incoming = catalogDocumentFromPreferences(createDefaultPreferences());
    const merged = mergeCatalogDocuments(local, incoming);
    expect(merged.catalogHierarchyEnabled).toBe(true);
  });

  it("applies catalog onto a non-empty shop preference document", () => {
    const existing: ShopPreferences = {
      ...createDefaultPreferences(),
      posCatalogNodes: [node({ id: "local", legacyShelfKey: "LocalOnly" })],
    };
    const incoming = catalogDocumentFromPreferences({
      ...createDefaultPreferences(),
      posCatalogNodes: [node({ id: "cloud", legacyShelfKey: "CloudFolder" })],
    });
    const next = applyCatalogDocumentToPreferences(
      existing,
      mergeCatalogDocuments(catalogDocumentFromPreferences(existing), incoming),
    );
    expect(next.posCatalogNodes?.map((n) => n.legacyShelfKey).sort()).toEqual(["CloudFolder", "LocalOnly"]);
  });

  it("new-device empty local receives the full cloud catalog document", () => {
    const empty = catalogDocumentFromPreferences(createDefaultPreferences());
    const cloud = catalogDocumentFromPreferences({
      ...createDefaultPreferences(),
      catalogHierarchyEnabled: true,
      catalogHierarchyEnabledUpdatedAt: "2026-08-29T12:00:00.000Z",
      posPinnedShelfKeys: ["Electronics"],
      posPinnedShelfKeysUpdatedAt: "2026-08-29T12:00:00.000Z",
      posPinnedShelfKeyRevisions: {
        Electronics: { pinned: true, updatedAt: "2026-08-29T12:00:00.000Z" },
      },
      posShelfLayout: { Electronics: { color: "blue", updatedAt: "2026-08-29T12:00:00.000Z" } },
      posCatalogNodes: [
        node({ id: "E", legacyShelfKey: "Electronics", name: "Electronics", sortOrder: 0 }),
        node({ id: "C", parentId: "E", legacyShelfKey: "Computers", name: "Computers", sortOrder: 0 }),
      ],
    });
    const merged = mergeCatalogDocuments(empty, cloud);
    expect(merged.catalogHierarchyEnabled).toBe(true);
    expect(merged.nodes.map((n) => n.legacyShelfKey).sort()).toEqual(["Computers", "Electronics"]);
    expect(merged.pinnedKeys).toEqual(["Electronics"]);
    expect(merged.layout.Electronics?.color).toBe("blue");
  });

  it("buildCatalogPushPayload includes tombstones for deleted ids", () => {
    const prefs: ShopPreferences = {
      ...createDefaultPreferences(),
      posCatalogNodes: [node({ id: "keep", legacyShelfKey: "Keep" })],
      posCatalogTombstones: [{ id: "gone", deletedAt: "2026-08-29T12:00:00.000Z" }],
    };
    const payload = buildCatalogPushPayload(prefs);
    const nodes = payload.nodes as Array<{ id: string; deleted_at: string | null }>;
    expect(nodes.some((n) => n.id === "keep" && n.deleted_at == null)).toBe(true);
    expect(nodes.some((n) => n.id === "gone" && n.deleted_at === "2026-08-29T12:00:00.000Z")).toBe(true);
  });

  it("parseCatalogPullPayload maps tombstoned rows", () => {
    const doc = parseCatalogPullPayload({
      ok: true,
      nodes: [
        {
          id: "live",
          parent_id: null,
          name: "Live",
          legacy_shelf_key: "Live",
          sort_order: 0,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
          deleted_at: null,
        },
        {
          id: "dead",
          parent_id: null,
          name: "Dead",
          legacy_shelf_key: "Dead",
          sort_order: 0,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-29T12:00:00.000Z",
          deleted_at: "2026-08-29T12:00:00.000Z",
        },
      ],
      layout: [],
      meta: {
        catalog_hierarchy_enabled: true,
        hierarchy_updated_at: "2026-08-29T12:00:00.000Z",
        pinned_revisions: {},
        pinned_keys: [],
        pinned_updated_at: "1970-01-01T00:00:00.000Z",
      },
    });
    expect(doc?.nodes.map((n) => n.id)).toEqual(["live"]);
    expect(doc?.tombstones).toEqual([{ id: "dead", deletedAt: "2026-08-29T12:00:00.000Z" }]);
    expect(doc?.catalogHierarchyEnabled).toBe(true);
  });

  it("stamps layout and pin metadata on a catalog preference patch", () => {
    const prev = createDefaultPreferences();
    const stamped = stampCatalogPreferencePatch(prev, {
      posShelfLayout: { Electronics: { color: "red" } },
      posPinnedShelfKeys: ["Electronics"],
      catalogHierarchyEnabled: true,
    }, "2026-08-29T12:00:00.000Z");
    expect(stamped.posShelfLayout?.Electronics?.updatedAt).toBe("2026-08-29T12:00:00.000Z");
    expect(stamped.posPinnedShelfKeysUpdatedAt).toBe("2026-08-29T12:00:00.000Z");
    expect(stamped.posPinnedShelfKeyRevisions?.Electronics).toEqual({
      pinned: true,
      updatedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(stamped.catalogHierarchyEnabledUpdatedAt).toBe("2026-08-29T12:00:00.000Z");
  });

  it("appendCatalogTombstones unions ids", () => {
    const next = appendCatalogTombstones([{ id: "a", deletedAt: "2026-08-29T10:00:00.000Z" }], ["b"], "2026-08-29T11:00:00.000Z");
    expect(next.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("detects catalog preference patches", () => {
    expect(preferencesPatchTouchesCatalog({ posCatalogNodes: [] })).toBe(true);
    expect(preferencesPatchTouchesCatalog({ saleSoundOn: true })).toBe(false);
  });
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("catalogCloudSync wiring", () => {
  it("does not use shop_cloud_snapshots as the live catalog feed", () => {
    const sync = readFileSync(join(ROOT, "src/lib/catalogCloudSync.ts"), "utf8");
    expect(sync).not.toContain("shop_cloud_snapshots");
    const migration = readFileSync(join(ROOT, "supabase/migrations/171_shop_catalog_sync.sql"), "utf8");
    expect(migration).toContain("shop_push_catalog");
    expect(migration).toContain("shop_pull_catalog");
    expect(migration).toContain("user_can_manage_shop");
    expect(migration).toContain("user_is_cashier_or_above");
    expect(migration.toLowerCase()).toContain("not shop_cloud_snapshots");
  });

  it("enqueues pending_catalog after catalog mutations and merges on pull for non-empty shops", () => {
    const store = readFileSync(join(ROOT, "src/store/usePosStore.ts"), "utf8");
    expect(store).toContain('queueRemote("pending_catalog"');
    expect(store).toContain("queueCatalogCloudSync()");
    for (const fn of [
      "createCatalogShelf",
      "renameShelfCategory",
      "reparentCatalogShelf",
      "reorderCatalogSiblings",
      "deleteEmptyShelf",
      "deleteEmptyShelves",
      "setPreferences",
    ]) {
      expect(store).toContain(fn);
    }
    const cloud = readFileSync(join(ROOT, "src/offline/cloudSync.ts"), "utf8");
    expect(cloud).toContain('case "pending_catalog"');
    expect(cloud).toContain("mergeCatalogPreferences");
    expect(cloud).toContain("pullCatalogFromRpc");
    expect(cloud.split("mergeCatalogPreferences").length - 1).toBeGreaterThanOrEqual(3);
  });
});
