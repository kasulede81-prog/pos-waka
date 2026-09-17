/**
 * Phase 5.1 — prep provenance hardening (recipe snapshot, batch allocation,
 * exact void restoration). All flows run through the real store actions and
 * the real retail engine. Test matrix A–Q from the Phase 5.1 spec.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import { reconcileRecoveryInventoryLedger } from "./recoveryInventoryReconciliation";

const DISH_ID = "dish-1";
const DRINK_ID = "drink-1";
const ING_A_ID = "ing-a";
const ING_B_ID = "ing-b";

function baseProduct(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 100,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-09-17T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const ingA = baseProduct({ id: ING_A_ID, name: "Ingredient A", costPricePerUnitUgx: 1_000, stockOnHand: 100, baseUnit: "u", menu: { productKind: "ingredient" } });
const ingB = baseProduct({ id: ING_B_ID, name: "Ingredient B", costPricePerUnitUgx: 500, stockOnHand: 100, baseUnit: "u", menu: { productKind: "ingredient" } });
const drink = baseProduct({ id: DRINK_ID, name: "Soda", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 50, baseUnit: "bottle", category: "Drinks" });

/** Recipe v1: per 20 portions → A 40 units, B 20 units (per portion: A 2, B 1). Cost/portion = 2×1,000 + 1×500 = 2,500. */
function makeDish(overrides?: Partial<Product>): Product {
  return baseProduct({
    id: DISH_ID,
    name: "Dish",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    baseUnit: "portion",
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      recipe: {
        yieldQty: 20,
        lines: [
          { ingredientProductId: ING_A_ID, quantityBase: 40, unitLabel: "u" },
          { ingredientProductId: ING_B_ID, quantityBase: 20, unitLabel: "u" },
        ],
      },
      modifierGroups: [],
      variants: [],
    },
    ...overrides,
  });
}

/** Recipe v2: per 20 portions → A 60 units, B 20 units (per portion: A 3, B 1). */
function makeDishV2(): Product {
  const d = makeDish();
  return {
    ...d,
    menu: {
      ...d.menu!,
      recipe: {
        yieldQty: 20,
        lines: [
          { ingredientProductId: ING_A_ID, quantityBase: 60, unitLabel: "u" },
          { ingredientProductId: ING_B_ID, quantityBase: 20, unitLabel: "u" },
        ],
      },
    },
  };
}

function qtyLine(p: Product, quantity: number, id: string): SaleLine {
  return {
    id,
    productId: p.id,
    name: p.name,
    inputMode: "quantity",
    quantity,
    unitPriceUgx: p.sellingPricePerUnitUgx,
    unitCostUgx: p.costPricePerUnitUgx,
    lineTotalUgx: p.sellingPricePerUnitUgx * quantity,
    estimatedProfitUgx: (p.sellingPricePerUnitUgx - p.costPricePerUnitUgx) * quantity,
    updatedAt: "2026-09-17T08:05:00.000Z",
  };
}

function seed(products: Product[], lines: SaleLine[] = []) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products,
    customers: [],
    sales: [],
    stockMovements: [],
    archivedStockMovements: [],
    voidRecords: [],
    archivedVoidRecords: [],
    returnRecords: [],
    archivedReturnRecords: [],
    auditLogs: [],
    archivedAuditLogs: [],
    draftLines: lines,
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftInput: null,
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
    draftPaymentMethod: "cash",
  });
  expect(openTestShift().ok).toBe(true);
}

const product = (id: string) => usePosStore.getState().products.find((p) => p.id === id)!;
const dish = () => product(DISH_ID);
const batch = (id: string) => (dish().menu?.prepBatches ?? []).find((b) => b.id === id)!;
const finalize = () => usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
const prepare = (portions: number, batchId: string) =>
  usePosStore.getState().prepareMenuBatch({ productId: DISH_ID, portions, batchId });

const OPENING = { [ING_A_ID]: 100, [ING_B_ID]: 100, [DISH_ID]: 0, [DRINK_ID]: 50 };

