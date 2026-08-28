import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { usePosStore } from "../store/usePosStore";
import { createDefaultPreferences } from "../data/defaultSeed";
import { setStoreSubscriptionContext } from "./storeSubscriptionContext";
import { buildProductFromSimpleWizard } from "./simpleProductWizard";
import { retailWizardAfterSaveAndAddAnother } from "./productWizardSessionDraft";
import {
  assignmentCategoryFromPickerItem,
  buildCatalogPickerItems,
  LOCAL_CATALOG_SHOP_ID,
  nextDestinationAfterCatalogCreate,
  selectedCatalogDestinationPath,
} from "./catalogHierarchy";
import type { CatalogNode } from "../types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const lang = "en" as const;

function latitudeTree(): CatalogNode[] {
  const names = ["ELECTRONICS", "COMPUTERS", "LAPTOPS", "DELL", "LATITUDE"] as const;
  const nodes: CatalogNode[] = [];
  let parentId: string | null = null;
  names.forEach((name) => {
    const id = `n-${name}`;
    nodes.push({
      id,
      shopId: LOCAL_CATALOG_SHOP_ID,
      parentId,
      legacyShelfKey: name,
      name,
      sortOrder: 0,
      createdAt: "",
      updatedAt: "",
    });
    parentId = id;
  });
  return nodes;
}

