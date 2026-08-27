import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import { QUICK_SELL_SHELF_KEY } from "./posShelfLayout";
import { planShelfRename } from "./renameShelfCategory";

function product(category: string, id: string = crypto.randomUUID()): Product {
  return {
    id: id as Product["id"],
    name: id,
    category,
    sku: "",
    baseUnit: "piece",
    stockOnHand: 1,
    minimumStockAlert: 0,
    sellingPricePerUnitUgx: 1000,
    costPricePerUnitUgx: 500,
    sellingMode: "unit",
    updatedAt: "",
    version: 1,
  } as Product;
}

describe("planShelfRename", () => {
  it("renames products and migrates layout/order keys", () => {
    const a = product("Drinks", "a");
    const b = product("Drinks", "b");
    const c = product("Snacks", "c");
    const result = planShelfRename({
      fromKey: "Drinks",
      toName: "  Soft Drinks  ",
      products: [a, b, c],
      layout: { Drinks: { color: "blue", icon: "🥤" }, Snacks: { color: "orange" } },
      orderKeys: ["Drinks", "Snacks"],
      sellCategoryFilter: "Drinks",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toKey).toBe("Soft Drinks");
    expect(result.productIds).toEqual(["a", "b"]);
    expect(result.layout["Soft Drinks"]?.color).toBe("blue");
    expect(result.layout["Soft Drinks"]?.icon).toBe("🥤");
    expect(result.layout.Drinks).toBeUndefined();
    expect(result.orderKeys).toEqual(["Soft Drinks", "Snacks"]);
    expect(result.sellCategoryFilter).toBe("Soft Drinks");
  });

  it("rejects merging into an existing shelf", () => {
    const result = planShelfRename({
      fromKey: "Drinks",
      toName: "Snacks",
      products: [product("Drinks"), product("Snacks")],
      layout: {},
      orderKeys: ["Drinks", "Snacks"],
    });
    expect(result).toEqual({ ok: false, errorKey: "shelfRenameExists" });
  });

  it("rejects empty, reserved, and uncategorized keys", () => {
    const products = [product("Drinks")];
    const empty = planShelfRename({ fromKey: "Drinks", toName: "   ", products, layout: {}, orderKeys: [] });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errorKey).toBe("shelfRenameEmpty");

    const uncat = planShelfRename({
      fromKey: UNCATEGORIZED_SENTINEL,
      toName: "Loose",
      products,
      layout: {},
      orderKeys: [],
    });
    expect(uncat.ok).toBe(false);
    if (uncat.ok) return;
    expect(uncat.errorKey).toBe("shelfRenameUncategorized");

    const fromQuick = planShelfRename({
      fromKey: QUICK_SELL_SHELF_KEY,
      toName: "Fast",
      products,
      layout: {},
      orderKeys: [],
    });
    expect(fromQuick.ok).toBe(false);
    if (fromQuick.ok) return;
    expect(fromQuick.errorKey).toBe("shelfRenameUncategorized");

    const toQuick = planShelfRename({
      fromKey: "Drinks",
      toName: QUICK_SELL_SHELF_KEY,
      products,
      layout: {},
      orderKeys: [],
    });
    expect(toQuick.ok).toBe(false);
    if (toQuick.ok) return;
    expect(toQuick.errorKey).toBe("shelfRenameReserved");
  });

  it("allows a case-only rename of the same shelf", () => {
    const p = product("drinks", "a");
    const result = planShelfRename({
      fromKey: "drinks",
      toName: "Drinks",
      products: [p],
      layout: { drinks: { color: "red" } },
      orderKeys: ["drinks"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toKey).toBe("Drinks");
    expect(result.productIds).toEqual(["a"]);
    expect(result.layout.Drinks?.color).toBe("red");
    expect(result.layout.drinks).toBeUndefined();
    expect(result.orderKeys).toEqual(["Drinks"]);
  });

  it("drops case-variant layout and order keys while keeping unrelated empty shelves", () => {
    const result = planShelfRename({
      fromKey: "DELL",
      toName: "DELL LAPTOPS",
      products: [product("DELL", "a"), product("DELL", "b")],
      layout: {
        DELL: { color: "blue" },
        Dell: { icon: "💻" },
        dell: { color: "red" },
        HP: { color: "orange" },
        Accessories: { color: "green" },
      },
      orderKeys: ["dell", "HP", "DELL", "Accessories", "Dell"],
      sellCategoryFilter: "Dell",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toKey).toBe("DELL LAPTOPS");
    expect(result.productIds).toEqual(["a", "b"]);
    expect(result.layout["DELL LAPTOPS"]?.color).toBe("blue");
    expect(result.layout.DELL).toBeUndefined();
    expect(result.layout.Dell).toBeUndefined();
    expect(result.layout.dell).toBeUndefined();
    expect(result.layout.HP?.color).toBe("orange");
    expect(result.layout.Accessories?.color).toBe("green");
    expect(result.orderKeys).toEqual(["DELL LAPTOPS", "HP", "Accessories"]);
    expect(result.sellCategoryFilter).toBe("DELL LAPTOPS");
  });
});
