import { describe, expect, it } from "vitest";
import {
  buildPosShelfDisplayCards,
  mergeShelfLayout,
  shelfGridSpanClass,
  shelfGridSpanFromScale,
  shelfMasonryGridClass,
  sortShelvesForDisplay,
  updateShelfLayoutEntry,
} from "./posShelfLayout";
import { applyShelfPreset } from "./posShelfPresets";
import type { Product } from "../types";

function product(category: string, name = "Item"): Product {
  return {
    id: crypto.randomUUID(),
    name,
    category,
    sku: "",
    baseUnit: "piece",
    stockOnHand: 10,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    buyingUnit: "",
    sellingMode: "unit",
    trackStock: true,
    updatedAt: "",
    version: 1,
  } as Product;
}

describe("posShelfLayout", () => {
  it("merges custom display name and featured size", () => {
    const merged = mergeShelfLayout(
      { key: "Drinks", label: "Drinks", count: 3, icon: "🥤" },
      { displayName: "Soft Drinks", featured: true, scale: 88, color: "blue", customColor: "#3366cc" },
    );
    expect(merged.label).toBe("Soft Drinks");
    expect(merged.featured).toBe(true);
    expect(merged.scale).toBe(88);
    expect(merged.size).toBe("large");
    expect(merged.customColor).toBe("#3366cc");
    expect(merged.color).toBe("blue");
  });

  it("sorts featured shelves first", () => {
    const cards = [
      mergeShelfLayout({ key: "A", label: "A", count: 1, icon: null }, {}),
      mergeShelfLayout({ key: "B", label: "B", count: 1, icon: null }, { featured: true }),
    ];
    const sorted = sortShelvesForDisplay(cards, ["A", "B"]);
    expect(sorted[0]?.key).toBe("B");
  });

  it("builds display cards from products", () => {
    const cards = buildPosShelfDisplayCards(
      [product("Beer"), product("Beer"), product("Snacks")],
      "No shelf",
      { Beer: { displayName: "Beer", icon: "🍺", color: "orange" } },
      [],
    );
    expect(cards.find((c) => c.key === "Beer")?.label).toBe("Beer");
    expect(cards.find((c) => c.key === "Beer")?.count).toBe(2);
  });

  it("maps grid span classes by size", () => {
    expect(shelfGridSpanClass("large")).toContain("col-span-2");
    expect(shelfGridSpanClass("medium")).toContain("col-span-2");
    expect(shelfGridSpanClass("small")).toContain("col-span-1");
  });

  it("maps grid span from continuous scale", () => {
    expect(shelfGridSpanFromScale(30)).toEqual({ col: 1, row: 1 });
    expect(shelfGridSpanFromScale(55)).toEqual({ col: 2, row: 1 });
    expect(shelfGridSpanFromScale(90)).toEqual({ col: 2, row: 2 });
  });

  it("exposes masonry grid with fixed row tracks", () => {
    expect(shelfMasonryGridClass()).toContain("auto-rows-");
    expect(shelfMasonryGridClass()).toContain("grid-flow-dense");
  });

  it("updates layout entry immutably", () => {
    const next = updateShelfLayoutEntry({}, "Drinks", { color: "red", badge: null });
    expect(next.Drinks?.color).toBe("red");
    expect(next.Drinks?.badge).toBeNull();
  });
});

describe("posShelfPresets", () => {
  it("applies retail preset with quick sell ids", () => {
    const products = [
      product("Soft Drinks", "Coke"),
      product("Snacks", "Chips"),
      product("Rice", "Rice 5kg"),
    ];
    const result = applyShelfPreset("retail", products);
    expect(result.orderKeys.length).toBeGreaterThan(0);
    expect(result.quickSellProductIds.length).toBeGreaterThan(0);
  });
});