describe("H3 Add Product catalog destination", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      products: [],
      stockMovements: [],
      sales: [],
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      preferences: {
        ...createDefaultPreferences(),
        catalogHierarchyEnabled: true,
        onboardingDone: true,
        posCatalogNodes: latitudeTree(),
      },
    });
  });

  it("1–2. Save & add another keeps LATITUDE and both products receive that identity", () => {
    const firstFields = {
      step: "buyPrice" as const,
      name: "Dell Latitude 5420",
      shelf: "LATITUDE",
      sellUnit: "piece" as const,
      sellUnitCustom: "",
      hasPack: false,
      packKind: "crate" as const,
      packCustom: "",
      piecesPerPack: "",
      stockCount: "2",
      sellPrice: "2500000",
      buyPackPrice: "",
      auditReason: "",
      editingProductId: null,
    };
    const first = buildProductFromSimpleWizard(
      {
        name: firstFields.name,
        shelf: firstFields.shelf,
        sellUnit: firstFields.sellUnit,
        sellUnitCustom: "",
        hasPack: false,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "",
        stockCount: firstFields.stockCount,
        sellPriceUgx: firstFields.sellPrice,
        buyPackPriceUgx: "",
      },
      lang,
    );
    expect(first?.category).toBe("LATITUDE");
    expect(first?.category).not.toContain("/");
    const r1 = usePosStore.getState().quickAddProduct({
      name: first!.name,
      priceUgx: first!.priceUgx,
      stockQty: first!.stockQty,
      category: first!.category,
    });
    expect(r1.ok).toBe(true);

    const next = retailWizardAfterSaveAndAddAnother(firstFields);
    expect(next.shelf).toBe("LATITUDE");
    expect(next.name).toBe("");
    expect(next.step).toBe("name");

    const second = buildProductFromSimpleWizard(
      {
        name: "Dell Latitude 5430",
        shelf: next.shelf,
        sellUnit: "piece",
        sellUnitCustom: "",
        hasPack: false,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "",
        stockCount: "1",
        sellPriceUgx: "2600000",
        buyPackPriceUgx: "",
      },
      lang,
    );
    expect(second?.category).toBe("LATITUDE");
    const r2 = usePosStore.getState().quickAddProduct({
      name: second!.name,
      priceUgx: second!.priceUgx,
      stockQty: second!.stockQty,
      category: second!.category,
    });
    expect(r2.ok).toBe(true);
    const cats = usePosStore.getState().products.map((p) => p.category);
    expect(cats).toEqual(["LATITUDE", "LATITUDE"]);
    expect(usePosStore.getState().products.every((p) => !("catalogNodeId" in p))).toBe(true);
  });

  it("3. hierarchy OFF still assigns a flat DELL identity", () => {
    usePosStore.setState({
      preferences: { ...createDefaultPreferences(), catalogHierarchyEnabled: false, onboardingDone: true },
    });
    const built = buildProductFromSimpleWizard(
      {
        name: "Dell Latitude 5420",
        shelf: "DELL",
        sellUnit: "piece",
        sellUnitCustom: "",
        hasPack: false,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "",
        stockCount: "1",
        sellPriceUgx: "2000000",
        buyPackPriceUgx: "",
      },
      lang,
    );
    expect(built?.category).toBe("DELL");
    expect(retailWizardAfterSaveAndAddAnother({
      step: "name",
      name: "",
      shelf: "DELL",
      sellUnit: "piece",
      sellUnitCustom: "",
      hasPack: false,
      packKind: "crate",
      packCustom: "",
      piecesPerPack: "",
      stockCount: "",
      sellPrice: "",
      buyPackPrice: "",
      auditReason: "",
      editingProductId: null,
    }).shelf).toBe("DELL");
    expect(usePosStore.getState().preferences.posCatalogNodes ?? []).toEqual([]);
  });

  it("4–5. selected path is display-only; assignment identity is LATITUDE", () => {
    const items = buildCatalogPickerItems({
      products: [],
      layout: {},
      orderKeys: [],
      nodes: latitudeTree(),
      shopId: LOCAL_CATALOG_SHOP_ID,
    });
    const leaf = items.find((i) => i.legacyShelfKey === "LATITUDE");
    expect(leaf).toBeTruthy();
    expect(assignmentCategoryFromPickerItem(leaf!)).toBe("LATITUDE");
    expect(selectedCatalogDestinationPath(items, "LATITUDE")).toBe(
      "ELECTRONICS / COMPUTERS / LAPTOPS / DELL / LATITUDE",
    );
  });

  it("8. create folder success persists a node and selects its identity", () => {
    const created = usePosStore.getState().createCatalogShelf({
      name: "INSPIRON",
      parentId: usePosStore.getState().preferences.posCatalogNodes?.find((n) => n.legacyShelfKey === "DELL")?.id ?? null,
    });
    expect(created.ok).toBe(true);
    expect(created.legacyShelfKey).toBe("INSPIRON");
    const next = nextDestinationAfterCatalogCreate({
      ok: created.ok,
      legacyShelfKey: created.legacyShelfKey,
      currentValue: "LATITUDE",
    });
    expect(next).toEqual({ value: "INSPIRON", assigned: true });
    expect(usePosStore.getState().preferences.posCatalogNodes?.some((n) => n.legacyShelfKey === "INSPIRON")).toBe(
      true,
    );
  });

  it("9–10. create failure does not assign a typed fallback category", () => {
    usePosStore.setState({
      sessionActor: { userId: "mgr:1", role: "manager", displayName: "Manager" },
    });
    const current = "LATITUDE";
    const result = usePosStore.getState().createCatalogShelf({ name: "INSPIRON" });
    expect(result.ok).toBe(false);
    const next = nextDestinationAfterCatalogCreate({
      ok: result.ok,
      legacyShelfKey: result.legacyShelfKey,
      currentValue: current,
    });
    expect(next.assigned).toBe(false);
    expect(next.value).toBe("LATITUDE");
    expect(next.value).not.toBe("INSPIRON");
    expect(usePosStore.getState().products).toEqual([]);
  });

  it("13–14. adding products uses opening stock only; category-only move does not add a movement", () => {
    const add = usePosStore.getState().quickAddProduct({
      name: "Dell Latitude 5420",
      priceUgx: 2_500_000,
      stockQty: 3,
      category: "LATITUDE",
    });
    expect(add.ok).toBe(true);
    const product = usePosStore.getState().products[0]!;
    expect(product.stockOnHand).toBe(3);
    expect(usePosStore.getState().stockMovements.every((m) => m.kind === "opening_stock")).toBe(true);
    const movementCount = usePosStore.getState().stockMovements.length;
    const id = product.id;
    const sku = product.sku;
    const move = usePosStore.getState().updateProduct(id, { category: "INSPIRON" });
    expect(move.ok).toBe(true);
    const after = usePosStore.getState().products.find((p) => p.id === id)!;
    expect(after.id).toBe(id);
    expect(after.sku).toBe(sku);
    expect(after.stockOnHand).toBe(3);
    expect(after.category).toBe("INSPIRON");
    expect(usePosStore.getState().stockMovements).toHaveLength(movementCount);
  });

  it("picker wiring hides fallback assignment and uses persist helper", () => {
    const src = readFileSync(join(ROOT, "src/components/stock/HierarchyShelfPicker.tsx"), "utf8");
    expect(src).toContain("canPersistCatalogShelfPreferences");
    expect(src).toContain("nextDestinationAfterCatalogCreate");
    expect(src).toContain("catalogSelectedFolder");
    expect(src).not.toMatch(/onChange\(fallback\)/);
    expect(src).not.toMatch(/if \(fallback\) onChange/);
  });
});