describe("Phase 5.1 prep provenance", () => {
  beforeEach(() => {
    seed([{ ...ingA }, { ...ingB }, { ...drink }, makeDish()]);
  });

  // A–D — recipe snapshot: cancel restores prep-time quantities, not today's recipe.
  it("A–D: cancel after recipe change restores exactly the preparation-time quantities", () => {
    expect(prepare(20, "b1").ok).toBe(true);
    expect(batch("b1").recipeSnapshot).toEqual({
      yieldQty: 20,
      lines: [
        { ingredientProductId: ING_A_ID, quantityBase: 40, unitLabel: "u" },
        { ingredientProductId: ING_B_ID, quantityBase: 20, unitLabel: "u" },
      ],
    });
    expect(product(ING_A_ID).stockOnHand).toBe(60); // 100 − 40
    expect(product(ING_B_ID).stockOnHand).toBe(80); // 100 − 20

    // B — modify the recipe (A per portion 2 → 3), keeping prepared stock + batches.
    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === DISH_ID ? { ...p, menu: { ...p.menu!, recipe: makeDishV2().menu!.recipe } } : p,
      ),
    });

    // Sell 8 portions (consumes prepared stock only), then cancel remaining 12.
    usePosStore.setState({ draftLines: [qtyLine(dish(), 8, "l1")] });
    expect(finalize().ok).toBe(true);
    expect(usePosStore.getState().cancelPrepBatch({ batchId: "b1" }).ok).toBe(true);

    // D — restored per the SNAPSHOT (A 2/portion), not today's recipe (A 3/portion):
    // A = 100 − 40 + 24 = 84, B = 100 − 20 + 12 = 92.
    expect(product(ING_A_ID).stockOnHand).toBe(84);
    expect(product(ING_B_ID).stockOnHand).toBe(92);
    expect(dish().stockOnHand).toBe(0);
  });

  // E–F — multi-batch sale persists the exact allocation on the SaleLine.
  it("E–F: multi-batch sale freezes exact batch allocation on the SaleLine", () => {
    expect(prepare(7, "batch-a").ok).toBe(true);
    // Raise A cost so the two batches differ (A 2,500; B = 2×1,010 + 500 = 2,520).
    usePosStore.setState({ products: usePosStore.getState().products.map((p) => (p.id === ING_A_ID ? { ...p, costPricePerUnitUgx: 1_010 } : p)) });
    expect(prepare(20, "batch-b").ok).toBe(true);
    expect(batch("batch-b").unitCostUgx).toBe(2_520);

    usePosStore.setState({ draftLines: [qtyLine(dish(), 10, "l1")] });
    expect(finalize().ok).toBe(true);

    const sale = usePosStore.getState().sales.find((s) => s.status === "completed")!;
    const line = sale.lines.find((l) => l.productId === DISH_ID)!;
    // FIFO: 7 from A (all of it) + 3 from B.
    expect(line.prepAllocation).toEqual([
      { batchId: "batch-a", portions: 7 },
      { batchId: "batch-b", portions: 3 },
    ]);
    expect(batch("batch-a").status).toBe("depleted");
    expect(batch("batch-b").remainingPortions).toBe(17);
    expect(line.cogsUgx).toBe(7 * 2_500 + 3 * 2_520); // 25,060
  });

  // G–J — void restores each originating batch exactly; no raw ingredients; COGS stands.
  it("G–J: void of a multi-batch sale restores exact batch quantities", () => {
    expect(prepare(7, "batch-a").ok).toBe(true);
    usePosStore.setState({ products: usePosStore.getState().products.map((p) => (p.id === ING_A_ID ? { ...p, costPricePerUnitUgx: 1_010 } : p)) });
    expect(prepare(20, "batch-b").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 10, "l1")] });
    expect(finalize().ok).toBe(true);
    const saleId = usePosStore.getState().sales.find((s) => s.status === "completed")!.id;
    const movementCountBefore = usePosStore.getState().stockMovements.length;

    const voided = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" });
    expect(voided.ok).toBe(true);

    // H — each originating batch restored by its exact consumed quantity.
    expect(batch("batch-a").remainingPortions).toBe(7);
    expect(batch("batch-a").status).toBe("active");
    expect(batch("batch-b").remainingPortions).toBe(20);
    // Finished prepared stock restored exactly once (27 total again).
    expect(dish().stockOnHand).toBe(27);

    // I — raw ingredients NOT restored on void (still at prep-consumed levels:
    // both batches used the same recipe → 2 units of A per portion → 54 used).
    expect(product(ING_A_ID).stockOnHand).toBeCloseTo(46, 6);
    expect(product(ING_B_ID).stockOnHand).toBe(73);

    // J — historical SaleLine COGS unchanged.
    const sale = usePosStore.getState().sales.find((s) => s.id === saleId)!;
    expect(sale.lines[0]!.cogsUgx).toBe(25_060);
    expect(sale.estimatedProfitUgx).toBe(0); // void reduced sale profit via shared logic
    expect(sale.totalUgx).toBe(0);

    // No duplicate inventory movements from the void beyond the single shared one.
    const afterMoves = usePosStore.getState().stockMovements;
    expect(afterMoves.length).toBe(movementCountBefore + 1);
    expect(afterMoves.filter((m) => m.kind === "adjust_other" && m.refId === usePosStore.getState().voidRecords[0]!.id)).toHaveLength(1);
  });

  // K — batch cost immutability.
  it("K: batch unitCostUgx stays frozen after ingredient cost, recipe, product cost, and price changes", () => {
    expect(prepare(20, "b1").ok).toBe(true);
    expect(batch("b1").unitCostUgx).toBe(2_500);

    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === ING_A_ID
          ? { ...p, costPricePerUnitUgx: 9_999 }
          : p.id === DISH_ID
            ? {
                ...p,
                costPricePerUnitUgx: 7_777,
                sellingPricePerUnitUgx: 99_999,
                menu: { ...p.menu!, recipe: makeDishV2().menu!.recipe },
              }
            : p,
      ),
    });

    expect(batch("b1").unitCostUgx).toBe(2_500);
    // A NEW batch reflects the new world, but the old one never changes.
    expect(prepare(20, "b2").ok).toBe(true);
    expect(batch("b2").unitCostUgx).not.toBe(2_500);
  });

  // L — repeated void cannot restore twice.
  it("L: a second void of the same line is refused with no double restoration", () => {
    expect(prepare(20, "b1").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 5, "l1")] });
    expect(finalize().ok).toBe(true);
    const saleId = usePosStore.getState().sales.find((s) => s.status === "completed")!.id;

    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(dish().stockOnHand).toBe(20);
    expect(batch("b1").remainingPortions).toBe(20);

    const again = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" });
    expect(again.ok).toBe(false); // already voided — shared guard
    expect(dish().stockOnHand).toBe(20); // no double restore
    expect(batch("b1").remainingPortions).toBe(20);
  });

  // M — offline/retry: replaying a finalized sale's movement synthesis does not
  // duplicate batch provenance (stable ids; recovery merge is idempotent).
  it("M: recovery synthesis does not duplicate batch provenance or movements", () => {
    expect(prepare(20, "b1").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 4, "l1")] });
    expect(finalize().ok).toBe(true);
    const saleId = usePosStore.getState().sales.find((s) => s.status === "completed")!.id;

    const lineBefore = usePosStore.getState().sales.find((s) => s.id === saleId)!.lines[0]!;
    const movementsBefore = usePosStore.getState().stockMovements.length;
    const first = reconcileRecoveryInventoryLedger({ applyToStore: true });
    const movementsAfterFirst = usePosStore.getState().stockMovements.length;
    const second = reconcileRecoveryInventoryLedger({ applyToStore: true });

    expect(first.status).toBe("healthy");
    expect(second.status).toBe("healthy");
    // Replay adds no SALE movements: stable movement ids make synthesis idempotent.
    expect(first.syntheticSaleMovements).toBe(0);
    expect(second.syntheticSaleMovements).toBe(0);
    // The seeded stock has no inbound movements, so the FIRST pass also freezes
    // the pre-movement opening balances (ing-a, ing-b, drink) with stable ids —
    // by-design recovery behavior, not a sale/provenance synth. The replay adds nothing.
    expect(first.syntheticOpeningMovements).toBe(3);
    expect(second.syntheticOpeningMovements).toBe(0);
    expect(movementsAfterFirst).toBe(movementsBefore + 3);
    expect(usePosStore.getState().stockMovements.length).toBe(movementsAfterFirst);
    // The SaleLine allocation is untouched by replay.
    expect(usePosStore.getState().sales.find((s) => s.id === saleId)!.lines[0]!.prepAllocation).toEqual(lineBefore.prepAllocation);
    expect(batch("b1").remainingPortions).toBe(16);
  });

  // N–O — integrity suites stay clean.
  it("N–O: verifyInventoryIntegrity and recovery reconciliation remain clean", () => {
    expect(prepare(20, "b1").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 6, "l1"), qtyLine(drink, 2, "l2")] });
    expect(finalize().ok).toBe(true);
    expect(usePosStore.getState().voidSaleLine({ saleId: usePosStore.getState().sales.find((s) => s.status === "completed")!.id, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);

    const s = usePosStore.getState();
    const integrity = verifyInventoryIntegrity({
      products: s.products,
      movements: s.stockMovements,
      archivedMovements: s.archivedStockMovements,
      openingStockByProduct: OPENING,
    });
    expect(integrity.mismatches).toEqual([]);
    const report = reconcileRecoveryInventoryLedger({ applyToStore: false });
    expect(report.remainingMismatches).toEqual([]);
    expect(report.status).toBe("healthy");
  });

  // P–Q — retail behavior unchanged; combined food+drink stays one Sale.
  it("P–Q: drink retail path unchanged and combined sale is one WAKA Sale", () => {
    expect(prepare(20, "b1").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 1, "l1"), qtyLine(drink, 3, "l2")] });
    expect(finalize().ok).toBe(true);

    const sales = usePosStore.getState().sales.filter((s) => s.status === "completed");
    expect(sales).toHaveLength(1);
    const sale = sales[0]!;
    expect(sale.totalUgx).toBe(16_000);
    expect(product(DRINK_ID).stockOnHand).toBe(47);
    const drinkLine = sale.lines.find((l) => l.productId === DRINK_ID)!;
    expect(drinkLine.unitCostUgx).toBe(1_200);
    expect(drinkLine.prepAllocation ?? null).toBeNull(); // retail: no provenance
    const foodLine = sale.lines.find((l) => l.productId === DISH_ID)!;
    expect(foodLine.prepAllocation).toEqual([{ batchId: "b1", portions: 1 }]);
    const cogs = sale.lines.reduce((sum, l) => sum + (l.cogsUgx ?? 0), 0);
    expect(sale.estimatedProfitUgx).toBe(sale.totalUgx - cogs);
  });
});
