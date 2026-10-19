import { describe, expect, it } from "vitest";
import type { Product, Sale, SaleLine, SaleLineModifier } from "../types";
import { computeHospitalityReports } from "./hospitalityReports";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "ea",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-06-02T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const chicken = product({
  id: "chicken",
  name: "Chicken",
  category: "Ingredients",
  baseUnit: "kg",
  costPricePerUnitUgx: 8_000,
  menu: { productKind: "ingredient" },
});
const spice = product({
  id: "spice",
  name: "Spice mix",
  category: "Ingredients",
  baseUnit: "kg",
  costPricePerUnitUgx: 0,
  menu: { productKind: "ingredient" },
});

const completeDish = product({
  id: "complete",
  name: "Chicken plate",
  menu: {
    productKind: "finished_menu",
    recipe: {
      yieldQty: 4,
      lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
    },
  },
});
const lowMarginDish = product({
  id: "low",
  name: "Low margin plate",
  menu: {
    productKind: "finished_menu",
    recipe: {
      yieldQty: 1,
      lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
    },
  },
});
const unsoldLowMarginDish = product({
  id: "unsold-low",
  name: "Unsold low margin plate",
  menu: {
    productKind: "finished_menu",
    recipe: {
      yieldQty: 1,
      lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
    },
  },
});
const incompleteDish = product({
  id: "incomplete",
  name: "Spice plate",
  sellingPricePerUnitUgx: 5_000,
  menu: {
    productKind: "finished_menu",
    recipe: {
      yieldQty: 1,
      lines: [
        { ingredientProductId: "spice", quantityBase: 0.1, unitLabel: "kg" },
        { ingredientProductId: "ghost", quantityBase: 1, unitLabel: "ea" },
      ],
    },
  },
});
const noRecipeDish = product({
  id: "no-recipe",
  name: "Pilau",
  sellingPricePerUnitUgx: 7_000,
  costPricePerUnitUgx: 5_040,
  costSource: "quick_add_default",
  menu: { productKind: "finished_menu", recipe: null },
});
const verifiedWater = product({
  id: "water",
  name: "Water",
  category: "Drinks",
  baseUnit: "bottle",
  sellingPricePerUnitUgx: 1_500,
  costPricePerUnitUgx: 800,
  costSource: "manual",
  menu: { productKind: "retail" },
});
const unverifiedSoda = product({
  id: "soda",
  name: "Soda",
  category: "Drinks",
  baseUnit: "bottle",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 1_440,
  costSource: "quick_add_default",
  menu: { productKind: "retail" },
});

const products = [
  chicken,
  spice,
  completeDish,
  lowMarginDish,
  unsoldLowMarginDish,
  incompleteDish,
  noRecipeDish,
  verifiedWater,
  unverifiedSoda,
];

function line(
  p: Product,
  quantity: number,
  opts?: { voided?: boolean; modifiers?: SaleLineModifier[] },
): SaleLine {
  return {
    productId: p.id,
    name: p.name,
    inputMode: "quantity",
    quantity,
    unitPriceUgx: p.sellingPricePerUnitUgx,
    unitCostUgx: 0,
    lineTotalUgx: Math.round(p.sellingPricePerUnitUgx * quantity),
    estimatedProfitUgx: 0,
    voided: opts?.voided,
    selectedModifiers: opts?.modifiers,
  };
}

const extraSauce: SaleLineModifier = {
  groupId: "extras",
  groupLabel: "Extras",
  optionId: "sauce",
  optionLabel: "Extra sauce",
  priceDeltaUgx: 0,
};

const sale: Sale = {
  id: "sale-1",
  status: "completed",
  lines: [
    line(completeDish, 2, { modifiers: [extraSauce] }),
    line(lowMarginDish, 1),
    line(incompleteDish, 1),
    line(noRecipeDish, 1),
    line(verifiedWater, 3),
    line(unverifiedSoda, 2),
    line(completeDish, 5, { voided: true }),
  ],
  subtotalUgx: 50_500,
  totalUgx: 50_500,
  cashPaidUgx: 50_500,
  debtUgx: 0,
  estimatedProfitUgx: 0,
  createdAt: "2026-06-02T12:00:00.000Z",
  pendingSync: false,
};

const outsideRangeSale: Sale = {
  ...sale,
  id: "sale-outside",
  lines: [line(completeDish, 9)],
  subtotalUgx: 90_000,
  totalUgx: 90_000,
  cashPaidUgx: 90_000,
  createdAt: "2026-05-01T12:00:00.000Z",
};

