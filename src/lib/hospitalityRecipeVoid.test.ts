/**
 * Round 3 / P3 — reversing a recipe-driven sale (void line, void settled table bill, return).
 *
 * Batch-prepared dishes sell from finished portions that were cooked into PrepBatches. Every reversal
 * must hand the SAME portions back to the SAME batches (scaled for partial reversals, never twice),
 * and must never put raw ingredients back — they were consumed when the batch was prepared.
 * All flows run through the real store actions and the shared retail void/return engine.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { prepAllocationWindow } from "./recipeEngine";

const DISH_ID = "dish-1";
const ING_A_ID = "ing-a";
const ING_B_ID = "ing-b";
const DRINK_ID = "drink-1";

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

const ingA = baseProduct({ id: ING_A_ID, name: "Ingredient A", costPricePerUnitUgx: 1_000, baseUnit: "u", menu: { productKind: "ingredient" } });
const ingB = baseProduct({ id: ING_B_ID, name: "Ingredient B", costPricePerUnitUgx: 500, baseUnit: "u", menu: { productKind: "ingredient" } });
const drink = baseProduct({ id: DRINK_ID, name: "Soda", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 50, baseUnit: "bottle", category: "Drinks" });

function makeDish(): Product {
  return baseProduct({
    id: DISH_ID,
    name: "Dish",
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
  });
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

const product = (id: string) => usePosStore.getState().products.find((p) => p.id === id)!;
const dish = () => product(DISH_ID);
const batch = (id: string) => (dish().menu?.prepBatches ?? []).find((b) => b.id === id)!;
const batchPortions = () => (dish().menu?.prepBatches ?? []).reduce((n, b) => n + b.remainingPortions, 0);
const prepare = (portions: number, batchId: string) => usePosStore.getState().prepareMenuBatch({ productId: DISH_ID, portions, batchId });
const finalizeRetail = () => usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
const completedSale = () => usePosStore.getState().sales.find((s) => s.status === "completed")!;

function seedRetail(products: Product[]) {
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
    draftLines: [],
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

/** Two batches (7 + 20 portions), then sell 10 across them: 7 from batch-a + 3 from batch-b. */
function sellTenAcrossTwoBatches() {
  expect(prepare(7, "batch-a").ok).toBe(true);
  expect(prepare(20, "batch-b").ok).toBe(true);
  usePosStore.setState({ draftLines: [qtyLine(dish(), 10, "l1")] });
  expect(finalizeRetail().ok).toBe(true);
  return completedSale().id;
}

describe("prepAllocationWindow (pure)", () => {
  const alloc = [
    { batchId: "a", portions: 7 },
    { batchId: "b", portions: 3 },
  ];
  it("takes from the last-consumed batch backwards", () => {
    expect(prepAllocationWindow(alloc, 0, 2)).toEqual([{ batchId: "b", portions: 2 }]);
    expect(prepAllocationWindow(alloc, 0, 5)).toEqual([
      { batchId: "b", portions: 3 },
      { batchId: "a", portions: 2 },
    ]);
    expect(prepAllocationWindow(alloc, 0, 10)).toEqual([
      { batchId: "b", portions: 3 },
      { batchId: "a", portions: 7 },
    ]);
  });
  it("skips portions an earlier reversal already gave back", () => {
    expect(prepAllocationWindow(alloc, 2, 4)).toEqual([
      { batchId: "b", portions: 1 },
      { batchId: "a", portions: 3 },
    ]);
    // the remainder after a 4-portion return is exactly what is left to give back
    expect(prepAllocationWindow(alloc, 4, 6)).toEqual([{ batchId: "a", portions: 6 }]);
  });
  it("never credits more than the allocation", () => {
    const total = (w: Array<{ portions: number }>) => w.reduce((n, x) => n + x.portions, 0);
    expect(total(prepAllocationWindow(alloc, 0, 99))).toBe(10);
    expect(total(prepAllocationWindow(alloc, 9, 99))).toBe(1);
    expect(prepAllocationWindow(alloc, 10, 5)).toEqual([]);
  });
});

