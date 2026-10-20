import { describe, expect, it } from "vitest";
import type { PrepBatch, Product, Sale, SaleLine, SaleLineModifier } from "../types";
import { computeHospitalityReports, hospitalityMenuMarginLabel } from "./hospitalityReports";

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

type LineSnapshot = {
  unitCostUgx?: number;
  cogsUgx?: number;
  netRevenueUgx?: number;
  grossProfitUgx?: number;
  estimatedProfitUgx?: number;
  financialDataStatus?: SaleLine["financialDataStatus"];
};

function line(
  p: Product,
  quantity: number,
  opts?: { voided?: boolean; modifiers?: SaleLineModifier[]; snapshot?: LineSnapshot },
): SaleLine {
  const snapshot = opts?.snapshot;
  return {
    productId: p.id,
    name: p.name,
    inputMode: "quantity",
    quantity,
    unitPriceUgx: p.sellingPricePerUnitUgx,
    unitCostUgx: snapshot?.unitCostUgx ?? 0,
    lineTotalUgx: Math.round(p.sellingPricePerUnitUgx * quantity),
    estimatedProfitUgx: snapshot?.estimatedProfitUgx ?? 0,
    ...(snapshot?.cogsUgx !== undefined ? { cogsUgx: snapshot.cogsUgx } : {}),
    ...(snapshot?.netRevenueUgx !== undefined ? { netRevenueUgx: snapshot.netRevenueUgx } : {}),
    ...(snapshot?.grossProfitUgx !== undefined ? { grossProfitUgx: snapshot.grossProfitUgx } : {}),
    ...(snapshot?.financialDataStatus ? { financialDataStatus: snapshot.financialDataStatus } : {}),
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

  it("exposes current-cost estimates only where the cost is trustworthy", () => {
    const complete = report.menu.topDishes.find((row) => row.productId === "complete");
    expect(complete?.costStatus).toBe("estimated");
    expect(complete?.currentCostUgx).toBe(2_000);
    expect(complete?.currentMarginPct).toBe(80);
    expect(complete?.realized).toBeNull();

    const incomplete = report.menu.topDishes.find((row) => row.productId === "incomplete");
    expect(incomplete?.costStatus).toBe("incomplete");
    expect(incomplete?.currentCostUgx).toBeNull();
    expect(incomplete?.currentMarginPct).toBeNull();

    const noRecipe = report.menu.topDishes.find((row) => row.productId === "no-recipe");
    expect(noRecipe?.costStatus).toBe("not_set");
    expect(noRecipe?.currentMarginPct).toBeNull();

    const soda = report.menu.topDrinks.find((row) => row.productId === "soda");
    expect(soda?.costStatus).toBe("unverified");
    expect(soda?.currentMarginPct).toBeNull();
  });

  it("falls back to a current-cost estimate for sold low-margin items without a snapshot", () => {
    expect(report.menu.lowMargin).toHaveLength(1);
    expect(report.menu.lowMargin[0]?.productId).toBe("low");
    expect(report.menu.lowMargin[0]?.currentMarginPct).toBeCloseTo(20, 1);
    expect(report.menu.lowMargin[0]?.realized).toBeNull();
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

describe("historical menu margins", () => {
  const historyCurrent = product({
    id: "history-current",
    name: "History current",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 1,
        lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
      },
    },
  });
  const historyPartial = product({
    id: "history-partial",
    name: "History partial",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 1,
        lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
      },
    },
  });
  const historyLegacy = product({
    id: "history-legacy",
    name: "History legacy",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 1,
        lines: [{ ingredientProductId: "chicken", quantityBase: 1, unitLabel: "kg" }],
      },
    },
  });
  const historyIncomplete = product({
    id: "history-incomplete",
    name: "History incomplete",
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
  const historyNoRecipe = product({
    id: "history-no-recipe",
    name: "History no recipe",
    sellingPricePerUnitUgx: 7_000,
    menu: { productKind: "finished_menu", recipe: null },
  });

  const historyProducts = [
    chicken,
    spice,
    historyCurrent,
    historyPartial,
    historyLegacy,
    historyIncomplete,
    historyNoRecipe,
  ];

  const historySale: Sale = {
    id: "history-sale",
    status: "completed",
    lines: [
      line(historyCurrent, 1, {
        snapshot: {
          unitCostUgx: 7_500,
          cogsUgx: 7_500,
          netRevenueUgx: 10_000,
          grossProfitUgx: 2_500,
          estimatedProfitUgx: 2_500,
          financialDataStatus: "complete",
        },
      }),
      line(historyPartial, 1, {
        snapshot: { unitCostUgx: 6_000, estimatedProfitUgx: 4_000 },
      }),
      line(historyLegacy, 1, { snapshot: { financialDataStatus: "legacy" } }),
      line(historyIncomplete, 1, {
        snapshot: {
          unitCostUgx: 2_000,
          cogsUgx: 2_000,
          netRevenueUgx: 5_000,
          grossProfitUgx: 3_000,
          estimatedProfitUgx: 3_000,
          financialDataStatus: "complete",
        },
      }),
      line(historyNoRecipe, 1, { snapshot: { financialDataStatus: "legacy" } }),
    ],
    subtotalUgx: 42_000,
    totalUgx: 42_000,
    cashPaidUgx: 42_000,
    debtUgx: 0,
    estimatedProfitUgx: 9_500,
    createdAt: "2026-06-02T12:00:00.000Z",
    pendingSync: false,
  };

  const report = computeHospitalityReports(
    [historySale],
    historyProducts,
    { fromKey: "2026-06-02", toKey: "2026-06-02" },
    {},
  );
  const dish = (id: string) => report.menu.topDishes.find((row) => row.productId === id);

  it("uses the sale-time snapshot instead of the current product cost", () => {
    const current = dish("history-current");
    expect(current?.currentMarginPct).toBe(20);
    expect(current?.realized).toMatchObject({
      basis: "complete",
      revenueUgx: 10_000,
      costUgx: 7_500,
      profitUgx: 2_500,
      marginPct: 25,
      snapshotLineCount: 1,
      missingSnapshotLineCount: 0,
    });
  });

  it("supports old lines that carry only a sale-time unit cost", () => {
    const partial = dish("history-partial");
    expect(partial?.currentMarginPct).toBe(20);
    expect(partial?.realized).toMatchObject({
      basis: "partial",
      revenueUgx: 10_000,
      costUgx: 6_000,
      profitUgx: 4_000,
      marginPct: 40,
    });
  });

  it("does not invent a realized margin when the snapshot is missing", () => {
    const legacy = dish("history-legacy");
    expect(legacy?.realized).toBeNull();
    expect(legacy?.currentMarginPct).toBe(20);
    expect(legacy?.soldLineCount).toBe(1);

    const noRecipe = dish("history-no-recipe");
    expect(noRecipe?.realized).toBeNull();
    expect(noRecipe?.currentMarginPct).toBeNull();
    expect(noRecipe?.soldLineCount).toBe(1);
  });

  it("keeps a realized margin when the current menu cost is incomplete", () => {
    const incomplete = dish("history-incomplete");
    expect(incomplete?.currentMarginPct).toBeNull();
    expect(incomplete?.realized?.marginPct).toBe(60);
  });

  it("ranks low margin by realized margin first and labels estimate fallbacks", () => {
    expect(report.menu.lowMargin.map((row) => row.productId)).toEqual([
      "history-legacy",
      "history-current",
    ]);
    const legacy = report.menu.lowMargin.find((row) => row.productId === "history-legacy");
    expect(legacy?.realized).toBeNull();
    expect(legacy?.currentMarginPct).toBe(20);
    const current = report.menu.lowMargin.find((row) => row.productId === "history-current");
    expect(current?.realized?.marginPct).toBe(25);
  });

  it("labels each margin basis consistently for the UI and export", () => {
    expect(hospitalityMenuMarginLabel("en", dish("history-current")!)).toBe("Sold margin 25%");
    expect(hospitalityMenuMarginLabel("en", dish("history-partial")!)).toBe(
      "Sold margin (partial) 40%",
    );
    expect(hospitalityMenuMarginLabel("en", dish("history-legacy")!)).toBe(
      "Est. margin (current cost) 20%",
    );
    expect(hospitalityMenuMarginLabel("en", dish("history-no-recipe")!)).toBe(
      "Margin unavailable",
    );
  });
});