describe("hospitality menu report", () => {
  const report = computeHospitalityReports(
    [sale, outsideRangeSale],
    products,
    { fromKey: "2026-06-02", toKey: "2026-06-02" },
    {},
  );

  it("counts menu items by honest cost confidence", () => {
    expect(report.menu.menuItemCount).toBe(7);
    expect(report.menu.reliableCostCount).toBe(4);
    expect(report.menu.needsCostCount).toBe(2);
    expect(report.menu.unverifiedCostCount).toBe(1);
  });

  it("ranks dishes and drinks from completed sales in the period only", () => {
    expect(report.completedBillCount).toBe(1);
    expect(report.totalRevenueUgx).toBe(50_500);
    expect(report.menu.topDishes.map((row) => row.productId)).toEqual([
      "complete",
      "low",
      "no-recipe",
      "incomplete",
    ]);
    expect(report.menu.topDishes[0]?.unitsSold).toBe(2);
    expect(report.menu.topDrinks.map((row) => row.productId)).toEqual(["water", "soda"]);
    expect(report.menu.topDrinks[0]?.unitsSold).toBe(3);
    expect(report.menu.topModifiers[0]).toEqual({
      optionLabel: "Extra sauce",
      groupLabel: "Extras",
      count: 2,
    });
  });

  it("exposes margin only where the cost is trustworthy", () => {
    const complete = report.menu.topDishes.find((row) => row.productId === "complete");
    expect(complete?.costStatus).toBe("estimated");
    expect(complete?.foodCostUgx).toBe(2_000);
    expect(complete?.marginPct).toBe(80);

    const incomplete = report.menu.topDishes.find((row) => row.productId === "incomplete");
    expect(incomplete?.costStatus).toBe("incomplete");
    expect(incomplete?.foodCostUgx).toBeNull();
    expect(incomplete?.marginPct).toBeNull();

    const noRecipe = report.menu.topDishes.find((row) => row.productId === "no-recipe");
    expect(noRecipe?.costStatus).toBe("not_set");
    expect(noRecipe?.marginPct).toBeNull();

    const soda = report.menu.topDrinks.find((row) => row.productId === "soda");
    expect(soda?.costStatus).toBe("unverified");
    expect(soda?.marginPct).toBeNull();
  });

  it("lists only low-margin items with a reliable cost that sold in the period", () => {
    expect(report.menu.lowMargin).toHaveLength(1);
    expect(report.menu.lowMargin[0]?.productId).toBe("low");
    expect(report.menu.lowMargin[0]?.marginPct).toBeCloseTo(20, 1);
    expect(report.menu.lowMargin.map((row) => row.productId)).not.toContain("unsold-low");
  });

  it("keeps cost coverage visible before the first sale", () => {
    const empty = computeHospitalityReports(
      [],
      products,
      { fromKey: "2026-06-02", toKey: "2026-06-02" },
      {},
    );
    expect(empty.completedBillCount).toBe(0);
    expect(empty.menu.menuItemCount).toBe(7);
    expect(empty.menu.reliableCostCount).toBe(4);
    expect(empty.menu.needsCostCount).toBe(2);
    expect(empty.menu.unverifiedCostCount).toBe(1);
    expect(empty.menu.topDishes).toEqual([]);
    expect(empty.menu.topDrinks).toEqual([]);
    expect(empty.menu.lowMargin).toEqual([]);
    expect(empty.menu.topModifiers).toEqual([]);
    expect(empty.menu.ingredientCostGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ingredientId: "spice", reason: "zero_cost" }),
        expect.objectContaining({ ingredientId: "ghost", reason: "missing" }),
      ]),
    );
  });

  it("aggregates zero-cost and missing ingredient gaps across dishes", () => {
    expect(report.menu.ingredientCostGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ingredientId: "spice",
          name: "Spice mix",
          dishCount: 1,
          reason: "zero_cost",
        }),
        expect.objectContaining({
          ingredientId: "ghost",
          dishCount: 1,
          reason: "missing",
        }),
      ]),
    );
  });

  it("reports an unassigned recipe line as a missing ingredient gap", () => {
    const blankDish = product({
      id: "blank",
      name: "Blank plate",
      menu: {
        productKind: "finished_menu",
        recipe: {
          yieldQty: 1,
          lines: [{ ingredientProductId: "", quantityBase: 1, unitLabel: "ea" }],
        },
      },
    });
    const blankReport = computeHospitalityReports(
      [],
      [blankDish],
      { fromKey: "2026-06-02", toKey: "2026-06-02" },
      {},
    );
    expect(blankReport.menu.ingredientCostGaps).toEqual([
      { ingredientId: "", name: "", unit: "", dishCount: 1, reason: "missing" },
    ]);
  });
});
