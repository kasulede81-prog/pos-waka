import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  buildProductFromSimpleWizard,
  defaultWizardUnitCostUgx,
  resolveWizardEditCostPatch,
  type SimpleWizardInput,
} from "./simpleProductWizard";

const lang = "en" as const;

function baseInput(overrides: Partial<SimpleWizardInput> = {}): SimpleWizardInput {
  return {
    name: "Soap",
    shelf: "Groceries",
    sellUnit: "piece",
    sellUnitCustom: "",
    hasPack: false,
    packKind: "crate",
    packCustom: "",
    piecesPerPack: "",
    stockCount: "10",
    sellPriceUgx: "1000",
    buyPackPriceUgx: "",
    ...overrides,
  };
}

function packProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Coca Cola",
    sellingPricePerUnitUgx: 1500,
    costPricePerUnitUgx: 1200,
    stockOnHand: 48,
    baseUnit: "bottle",
    buyingUnit: "crate",
    conversionRate: 24,
    buyingPackCostUgx: 28_800,
    sellingMode: "unit",
    category: "Drinks",
    sku: "SKU-1",
    minimumStockAlert: 5,
    updatedAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("buildProductFromSimpleWizard no-pack unit selection", () => {
  it.each([
    ["kg", "kg", "Sugar 1kg"],
    ["bottle", "bottle", "Coca Cola 500ml"],
    ["piece", "piece", "Soap bar"],
    ["litre", "litre", "Cooking oil"],
  ] as const)("saves %s as %s regardless of name inference", (sellUnit, expectedUnit, name) => {
    const built = buildProductFromSimpleWizard(
      baseInput({ name, sellUnit, hasPack: false }),
      lang,
    );
    expect(built).not.toBeNull();
    expect(built!.baseUnit).toBe(expectedUnit);
    expect(built!.buyingUnit).toBeUndefined();
    expect(built!.conversionRate).toBeUndefined();
    expect(built!.buyingPackCostUgx).toBeUndefined();
  });

  it("saves custom gram unit from manual selection", () => {
    const built = buildProductFromSimpleWizard(
      baseInput({
        name: "Salt sachet",
        sellUnit: "custom",
        sellUnitCustom: "Gram",
        hasPack: false,
      }),
      lang,
    );
    expect(built!.baseUnit).toBe("gram");
  });

  it("does not multiply stock when hasPack is false", () => {
    const built = buildProductFromSimpleWizard(
      baseInput({ stockCount: "25", piecesPerPack: "24", buyPackPriceUgx: "36000", hasPack: false }),
      lang,
    );
    expect(built!.stockQty).toBe(25);
  });

  it("keeps pack product behaviour unchanged", () => {
    const built = buildProductFromSimpleWizard(
      baseInput({
        name: "Coca Cola",
        sellUnit: "bottle",
        hasPack: true,
        packKind: "crate",
        piecesPerPack: "24",
        stockCount: "2",
        buyPackPriceUgx: "36000",
        sellPriceUgx: "1500",
      }),
      lang,
    );
    expect(built!.baseUnit).toBe("bottle");
    expect(built!.stockQty).toBe(48);
    expect(built!.buyingUnit).toBe("crate");
    expect(built!.conversionRate).toBe(24);
    expect(built!.costPricePerUnitUgx).toBe(1500);
  });
});

describe("resolveWizardEditCostPatch", () => {
  it("recalculates cost when pack tracking is removed", () => {
    const previous = packProduct({ costPricePerUnitUgx: 1200 });
    const built = buildProductFromSimpleWizard(
      baseInput({
        name: "Coca Cola",
        sellUnit: "bottle",
        hasPack: false,
        sellPriceUgx: "2000",
        stockCount: "48",
      }),
      lang,
    )!;
    expect(resolveWizardEditCostPatch(built, previous)).toBe(defaultWizardUnitCostUgx(2000));
  });

  it("does not change cost for products that were already no-pack", () => {
    const previous = packProduct({
      buyingUnit: null,
      conversionRate: null,
      buyingPackCostUgx: null,
      costPricePerUnitUgx: 800,
      baseUnit: "piece",
    });
    const built = buildProductFromSimpleWizard(
      baseInput({ name: "Soap", sellUnit: "piece", hasPack: false, sellPriceUgx: "1000" }),
      lang,
    )!;
    expect(resolveWizardEditCostPatch(built, previous)).toBeUndefined();
  });

  it("uses explicit wizard cost when provided for pack products", () => {
    const previous = packProduct();
    const built = buildProductFromSimpleWizard(
      baseInput({
        name: "Coca Cola",
        sellUnit: "bottle",
        hasPack: true,
        piecesPerPack: "24",
        stockCount: "2",
        buyPackPriceUgx: "48000",
        sellPriceUgx: "2000",
      }),
      lang,
    )!;
    expect(resolveWizardEditCostPatch(built, previous)).toBe(2000);
  });
});