describe("ingredient demand", () => {
  const demandRice = product({
    id: "demand-rice",
    name: "Rice",
    category: "Ingredients",
    baseUnit: "kg",
    costPricePerUnitUgx: 4_000,
    costSource: "manual",
    menu: { productKind: "ingredient" },
  });
  const demandChicken = product({
    id: "demand-chicken",
    name: "Chicken",
    category: "Ingredients",
    baseUnit: "kg",
    costPricePerUnitUgx: 8_000,
    costSource: "purchase",
    menu: { productKind: "ingredient" },
  });
  const demandSpice = product({
    id: "demand-spice",
    name: "Spice mix",
    category: "Ingredients",
    baseUnit: "kg",
    costPricePerUnitUgx: 0,
    costSource: null,
    menu: { productKind: "ingredient" },
  });
  const demandOil = product({
    id: "demand-oil",
    name: "Untrusted oil",
    category: "Ingredients",
    baseUnit: "litre",
    costPricePerUnitUgx: 5_000,
    costSource: "quick_add_default",
    menu: { productKind: "ingredient" },
  });
  const demandDishA = product({
    id: "demand-dish-a",
    name: "Dish A",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 4,
        lines: [
          { ingredientProductId: "demand-rice", quantityBase: 1, unitLabel: "kg" },
          { ingredientProductId: "demand-chicken", quantityBase: 0.5, unitLabel: "kg" },
        ],
      },
    },
  });
  const demandDishB = product({
    id: "demand-dish-b",
    name: "Dish B",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 1,
        lines: [
          { ingredientProductId: "demand-rice", quantityBase: 0.2, unitLabel: "kg" },
          { ingredientProductId: "demand-spice", quantityBase: 0.1, unitLabel: "kg" },
          { ingredientProductId: "demand-oil", quantityBase: 0.5, unitLabel: "litre" },
        ],
      },
    },
  });
  const demandNoRecipe = product({
    id: "demand-no-recipe",
    name: "No recipe plate",
    category: "Food",
    menu: { productKind: "finished_menu", recipe: null },
  });
  const demandMissing = product({
    id: "demand-missing",
    name: "Missing ingredient plate",
    menu: {
      productKind: "finished_menu",
      recipe: {
        yieldQty: 1,
        lines: [{ ingredientProductId: "ghost", quantityBase: 1, unitLabel: "kg" }],
      },
    },
  });
  const demandDrink = product({
    id: "demand-drink",
    name: "Drink",
    category: "Drinks",
    baseUnit: "bottle",
    menu: { productKind: "retail" },
  });
  const demandProducts = [
    demandRice,
    demandChicken,
    demandSpice,
    demandOil,
    demandDishA,
    demandDishB,
    demandNoRecipe,
    demandMissing,
    demandDrink,
  ];

  function demandSale(
    id: string,
    createdAt: string,
    lines: SaleLine[],
    status: Sale["status"] = "completed",
  ): Sale {
    const total = lines.reduce((sum, row) => sum + row.lineTotalUgx, 0);
    return {
      id,
      status,
      lines,
      subtotalUgx: total,
      totalUgx: total,
      cashPaidUgx: total,
      debtUgx: 0,
      estimatedProfitUgx: 0,
      createdAt,
      pendingSync: false,
    };
  }

  const saleOne = demandSale("demand-sale-1", "2026-06-02T12:00:00.000Z", [
    line(demandDishA, 2),
    line(demandDishB, 1),
    line(demandDrink, 1),
  ]);
  const saleTwo = demandSale("demand-sale-2", "2026-06-03T12:00:00.000Z", [
    line(demandDishA, 2),
    line(demandDishB, 1),
    line(demandNoRecipe, 1),
    line(demandMissing, 1),
    line(demandDishA, 5, { voided: true }),
  ]);
  const pending = demandSale("demand-pending", "2026-06-02T12:00:00.000Z", [
    line(demandDishA, 100),
  ], "pending");
  const cancelled = demandSale("demand-cancelled", "2026-06-02T12:00:00.000Z", [
    line(demandDishA, 100),
  ], "cancelled");
  const outside = demandSale("demand-outside", "2026-05-01T12:00:00.000Z", [
    line(demandDishA, 100),
  ]);

  const report = computeHospitalityReports(
    [saleOne, saleTwo, pending, cancelled, outside],
    demandProducts,
    { fromKey: "2026-06-02", toKey: "2026-06-03" },
    {},
  );
  const demand = report.menu.ingredientDemand;
  const row = (ingredientId: string) =>
    demand.rows.find((entry) => entry.ingredientId === ingredientId);

  it("aggregates multiple completed sales and respects recipe yield", () => {
    expect(row("demand-rice")?.quantityBase).toBeCloseTo(1.4, 6);
    expect(row("demand-chicken")?.quantityBase).toBeCloseTo(0.5, 6);
    expect(row("demand-spice")?.quantityBase).toBeCloseTo(0.2, 6);
    expect(row("demand-oil")?.quantityBase).toBeCloseTo(1, 6);
    expect(row("demand-rice")?.unit).toBe("kg");
    expect(row("demand-oil")?.unit).toBe("litre");
    expect(row("demand-drink")).toBeUndefined();
  });

  it("excludes voided lines and non-completed or out-of-range sales", () => {
    // 2 + 2 completed units of Dish A, not the voided 5 or the 100-unit
    // pending/cancelled/out-of-range sales.
    expect(report.menu.ingredientDemand.rows.find((entry) => entry.ingredientId === "demand-rice")
      ?.quantityBase).toBeCloseTo(1.4, 6);
  });

  it("reports missing ingredients and dishes with no recipe", () => {
    expect(demand.missingIngredients).toEqual([
      { ingredientId: "ghost", unit: "kg", quantityBase: 1, dishCount: 1 },
    ]);
    expect(demand.noRecipeDishes).toEqual([
      {
        productId: "demand-no-recipe",
        name: "No recipe plate",
        unitsSold: 1,
        reason: "no_recipe",
      },
    ]);
  });

  it("only estimates UGX for trusted current ingredient costs", () => {
    expect(row("demand-rice")).toMatchObject({
      estimatedCostUgx: 5_600,
      costStatus: "trusted",
      dishCount: 2,
    });
    expect(row("demand-chicken")).toMatchObject({
      estimatedCostUgx: 4_000,
      costStatus: "trusted",
      dishCount: 1,
    });
    expect(row("demand-spice")).toMatchObject({
      estimatedCostUgx: null,
      costStatus: "unavailable",
    });
    expect(row("demand-oil")).toMatchObject({
      estimatedCostUgx: null,
      costStatus: "unavailable",
    });
  });
});