describe("batch-prepared dish: voiding a line", () => {
  beforeEach(() => {
    seedRetail([{ ...ingA }, { ...ingB }, { ...drink }, makeDish()]);
  });

  it("returns the exact portions to the exact PrepBatches, never the raw ingredients", () => {
    const saleId = sellTenAcrossTwoBatches();
    const rawA = product(ING_A_ID).stockOnHand;
    const rawB = product(ING_B_ID).stockOnHand;
    expect(batch("batch-a").remainingPortions).toBe(0);
    expect(batch("batch-b").remainingPortions).toBe(17);

    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);

    expect(batch("batch-a").remainingPortions).toBe(7);
    expect(batch("batch-b").remainingPortions).toBe(20);
    expect(dish().stockOnHand).toBe(27);
    expect(batchPortions()).toBe(dish().stockOnHand); // finished stock and batch provenance reconcile
    expect(product(ING_A_ID).stockOnHand).toBe(rawA);
    expect(product(ING_B_ID).stockOnHand).toBe(rawB);
  });

  it("a second void of the same line credits nothing more", () => {
    const saleId = sellTenAcrossTwoBatches();
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    const before = batchPortions();
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(false);
    expect(batchPortions()).toBe(before);
    expect(dish().stockOnHand).toBe(27);
  });

  it("void after a partial return credits only the portions not already returned", () => {
    const saleId = sellTenAcrossTwoBatches();
    // return 4 portions of the 10: they come back from the LAST consumed batch first (3 → b, 1 → a)
    const ret = usePosStore.getState().returnProduct({
      saleId,
      productId: DISH_ID,
      quantity: 4,
      refundAmountUgx: 40_000,
      reason: "wrong_item",
      note: "n",
    });
    expect(ret.ok).toBe(true);
    expect(batch("batch-b").remainingPortions).toBe(20);
    expect(batch("batch-a").remainingPortions).toBe(1);
    expect(dish().stockOnHand).toBe(21);

    // voiding the line now reverses the remaining 6 portions — all from batch-a
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(batch("batch-a").remainingPortions).toBe(7);
    expect(batch("batch-b").remainingPortions).toBe(20);
    expect(dish().stockOnHand).toBe(27);
    expect(batchPortions()).toBe(27);
  });

  it("a partial return scales the allocation instead of dumping everything on one batch", () => {
    const saleId = sellTenAcrossTwoBatches();
    expect(
      usePosStore.getState().returnProduct({
        saleId,
        productId: DISH_ID,
        quantity: 2,
        refundAmountUgx: 20_000,
        reason: "wrong_item",
        note: "n",
      }).ok,
    ).toBe(true);
    expect(batch("batch-b").remainingPortions).toBe(19);
    expect(batch("batch-a").remainingPortions).toBe(0);
    expect(batchPortions()).toBe(dish().stockOnHand);
  });

  it("an ordinary (non-recipe) drink is restocked exactly as before", () => {
    usePosStore.setState({ draftLines: [qtyLine(drink, 3, "l1")] });
    expect(finalizeRetail().ok).toBe(true);
    const saleId = completedSale().id;
    expect(product(DRINK_ID).stockOnHand).toBe(47);
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(product(DRINK_ID).stockOnHand).toBe(50);
    expect(product(DRINK_ID).menu?.prepBatches).toBeUndefined();
  });

  it("a sale that predates prepAllocation falls back to the newest open batch", () => {
    expect(prepare(20, "old-batch").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 5, "l1")] });
    expect(finalizeRetail().ok).toBe(true);
    const saleId = completedSale().id;
    usePosStore.setState((s) => ({
      sales: s.sales.map((x) => (x.id === saleId ? { ...x, lines: x.lines.map((l) => ({ ...l, prepAllocation: null })) } : x)),
    }));
    expect(batch("old-batch").remainingPortions).toBe(15);
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(batch("old-batch").remainingPortions).toBe(20);
    expect(dish().stockOnHand).toBe(20);
  });
});

