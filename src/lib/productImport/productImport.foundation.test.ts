import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePosStore } from "../../store/usePosStore";
import { createDefaultPreferences } from "../../data/defaultSeed";
import { setStoreSubscriptionContext } from "../storeSubscriptionContext";
import { defaultWizardUnitCostUgx } from "../simpleProductWizard";
import { parseAiBulkInventory } from "../ai/aiBusinessSchemas";
import { mapBulkRowsToQuickAdd } from "../ai/bulkInventoryAi";
import type { CatalogPickerItem } from "../catalogHierarchy";
import { buildProductFromSimpleWizard } from "../simpleProductWizard";
import { commitNormalizedProductImport } from "./commitNormalizedProductImport";
import { createNormalizedProductImportRow } from "./createNormalizedRow";
import { evaluateNormalizedProductRows, importHasBlockingIssues } from "./evaluateNormalizedProductRows";
import { mapNormalizedRowsToBulkQuickAdd } from "./mapNormalizedRowsToBulkQuickAdd";

const sodaA: CatalogPickerItem = {
  id: "a",
  parentId: "drinks",
  name: "Soda",
  legacyShelfKey: "SODA-COLD",
  depth: 1,
  pathLabels: ["Drinks", "Soda"],
  persisted: true,
  sortOrder: 0,
};
const sodaB: CatalogPickerItem = {
  id: "b",
  parentId: "snacks",
  name: "Soda",
  legacyShelfKey: "SODA-SNACKS",
  depth: 1,
  pathLabels: ["Snacks", "Soda"],
  persisted: true,
  sortOrder: 1,
};

describe("normalized product import foundation", () => {
  beforeEach(() => {
    setStoreSubscriptionContext({ snapshot: { kind: "local_full" }, authMode: "local" });
    usePosStore.setState({
      _hydrated: true,
      products: [],
      stockMovements: [],
      sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
      preferences: {
        ...createDefaultPreferences(),
        businessType: "kiosk_duka",
        pharmacyModeEnabled: false,
      },
    });
  });

  it("accepts a valid row", () => {
    const row = createNormalizedProductImportRow({
      name: "Sugar 1kg",
      categoryInput: "Groceries",
      category: "Groceries",
      sellingPriceUgx: 3500,
      stockQty: 10,
      costPricePerUnitUgx: 2800,
    });
    const evaluated = evaluateNormalizedProductRows({ rows: [row], pickerItems: [] });
    expect(importHasBlockingIssues(evaluated)).toBe(false);
    expect(evaluated[0]?.costStatus).toBe("provided");
  });

  it("rejects missing name and non-positive selling price", () => {
    const rows = [
      createNormalizedProductImportRow({ name: "  ", sellingPriceUgx: 1000 }),
      createNormalizedProductImportRow({ name: "Oil", sellingPriceUgx: 0 }),
    ];
    const evaluated = evaluateNormalizedProductRows({ rows, pickerItems: [] });
    expect(evaluated[0]?.issues.some((i) => i.kind === "missing_name")).toBe(true);
    expect(evaluated[1]?.issues.some((i) => i.kind === "invalid_price")).toBe(true);
    expect(importHasBlockingIssues(evaluated)).toBe(true);
  });

  it("preserves provided cost and does not mark fallback", () => {
    const row = createNormalizedProductImportRow({
      name: "Soap",
      sellingPriceUgx: 2000,
      costPricePerUnitUgx: 900,
    });
    const evaluated = evaluateNormalizedProductRows({ rows: [row], pickerItems: [] });
    expect(evaluated[0]?.costStatus).toBe("provided");
    expect(evaluated[0]?.issues.some((i) => i.kind === "cost_fallback")).toBe(false);
    const mapped = mapNormalizedRowsToBulkQuickAdd([row]);
    expect(mapped[0]?.costPricePerUnitUgx).toBe(900);
  });

  it("marks missing cost as visible fallback matching existing WAKA 72% rule", () => {
    const row = createNormalizedProductImportRow({ name: "Soap", sellingPriceUgx: 2000 });
    const evaluated = evaluateNormalizedProductRows({ rows: [row], pickerItems: [] });
    expect(evaluated[0]?.costStatus).toBe("missing_fallback");
    expect(evaluated[0]?.fallbackCostUgx).toBe(defaultWizardUnitCostUgx(2000));
    expect(evaluated[0]?.issues.some((i) => i.kind === "cost_fallback" && i.severity === "warning")).toBe(true);
    const mapped = mapNormalizedRowsToBulkQuickAdd([row]);
    expect(mapped[0]?.costPricePerUnitUgx).toBeUndefined();
  });

  it("carries opening quantity through to bulkQuickAddProducts", () => {
    const bulk = vi.fn().mockReturnValue({ added: 1, skipped: 0 });
    const row = createNormalizedProductImportRow({
      name: "Rice",
      sellingPriceUgx: 4000,
      stockQty: 12,
      costPricePerUnitUgx: 3000,
      categoryInput: "Grain",
    });
    commitNormalizedProductImport({
      rows: [row],
      bulkQuickAddProducts: bulk,
      pickerItems: [],
    });
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk.mock.calls[0]![0][0].stockQty).toBe(12);
  });

  it("resolves a unique category and blocks an ambiguous leaf folder", () => {
    const unique = createNormalizedProductImportRow({
      name: "Coke",
      sellingPriceUgx: 1500,
      categoryInput: "SODA-COLD",
    });
    const amb = createNormalizedProductImportRow({
      name: "Sprite",
      sellingPriceUgx: 1500,
      categoryInput: "Soda",
    });
    const ok = evaluateNormalizedProductRows({ rows: [unique], pickerItems: [sodaA, sodaB] });
    expect(ok[0]?.row.category).toBe("SODA-COLD");
    expect(ok[0]?.issues.some((i) => i.kind === "ambiguous_category")).toBe(false);

    const bad = evaluateNormalizedProductRows({ rows: [amb], pickerItems: [sodaA, sodaB] });
    expect(bad[0]?.issues.some((i) => i.kind === "ambiguous_category")).toBe(true);
    expect(importHasBlockingIssues(bad)).toBe(true);
    const blocked = commitNormalizedProductImport({
      rows: [amb],
      bulkQuickAddProducts: vi.fn(),
      pickerItems: [sodaA, sodaB],
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.added).toBe(0);
  });

  it("identifies duplicate names in the batch before commit", () => {
    const rows = [
      createNormalizedProductImportRow({ name: "Sugar", sellingPriceUgx: 1000, clientId: "1" }),
      createNormalizedProductImportRow({ name: "sugar", sellingPriceUgx: 1200, clientId: "2" }),
    ];
    const evaluated = evaluateNormalizedProductRows({ rows, pickerItems: [] });
    expect(evaluated.every((e) => e.issues.some((i) => i.kind === "duplicate_name"))).toBe(true);
    expect(
      commitNormalizedProductImport({
        rows,
        bulkQuickAddProducts: vi.fn(),
        pickerItems: [],
      }).blocked,
    ).toBe(true);
  });

  it("successful import calls bulkQuickAddProducts and writes opening stock + provided cost", () => {
    const wrapped = vi.fn((rows: Parameters<typeof bulk>[0]) => usePosStore.getState().bulkQuickAddProducts(rows));

    const row = createNormalizedProductImportRow({
      name: "Imported Tea",
      sellingPriceUgx: 5000,
      stockQty: 8,
      costPricePerUnitUgx: 3200,
      categoryInput: "Drinks",
    });
    const result = commitNormalizedProductImport({
      rows: [row],
      bulkQuickAddProducts: wrapped,
      pickerItems: [],
    });
    expect(wrapped).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false);
    expect(result.added).toBe(1);
    const product = usePosStore.getState().products.find((p) => p.name === "Imported Tea");
    expect(product?.stockOnHand).toBe(8);
    expect(product?.costPricePerUnitUgx).toBe(3200);
    expect(product?.sellingPricePerUnitUgx).toBe(5000);
    expect(usePosStore.getState().stockMovements.some((m) => m.kind === "opening_stock" && m.deltaBaseUnits === 8)).toBe(
      true,
    );
  });

  it("missing cost on commit uses the existing 72% draft fallback", () => {
    const row = createNormalizedProductImportRow({
      name: "Imported Soap",
      sellingPriceUgx: 2000,
      stockQty: 0,
    });
    commitNormalizedProductImport({
      rows: [row],
      bulkQuickAddProducts: usePosStore.getState().bulkQuickAddProducts,
      pickerItems: [],
    });
    const product = usePosStore.getState().products.find((p) => p.name === "Imported Soap");
    expect(product?.costPricePerUnitUgx).toBe(defaultWizardUnitCostUgx(2000));
    expect(usePosStore.getState().stockMovements.filter((m) => m.productId === product?.id)).toHaveLength(0);
  });
});

