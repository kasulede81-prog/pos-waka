import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import {
  catalogCreateIntentParentId,
  expandAncestorsForCreatedFolder,
  isCatalogHierarchyEnabled,
} from "./catalogHierarchy";

describe("createCatalogShelf inventory safety", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      products: [
        {
          id: "p-dell",
          name: "Latitude 5420",
          category: "DELL",
          sku: "LAT",
          baseUnit: "piece",
          stockOnHand: 7,
          minimumStockAlert: 0,
          sellingPricePerUnitUgx: 2_000_000,
          costPricePerUnitUgx: 1_500_000,
          sellingMode: "unit",
          updatedAt: "2026-08-01T00:00:00.000Z",
          version: 1,
        },
      ],
      stockMovements: [],
      sales: [],
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      preferences: {
        ...createDefaultPreferences(),
        catalogHierarchyEnabled: true,
        onboardingDone: true,
      },
    });
  });

  it("creating a CatalogNode does not create inventory, products, or movements", () => {
    const before = usePosStore.getState();
    const productSnap = before.products.map((p) => ({ ...p }));
    const movementsSnap = [...before.stockMovements];
    const result = usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    expect(result.ok).toBe(true);
    expect(result.legacyShelfKey).toBe("ELECTRONICS");
    const after = usePosStore.getState();
    expect(after.products).toEqual(productSnap);
    expect(after.products[0]?.id).toBe("p-dell");
    expect(after.products[0]?.category).toBe("DELL");
    expect(after.products[0]?.stockOnHand).toBe(7);
    expect(after.stockMovements).toEqual(movementsSnap);
    expect(after.preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "ELECTRONICS")).toBe(true);
  });

  it("moving a product to a node identity does not create a stock movement", () => {
    usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    const beforeMovements = [...usePosStore.getState().stockMovements];
    const beforeStock = usePosStore.getState().products[0]?.stockOnHand;
    const r = usePosStore.getState().updateProduct("p-dell", { category: "ELECTRONICS" });
    expect(r.ok).toBe(true);
    const after = usePosStore.getState();
    expect(after.products[0]?.category).toBe("ELECTRONICS");
    expect(after.products[0]?.id).toBe("p-dell");
    expect(after.products[0]?.stockOnHand).toBe(beforeStock);
    expect(after.stockMovements).toEqual(beforeMovements);
  });

  it("renaming a CatalogNode identity does not modify stock", () => {
    usePosStore.getState().createCatalogShelf({ name: "DELL" });
    const beforeStock = usePosStore.getState().products[0]?.stockOnHand;
    const r = usePosStore.getState().renameShelfCategory("DELL", "DELL LAPTOPS");
    expect(r.ok).toBe(true);
    const after = usePosStore.getState();
    expect(after.products[0]?.category).toBe("DELL LAPTOPS");
    expect(after.products[0]?.stockOnHand).toBe(beforeStock);
    expect(after.preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "DELL LAPTOPS")).toBe(true);
    expect(after.preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "DELL")).toBe(false);
  });

  it("cashier cannot persist catalog mutations", () => {
    usePosStore.setState({
      sessionActor: { userId: "cashier:1", role: "cashier", displayName: "Cashier" },
    });
    const before = usePosStore.getState().preferences.posCatalogNodes ?? [];
    const created = usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    expect(created.ok).toBe(false);
    expect(usePosStore.getState().preferences.posCatalogNodes ?? []).toEqual(before);
  });

  it("deleting an empty CatalogNode records a tombstone so reconnect cannot resurrect it", () => {
    usePosStore.getState().createCatalogShelf({ name: "SPARE" });
    const productSnap = usePosStore.getState().products.map((p) => ({ ...p }));
    const r = usePosStore.getState().deleteEmptyShelf("SPARE");
    expect(r.ok).toBe(true);
    expect(usePosStore.getState().products).toEqual(productSnap);
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "SPARE")).toBe(
      false,
    );
    const tombstones = usePosStore.getState().preferences.posCatalogTombstones ?? [];
    expect(tombstones.length).toBeGreaterThan(0);
  });

  it("flag remains off for shops that never opted in", () => {
    usePosStore.setState({
      preferences: { ...createDefaultPreferences(), onboardingDone: true },
    });
    expect(isCatalogHierarchyEnabled(usePosStore.getState().preferences)).toBe(false);
  });

  it("reparent and sibling reorder do not change products, stock, movements, or barcodes", () => {
    const el = usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    expect(el.ok).toBe(true);
    const electronicsParentId =
      usePosStore.getState().preferences.posCatalogNodes?.find((n) => n.legacyShelfKey === "ELECTRONICS")?.id ?? null;
    const computers = usePosStore.getState().createCatalogShelf({
      name: "COMPUTERS",
      parentId: electronicsParentId,
    });
    expect(computers.ok).toBe(true);
    const printers = usePosStore.getState().createCatalogShelf({
      name: "PRINTERS",
      parentId: electronicsParentId,
    });
    expect(printers.ok).toBe(true);
    const before = usePosStore.getState();
    const productSnap = before.products.map((p) => ({
      id: p.id,
      category: p.category,
      sku: p.sku,
      stockOnHand: p.stockOnHand,
    }));
    const movementsSnap = [...before.stockMovements];
    const salesSnap = [...before.sales];
    const nodes = before.preferences.posCatalogNodes ?? [];
    const electronicsId = nodes.find((n) => n.legacyShelfKey === "ELECTRONICS")!.id;
    const computersId = nodes.find((n) => n.legacyShelfKey === "COMPUTERS")!.id;
    const printersId = nodes.find((n) => n.legacyShelfKey === "PRINTERS")!.id;
    const move = usePosStore.getState().reparentCatalogShelf(printersId, computersId);
    expect(move.ok).toBe(true);
    const reorder = usePosStore.getState().reorderCatalogSiblings(electronicsId, [computersId]);
    expect(reorder.ok).toBe(true);
    const after = usePosStore.getState();
    expect(after.products.map((p) => ({
      id: p.id,
      category: p.category,
      sku: p.sku,
      stockOnHand: p.stockOnHand,
    }))).toEqual(productSnap);
    expect(after.products[0]?.stockOnHand).toBe(7);
    expect(after.products[0]?.category).toBe("DELL");
    expect(after.stockMovements).toEqual(movementsSnap);
    expect(after.sales).toEqual(salesSnap);
    expect(after.preferences.posCatalogNodes?.find((n) => n.id === printersId)?.parentId).toBe(computersId);
  });

  it("14–15. parent with children cannot delete; empty leaf can", () => {
    const el = usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    expect(el.ok).toBe(true);
    const electronicsId =
      usePosStore.getState().preferences.posCatalogNodes?.find((n) => n.legacyShelfKey === "ELECTRONICS")?.id ?? null;
    const child = usePosStore.getState().createCatalogShelf({
      name: "COMPUTERS",
      parentId: electronicsId,
    });
    expect(child.ok).toBe(true);
    const productSnap = usePosStore.getState().products.map((p) => ({ ...p }));
    const blocked = usePosStore.getState().deleteEmptyShelf("ELECTRONICS");
    expect(blocked.ok).toBe(false);
    expect(blocked.errorKey).toBe("catalogFoldersCannotDeleteChildren");
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "ELECTRONICS")).toBe(
      true,
    );
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "COMPUTERS")).toBe(
      true,
    );
    const leaf = usePosStore.getState().deleteEmptyShelf("COMPUTERS");
    expect(leaf.ok).toBe(true);
    expect(usePosStore.getState().products).toEqual(productSnap);
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "COMPUTERS")).toBe(
      false,
    );
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "ELECTRONICS")).toBe(
      true,
    );
  });

  it("sequential Add child folder builds Electronics → Latitude without hunting a parent", () => {
    let selectedId: string | null = null;
    let expanded = new Set<string>();
    const names = ["Electronics", "Computers", "Laptops", "Dell", "Latitude"];
    for (const name of names) {
      const parentId = catalogCreateIntentParentId(selectedId ? "child" : "top-level", selectedId);
      const result = usePosStore.getState().createCatalogShelf({
        name,
        parentId,
      });
      expect(result.ok).toBe(true);
      expect(result.legacyShelfKey).toBe(name);
      const nodes = usePosStore.getState().preferences.posCatalogNodes ?? [];
      const created = nodes.find((n) => n.legacyShelfKey === name);
      expect(created).toBeTruthy();
      selectedId = created!.id;
      expanded = expandAncestorsForCreatedFolder(nodes, created!.parentId, expanded);
    }
    const nodes = usePosStore.getState().preferences.posCatalogNodes ?? [];
    const byName = Object.fromEntries(nodes.map((n) => [n.legacyShelfKey, n]));
    expect(byName.Electronics?.parentId).toBeNull();
    expect(byName.Computers?.parentId).toBe(byName.Electronics?.id);
    expect(byName.Laptops?.parentId).toBe(byName.Computers?.id);
    expect(byName.Dell?.parentId).toBe(byName.Laptops?.id);
    expect(byName.Latitude?.parentId).toBe(byName.Dell?.id);
    expect(selectedId).toBe(byName.Latitude?.id);
    expect(expanded.has(byName.Electronics!.id)).toBe(true);
    expect(expanded.has(byName.Computers!.id)).toBe(true);
    expect(expanded.has(byName.Laptops!.id)).toBe(true);
    expect(expanded.has(byName.Dell!.id)).toBe(true);
    expect(usePosStore.getState().products[0]?.category).toBe("DELL");
    expect(usePosStore.getState().products[0]?.stockOnHand).toBe(7);
    expect(usePosStore.getState().products.every((p) => !("catalogNodeId" in p))).toBe(true);
  });

  it("26. cashier cannot create or reparent catalog folders", () => {
    usePosStore.getState().createCatalogShelf({ name: "ELECTRONICS" });
    const nodeId = usePosStore.getState().preferences.posCatalogNodes?.[0]?.id ?? "";
    usePosStore.setState({
      sessionActor: { userId: "cashier:1", role: "cashier", displayName: "Cashier" },
    });
    const create = usePosStore.getState().createCatalogShelf({ name: "DELL" });
    expect(create.ok).toBe(false);
    const move = usePosStore.getState().reparentCatalogShelf(nodeId, null);
    expect(move.ok).toBe(false);
  });

  it("26b. manager and stock_keeper keep shelves.customize but cannot write posCatalogNodes without settings.shop", () => {
    for (const role of ["manager", "stock_keeper"] as const) {
      usePosStore.setState({
        sessionActor: { userId: `${role}:1`, role, displayName: role },
      });
      const create = usePosStore.getState().createCatalogShelf({ name: `FOLDER_${role}` });
      expect(create.ok).toBe(false);
    }
  });
});