describe("batch-prepared dish: voiding a settled table bill (shared whole-bill void)", () => {
  function settleTableWithDish(portions: number) {
    usePosStore.setState({
      _hydrated: true,
      sessionActor: { userId: "local:owner", role: "owner", displayName: "Owner" },
      products: [{ ...ingA }, { ...ingB }, { ...drink }, makeDish()],
      sales: [],
      stockMovements: [],
      voidRecords: [],
      returnRecords: [],
      auditLogs: [],
      dayCloses: [],
      draftLines: [],
      draftCartDiscountUgx: 0,
      activePendingSaleId: null,
      preferences: {
        ...usePosStore.getState().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityManualKitchenFire: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
      },
    });
    openTestShift();
    expect(prepare(7, "batch-a").ok).toBe(true);
    expect(prepare(20, "batch-b").ok).toBe(true);
    const floor = usePosStore.getState().preferences.hospitalityFloor!;
    const opened = usePosStore.getState().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
    expect(opened.ok).toBe(true);
    const sessionId = (opened as { sessionId: string }).sessionId;
    const added = usePosStore.getState().addHospitalityDraftLine({ product: dish(), quantity: portions });
    expect(added.ok).toBe(true);
    usePosStore.getState().addHospitalityDraftLine({ product: drink, quantity: 2 });
    usePosStore.getState().saveTableBill();
    usePosStore.getState().recordTableBillPayment({ method: "cash", amountUgx: portions * 10_000 + 4_000 });
    const res = usePosStore.getState().finalizeTableBill();
    expect(res.ok).toBe(true);
    return { saleId: (res as { saleId: string }).saleId, sessionId };
  }

  it("restores the exact batches, leaves raw ingredients alone and cannot be replayed", () => {
    const { saleId, sessionId } = settleTableWithDish(10);
    const rawA = product(ING_A_ID).stockOnHand;
    const rawB = product(ING_B_ID).stockOnHand;
    expect(batch("batch-a").remainingPortions).toBe(0);
    expect(batch("batch-b").remainingPortions).toBe(17);
    expect(product(DRINK_ID).stockOnHand).toBe(48);

    expect(usePosStore.getState().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);

    expect(batch("batch-a").remainingPortions).toBe(7);
    expect(batch("batch-b").remainingPortions).toBe(20);
    expect(dish().stockOnHand).toBe(27);
    expect(batchPortions()).toBe(27);
    expect(product(DRINK_ID).stockOnHand).toBe(50);
    expect(product(ING_A_ID).stockOnHand).toBe(rawA);
    expect(product(ING_B_ID).stockOnHand).toBe(rawB);
    expect(usePosStore.getState().sales.find((s) => s.id === saleId)!.lines.find((l) => l.productId === DISH_ID)!.prepAllocation).toEqual([
      { batchId: "batch-a", portions: 7 },
      { batchId: "batch-b", portions: 3 },
    ]);

    // replay: refused, nothing credited twice
    expect(usePosStore.getState().voidSettledTableBill({ sessionId, reason: "again", managerPin: "" }).ok).toBe(false);
    expect(batchPortions()).toBe(27);
    expect(dish().stockOnHand).toBe(27);
  });
});

describe("made-to-order recipe dish (resolved in Round 4 — see hospitalityMadeToOrderVoid.test.ts)", () => {
  it("void returns the ingredients the line consumed and creates no finished-dish stock", () => {
    const burger = baseProduct({
      id: "burger",
      name: "Burger",
      costPricePerUnitUgx: 0,
      stockOnHand: 0,
      baseUnit: "pcs",
      menu: {
        productKind: "finished_menu",
        prepMode: "made_to_order",
        recipe: { yieldQty: 1, lines: [{ ingredientProductId: ING_A_ID, quantityBase: 2, unitLabel: "u" }] },
        modifierGroups: [],
        variants: [],
      },
    });
    seedRetail([{ ...ingA }, burger]);
    usePosStore.setState({ draftLines: [qtyLine(burger, 2, "l1")] });
    expect(finalizeRetail().ok).toBe(true);
    expect(product(ING_A_ID).stockOnHand).toBe(96);
    expect(product("burger").stockOnHand).toBe(0);
    const saleId = completedSale().id;
    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(product(ING_A_ID).stockOnHand).toBe(100);
    expect(product("burger").stockOnHand).toBe(0);
  });
});