describe("prep batch production report", () => {
  const range = { fromKey: "2026-06-02", toKey: "2026-06-03" };

  function batch(partial: Partial<PrepBatch> & Pick<PrepBatch, "id" | "preparedAt">): PrepBatch {
    return {
      menuProductId: "batch-dish",
      portionsPrepared: 0,
      remainingPortions: 0,
      unitCostUgx: 0,
      status: "active",
      createdAt: partial.preparedAt,
      updatedAt: partial.preparedAt,
      ...partial,
    };
  }

  const batchDish = product({
    id: "batch-dish",
    name: "Batch chicken plate",
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      prepBatches: [
        batch({
          id: "actual-yield",
          preparedAt: "2026-06-02T10:00:00.000Z",
          portionsPrepared: 18,
          remainingPortions: 14,
          unitCostUgx: 2_780,
          expectedPortions: 20,
          actualPortions: 18,
          yieldBasis: "actual",
          costBasis: "recipe_estimate",
          ingredientCostUgx: 55_600,
          additionalCostUgx: 17_000,
          totalCostUgx: 72_600,
          batchCostPerPlateUgx: 4_033,
          wastedPortions: 2,
          wasteCostUgx: 8_066,
        }),
        batch({
          id: "unknown-yield",
          preparedAt: "2026-06-03T10:00:00.000Z",
          portionsPrepared: 20,
          remainingPortions: 20,
          unitCostUgx: 2_780,
          expectedPortions: 20,
          actualPortions: null,
          yieldBasis: "estimated",
          costBasis: "recipe_estimate",
          ingredientCostUgx: 55_600,
          additionalCostUgx: 0,
          totalCostUgx: 55_600,
          batchCostPerPlateUgx: 2_780,
        }),
        batch({
          id: "legacy",
          preparedAt: "2026-06-03T12:00:00.000Z",
          portionsPrepared: 10,
          remainingPortions: 5,
          unitCostUgx: 2_780,
          wastedPortions: 1,
        }),
        batch({
          id: "outside-range",
          preparedAt: "2026-05-01T10:00:00.000Z",
          portionsPrepared: 99,
          remainingPortions: 99,
          unitCostUgx: 1_000,
        }),
        batch({
          id: "undated",
          preparedAt: "not-a-date",
          portionsPrepared: 5,
          remainingPortions: 5,
          unitCostUgx: 1_000,
        }),
      ],
    },
  });

  const report = computeHospitalityReports([], [batchDish], range).prepBatches;

  it("filters by preparedAt and reports undated/outside-range evidence separately", () => {
    expect(report.rows.map((row) => row.batchId)).toEqual([
      "actual-yield",
      "unknown-yield",
      "legacy",
    ]);
    expect(report.undatedBatchCount).toBe(1);
    expect(report.outsideRangeBatchCount).toBe(1);
    expect(report.historyScope).toBe("persisted_batches_only");
  });

  it("shows yield variance only when both expected and actual are recorded", () => {
    const actual = report.rows[0]!;
    expect(actual).toMatchObject({
      expectedPortions: 20,
      actualPortions: 18,
      yieldVariancePortions: -2,
      yieldBasis: "actual",
    });

    const unknown = report.rows[1]!;
    expect(unknown.expectedPortions).toBe(20);
    expect(unknown.actualPortions).toBeNull();
    expect(unknown.yieldVariancePortions).toBeNull();

    expect(report.yieldMeasuredBatchCount).toBe(1);
    expect(report.expectedPortions).toBe(20);
    expect(report.actualPortions).toBe(18);
    expect(report.yieldVariancePortions).toBe(-2);
  });

  it("values waste and remaining portions at the frozen cost basis", () => {
    expect(report.rows[0]).toMatchObject({
      costPerPlateUgx: 4_033,
      totalBatchCostUgx: 72_600,
      wastedPortions: 2,
      wasteValueUgx: 8_066,
      remainingPortions: 14,
      remainingValueUgx: 56_462,
      legacyCost: false,
    });
    expect(report.wastedPortions).toBe(3);
    expect(report.wasteValueUgx).toBe(10_846);
    expect(report.remainingPortions).toBe(39);
    expect(report.remainingValueUgx).toBe(125_962);
  });

  it("uses a legacy batch's recorded ingredient-only cost", () => {
    const legacy = report.rows[2]!;
    expect(legacy).toMatchObject({
      expectedPortions: null,
      actualPortions: null,
      yieldVariancePortions: null,
      costPerPlateUgx: 2_780,
      totalBatchCostUgx: 27_800,
      wastedPortions: 1,
      wasteValueUgx: 2_780,
      remainingPortions: 5,
      remainingValueUgx: 13_900,
      legacyCost: true,
    });
    expect(report.legacyBatchCount).toBe(1);
  });

  it("keeps historical production totals separate from current remaining stock", () => {
    expect(report.portionsPrepared).toBe(48); // 18 + 20 + 10, historical
    expect(report.remainingPortions).toBe(39); // 14 + 20 + 5, current
    expect(report.totalBatchCostUgx).toBe(156_000);
    expect(report.remainingValueUgx).toBe(125_962);
  });

  it("reports only persisted batches and never infers pruned or missing history", () => {
    const empty = computeHospitalityReports(
      [],
      [
        product({
          id: "empty-dish",
          name: "Empty dish",
          menu: { productKind: "finished_menu", prepMode: "batch_prepared", prepBatches: [] },
        }),
        product({ id: "no-menu", name: "No menu product" }),
      ],
      range,
    ).prepBatches;

    expect(empty.rows).toEqual([]);
    expect(empty.batchCount).toBe(0);
    expect(empty.totalBatchCostUgx).toBe(0);
    expect(empty.remainingPortions).toBe(0);
    expect(empty.historyScope).toBe("persisted_batches_only");
  });
});
