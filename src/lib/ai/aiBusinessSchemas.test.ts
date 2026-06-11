import { describe, expect, it } from "vitest";
import { parseAiBulkInventory, parseAiBusinessSetup } from "./aiBusinessSchemas";
import { mapBulkRowsToQuickAdd } from "./bulkInventoryAi";

describe("parseAiBusinessSetup", () => {
  it("parses shelves and starter products", () => {
    const setup = parseAiBusinessSetup({
      detected_nature: "Grocery",
      shelves: ["Soda", "Snacks"],
      starter_products: [
        {
          name: "Coca Cola 500ml",
          category: "Soda",
          unit: "bottle",
          sellingMode: "unit",
          suggestedPriceUgx: 1500,
          suggestedStockQty: 24,
        },
      ],
    });
    expect(setup?.detectedNature).toBe("Grocery");
    expect(setup?.shelves).toContain("Soda");
    expect(setup?.starterProducts[0]?.name).toBe("Coca Cola 500ml");
  });
});

describe("parseAiBulkInventory", () => {
  it("parses bulk product rows", () => {
    const rows = parseAiBulkInventory({
      products: [
        { name: "Sugar 1kg", category: "Groceries", unit: "kg", sellingMode: "weighted", suggestedPriceUgx: 3500 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sellingMode).toBe("weighted");
  });
});

describe("mapBulkRowsToQuickAdd", () => {
  it("filters disabled and zero-price rows", () => {
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
      {
        name: "Off",
        category: "General",
        unit: "piece",
        sellingMode: "unit",
        suggestedPriceUgx: 1000,
        enabled: false,
        stockQty: 0,
        priceUgx: 1000,
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.name).toBe("Soap");
  });
});