describe("import foundation does not change existing AI bulk mapping", () => {
  it("still filters disabled and zero-price AI rows", () => {
    const mapped = mapBulkRowsToQuickAdd([
      {
        name: "Soap",
        category: "Household",
        unit: "piece",
        sellingMode: "unit",
        suggestedPriceUgx: 2000,
        enabled: true,
        stockQty: 5,
        priceUgx: 2000,
      },
      {
        name: "No price",
        category: "General",
        unit: "piece",
        sellingMode: "unit",
        suggestedPriceUgx: 0,
        enabled: true,
        stockQty: 0,
        priceUgx: 0,
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.stockQty).toBe(5);
  });

  it("still parses AI bulk JSON", () => {
    const rows = parseAiBulkInventory({
      products: [{ name: "Sugar 1kg", category: "Groceries", unit: "kg", sellingMode: "weighted", suggestedPriceUgx: 3500 }],
    });
    expect(rows[0]?.name).toBe("Sugar 1kg");
  });
});

describe("manual add-product builder still works", () => {
  it("buildProductFromSimpleWizard still requires name and sell price", () => {
    expect(
      buildProductFromSimpleWizard(
        {
          name: "",
          shelf: "General",
          sellUnit: "piece",
          sellUnitCustom: "",
          hasPack: false,
          packKind: "crate",
          packCustom: "",
          piecesPerPack: "",
          stockCount: "1",
          sellPriceUgx: "1000",
          buyPackPriceUgx: "",
        },
        "en",
      ),
    ).toBeNull();
    const built = buildProductFromSimpleWizard(
      {
        name: "Soda",
        shelf: "Drinks",
        sellUnit: "bottle",
        sellUnitCustom: "",
        hasPack: false,
        packKind: "crate",
        packCustom: "",
        piecesPerPack: "",
        stockCount: "4",
        sellPriceUgx: "1500",
        buyPackPriceUgx: "",
      },
      "en",
    );
    expect(built?.name).toBe("Soda");
    expect(built?.priceUgx).toBe(1500);
    expect(built?.stockQty).toBe(4);
  });
});
