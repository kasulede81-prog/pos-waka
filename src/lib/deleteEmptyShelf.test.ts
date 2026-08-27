import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import { UNCATEGORIZED_SENTINEL } from "./productCategories";
import { QUICK_SELL_SHELF_KEY } from "./posShelfLayout";
import { planDeleteEmptyShelf } from "./deleteEmptyShelf";

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

const emptyLayout = {
  DELL: { color: "blue" as const },
  HP: { color: "orange" as const },
  Accessories: { color: "green" as const },
};

describe("planDeleteEmptyShelf", () => {
  it("deletes an empty shelf from layout and order without touching product objects", () => {
    const products = [product("DELL LAPTOPS", "a"), product("DELL LAPTOPS", "b")];
    const snapshot = products.map((p) => ({ ...p }));
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products,
      layout: emptyLayout,
      orderKeys: ["DELL", "HP", "Accessories", "DELL LAPTOPS"],
      sellCategoryFilter: "DELL",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.DELL).toBeUndefined();
    expect(result.layout.HP?.color).toBe("orange");
    expect(result.layout.Accessories?.color).toBe("green");
    expect(result.orderKeys).toEqual(["HP", "Accessories", "DELL LAPTOPS"]);
    expect(result.clearSellCategoryFilter).toBe(true);
    expect(products).toEqual(snapshot);
    expect("productIds" in result).toBe(false);
  });

  it("rejects a shelf containing one product", () => {
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products: [product("DELL")],
      layout: { DELL: { color: "blue" } },
      orderKeys: ["DELL"],
    });
    expect(result).toEqual({ ok: false, errorKey: "shelfDeleteNotEmpty" });
  });

  it("rejects a shelf containing multiple products", () => {
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products: [product("DELL", "a"), product("DELL", "b")],
      layout: { DELL: {} },
      orderKeys: ["DELL"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe("shelfDeleteNotEmpty");
  });

  it("rejects when an archived product still uses the shelf identity", () => {
    const archivedStillInCatalog = product("DELL", "archived-1");
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products: [archivedStillInCatalog, product("HP")],
      layout: { DELL: { color: "blue" }, HP: { color: "orange" } },
      orderKeys: ["DELL", "HP"],
    });
    expect(result).toEqual({ ok: false, errorKey: "shelfDeleteNotEmpty" });
  });

  it("drops empty case-variant layout and order keys", () => {
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products: [product("DELL LAPTOPS")],
      layout: {
        DELL: { color: "blue" },
        Dell: { icon: "💻" },
        dell: { color: "red" },
        HP: { color: "orange" },
      },
      orderKeys: ["dell", "HP", "DELL", "Dell"],
      sellCategoryFilter: "Dell",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.DELL).toBeUndefined();
    expect(result.layout.Dell).toBeUndefined();
    expect(result.layout.dell).toBeUndefined();
    expect(result.layout.HP?.color).toBe("orange");
    expect(result.orderKeys).toEqual(["HP"]);
    expect(result.clearSellCategoryFilter).toBe(true);
  });

  it("rejects when a case-variant still has products", () => {
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products: [product("Dell")],
      layout: { DELL: { color: "blue" }, Dell: { color: "red" } },
      orderKeys: ["DELL", "Dell"],
    });
    expect(result).toEqual({ ok: false, errorKey: "shelfDeleteNotEmpty" });
  });

  it("does not clear an unrelated sell filter", () => {
    const result = planDeleteEmptyShelf({
      shelfKey: "DELL",
      products: [],
      layout: { DELL: {}, HP: {} },
      orderKeys: ["DELL", "HP"],
      sellCategoryFilter: "HP",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clearSellCategoryFilter).toBe(false);
    expect(result.layout.HP).toEqual({});
    expect(result.orderKeys).toEqual(["HP"]);
  });

  it("rejects uncategorized and Quick Sell", () => {
    const products = [product("Drinks")];
    const uncat = planDeleteEmptyShelf({
      shelfKey: UNCATEGORIZED_SENTINEL,
      products,
      layout: {},
      orderKeys: [],
    });
    expect(uncat).toEqual({ ok: false, errorKey: "shelfDeleteReserved" });

    const quick = planDeleteEmptyShelf({
      shelfKey: QUICK_SELL_SHELF_KEY,
      products,
      layout: {},
      orderKeys: [],
    });
    expect(quick).toEqual({ ok: false, errorKey: "shelfDeleteReserved" });
  });

  it("rejects an empty or whitespace key", () => {
    const result = planDeleteEmptyShelf({
      shelfKey: "   ",
      products: [],
      layout: {},
      orderKeys: [],
    });
    expect(result).toEqual({ ok: false, errorKey: "shelfDeleteEmpty" });
  });
});
