/**
 * Phase 5 — hospitality food preparation (prep batches) invariants.
 *
 * All flows run through the REAL store actions and the REAL retail engine:
 * - prepareMenuBatch / wastePreparedPortions / cancelPrepBatch
 * - finalizeDraftSale (single financial finalizer)
 *
 * Covers spec tests 1–25 (made-to-order unchanged, batch prep, ingredient
 * deduction, prep cost, prepared stock, batch creation, prepared sale, no
 * double consumption, FIFO, historical batch cost, food+drink one sale,
 * takeaway, waste, full/partial cancel, void, insufficient ingredients,
 * unbatched stock safety, offline/sync, idempotency, ledger + recovery
 * reconciliation).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { PrepBatch, Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";
import { reconcileRecoveryInventoryLedger } from "./recoveryInventoryReconciliation";

const DISH_ID = "dish-1";
const DRINK_ID = "drink-1";
const CHICKEN_ID = "chicken-1";
const POTATOES_ID = "potatoes-1";
const OIL_ID = "oil-1";

function baseProduct(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "pcs",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 20,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: "2026-09-17T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const chicken = baseProduct({
  id: CHICKEN_ID,
  name: "Chicken",
  costPricePerUnitUgx: 8_000,
  stockOnHand: 10,
  baseUnit: "kg",
  menu: { productKind: "ingredient" },
});

const potatoes = baseProduct({
  id: POTATOES_ID,
  name: "Potatoes",
  costPricePerUnitUgx: 2_000,
  stockOnHand: 20,
  baseUnit: "kg",
  menu: { productKind: "ingredient" },
});

const oil = baseProduct({
  id: OIL_ID,
  name: "Cooking Oil",
  costPricePerUnitUgx: 6_000,
  stockOnHand: 5,
  baseUnit: "L",
  menu: { productKind: "ingredient" },
});

const drink = baseProduct({
  id: DRINK_ID,
  name: "Coca-Cola",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 1_200,
  stockOnHand: 24,
  baseUnit: "bottle",
  category: "Drinks",
});

/**
 * Chicken + Chips — batch-prepared, yield 20 portions:
 * 5 kg chicken + 6 kg potatoes + 0.6 L oil → 20 portions.
 * Per portion: 0.25 kg (2,000) + 0.3 kg (600) + 0.03 L (180) = 2,780 UGX.
 */
function makeDish(prepMode: "made_to_order" | "batch_prepared" = "batch_prepared", overrides?: Partial<Product>): Product {
  return baseProduct({
    id: DISH_ID,
    name: "Chicken + Chips",
    sellingPricePerUnitUgx: 15_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    baseUnit: "portion",
    menu: {
      productKind: "finished_menu",
      prepMode,
      recipe: {
        yieldQty: 20,
        lines: [
          { ingredientProductId: CHICKEN_ID, quantityBase: 5, unitLabel: "kg" },
          { ingredientProductId: POTATOES_ID, quantityBase: 6, unitLabel: "kg" },
          { ingredientProductId: OIL_ID, quantityBase: 0.6, unitLabel: "L" },
        ],
      },
      modifierGroups: [],
      variants: [],
    },
    ...overrides,
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
const batches = () => (dish().menu?.prepBatches ?? []) as PrepBatch[];
const batch = (id: string) => batches().find((b) => b.id === id)!;

const OPENING = { [CHICKEN_ID]: 10, [POTATOES_ID]: 20, [OIL_ID]: 5, [DISH_ID]: 0, [DRINK_ID]: 24 };

function expectLedgerConsistent() {
  const s = usePosStore.getState();
  const result = verifyInventoryIntegrity({
    products: s.products,
    movements: s.stockMovements,
    archivedMovements: s.archivedStockMovements,
    openingStockByProduct: OPENING,
  });
  expect(result.mismatches).toEqual([]);
  expect(result.ok).toBe(true);
}

function prepare(portions: number, batchId?: string) {
  return usePosStore.getState().prepareMenuBatch({ productId: DISH_ID, portions, batchId });
}

function finalize() {
  return usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
}

describe("hospitality prep batches", () => {
  beforeEach(() => {
    seed([{ ...chicken }, { ...potatoes }, { ...oil }, { ...drink }, makeDish()]);
  });

  // Spec 1 — made-to-order mode keeps Phase 4 behavior; prep action refuses.
  it("made_to_order: prep is refused and sale deducts ingredients at sale time", () => {
    seed([{ ...chicken }, { ...potatoes }, { ...oil }, makeDish("made_to_order")], [qtyLine(makeDish("made_to_order"), 2, "l1")]);
    const prep = prepare(20);
    expect(prep.ok).toBe(false);
    expect(prep.errorKey).toBe("prepModeRequiresBatch");

    const res = finalize();
    expect(res.ok).toBe(true);
    expect(product(CHICKEN_ID).stockOnHand).toBeCloseTo(9.5, 6); // 2 × 0.25 kg
    expect(dish().stockOnHand).toBe(0);
    expect(batches()).toHaveLength(0);
  });

  // Spec 2–6 — batch preparation: deduction, cost, stock, batch record, no Sale.
  it("prepare 20 portions: ingredients deduct once, batch created, zero revenue", () => {
    const res = prepare(20, "batch-a");
    expect(res.ok).toBe(true);

    expect(product(CHICKEN_ID).stockOnHand).toBe(5); // −5 kg
    expect(product(POTATOES_ID).stockOnHand).toBe(14); // −6 kg
    expect(product(OIL_ID).stockOnHand).toBeCloseTo(4.4, 6); // −0.6 L
    expect(dish().stockOnHand).toBe(20);

    const b = batch("batch-a");
    expect(b.portionsPrepared).toBe(20);
    expect(b.remainingPortions).toBe(20);
    expect(b.status).toBe("active");
    expect(b.unitCostUgx).toBe(2_780); // frozen historical prep cost
    expect(b.pendingSync).toBe(true);

    // Invariants 1–2: preparation is NOT revenue/payment — no Sale exists.
    expect(usePosStore.getState().sales).toHaveLength(0);

    // Spec 3: audited adjust_use movements for ingredient consumption.
    const moves = usePosStore.getState().stockMovements.filter((m) => m.refId === "batch-a");
    expect(moves).toContainEqual(expect.objectContaining({ productId: CHICKEN_ID, kind: "adjust_use", deltaBaseUnits: -5 }));
    expect(moves).toContainEqual(expect.objectContaining({ productId: POTATOES_ID, kind: "adjust_use", deltaBaseUnits: -6 }));
    expect(moves.some((m) => m.productId === DISH_ID && m.deltaBaseUnits === 20)).toBe(true);

    expect(usePosStore.getState().auditLogs.some((a) => a.action === "hospitality_prep_batch")).toBe(true);
  });

  // Spec 18 — insufficient ingredients: prepare fails, nothing changes.
  it("insufficient ingredients block preparation with zero side effects", () => {
    const res = prepare(100); // needs 25 kg chicken, only 10 available
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("ingredientShortage");
    expect(product(CHICKEN_ID).stockOnHand).toBe(10);
    expect(dish().stockOnHand).toBe(0);
    expect(batches()).toHaveLength(0);
    expect(usePosStore.getState().stockMovements).toHaveLength(0);
    expect(usePosStore.getState().sales).toHaveLength(0);
  });

  // Spec 7–8 — prepared sale: one portion consumed once, no re-deduction of ingredients.
  it("selling a prepared portion deducts prepared stock only (no double consumption)", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    seed(
      usePosStore.getState().products,
      [],
    );
    usePosStore.setState({ draftLines: [qtyLine(dish(), 1, "l1")] });

    const res = finalize();
    expect(res.ok).toBe(true);

    expect(dish().stockOnHand).toBe(19);
    expect(batch("batch-a").remainingPortions).toBe(19);
    // Invariant 5: chicken stays at the preparation-consumed level (5 kg).
    expect(product(CHICKEN_ID).stockOnHand).toBe(5);

    const sale = usePosStore.getState().sales.find((s) => s.status === "completed")!;
    const line = sale.lines.find((l) => l.productId === DISH_ID)!;
    expect(line.unitCostUgx).toBe(2_780); // batch historical cost
    expect(line.cogsUgx).toBe(2_780);
    expect(line.estimatedProfitUgx).toBe(15_000 - 2_780);

    // Prepared-food sale: sale_out movement, NO ingredient movement for this sale.
    const saleMoves = usePosStore.getState().stockMovements.filter((m) => m.refId === sale.id);
    expect(saleMoves).toContainEqual(expect.objectContaining({ productId: DISH_ID, kind: "sale_out", deltaBaseUnits: -1 }));
    expect(saleMoves.some((m) => m.productId === CHICKEN_ID)).toBe(false);
  });

  // Spec 9–10 — FIFO across batches with different historical costs.
  it("FIFO batch consumption uses each batch's frozen historical cost", () => {
    expect(prepare(10, "batch-a").ok).toBe(true); // 2,780/portion
    // Supplier price rises before the second prep.
    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === CHICKEN_ID ? { ...p, costPricePerUnitUgx: 10_000 } : p,
      ),
    });
    expect(prepare(20, "batch-b").ok).toBe(true); // 0.25×10,000 + 600 + 180 = 3,280/portion

    usePosStore.setState({ draftLines: [qtyLine(dish(), 5, "l1")] });
    expect(finalize().ok).toBe(true);
    const firstSaleId = usePosStore.getState().sales.find((s) => s.status === "completed")!.id;
    expect(usePosStore.getState().sales.find((s) => s.id === firstSaleId)!.lines[0]!.unitCostUgx).toBe(2_780); // 5 × batch A
    expect(batch("batch-a").remainingPortions).toBe(5);
    expect(batch("batch-b").remainingPortions).toBe(20);

    usePosStore.setState({ draftLines: [qtyLine(dish(), 10, "l2")] });
    expect(finalize().ok).toBe(true);
    const secondSale = usePosStore.getState().sales.find((s) => s.id !== firstSaleId && s.status === "completed")!;
    const line = secondSale.lines.find((l) => l.productId === DISH_ID)!;
    expect(batch("batch-a").status).toBe("depleted");
    expect(batch("batch-b").remainingPortions).toBe(15);
    // 5 × 2,780 + 5 × 3,280 = 30,300 → weighted unit 3,030 (frozen on the line).
    expect(line.cogsUgx).toBe(30_300);
    expect(line.unitCostUgx).toBe(3_030);
    // Invariant 6: batch A cost stays 2,780 despite the price change.
    expect(batch("batch-a").unitCostUgx).toBe(2_780);
  });

  // Spec 11 + 8 + 9(combined) — food + drink in ONE authoritative Sale.
  it("food + drink combined sale: one Sale, retail drink behavior, reconciled totals", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 1, "l1"), qtyLine(drink, 1, "l2")] });

    const res = finalize();
    expect(res.ok).toBe(true);

    const sales = usePosStore.getState().sales.filter((s) => s.status === "completed");
    expect(sales).toHaveLength(1); // Invariant 9: one sale, no duplicates
    const sale = sales[0]!;
    expect(sale.totalUgx).toBe(17_000);
    const lineSum = sale.lines.reduce((sum, l) => sum + l.lineTotalUgx, 0);
    expect(sale.totalUgx).toBe(lineSum);
    const cogs = sale.lines.reduce((sum, l) => sum + (l.cogsUgx ?? 0), 0);
    expect(sale.estimatedProfitUgx).toBe(sale.totalUgx - cogs);

    // Invariant 8: drink behaves exactly like retail.
    expect(product(DRINK_ID).stockOnHand).toBe(23);
    const drinkLine = sale.lines.find((l) => l.productId === DRINK_ID)!;
    expect(drinkLine.unitCostUgx).toBe(1_200);
    expect(product(CHICKEN_ID).stockOnHand).toBe(5); // no double consumption
    // Spec 12 (takeaway): no table required, no table session attached.
    expect(sale.tableSessionId ?? null).toBeNull();
  });

  // Spec 14 — waste: stock and batch decrease, audited movement, no ingredient restore.
  it("wasting 2 portions: prepared stock 20→18, batch remaining 18, no Sale", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    const res = usePosStore.getState().wastePreparedPortions({ batchId: "batch-a", portions: 2, reason: "spoiled" });
    expect(res.ok).toBe(true);

    expect(dish().stockOnHand).toBe(18);
    expect(batch("batch-a").remainingPortions).toBe(18);
    expect(batch("batch-a").status).toBe("active");
    expect(product(CHICKEN_ID).stockOnHand).toBe(5); // ingredients NOT returned
    expect(usePosStore.getState().sales).toHaveLength(0);

    const move = usePosStore.getState().stockMovements.find((m) => m.kind === "adjust_damage" && m.refId === "batch-a");
    expect(move).toMatchObject({ productId: DISH_ID, deltaBaseUnits: -2 });
    expect(usePosStore.getState().auditLogs.some((a) => a.action === "hospitality_prep_waste")).toBe(true);

    // Wasting everything left marks the batch wasted.
    expect(usePosStore.getState().wastePreparedPortions({ batchId: "batch-a", portions: 18, reason: "unsold" }).ok).toBe(true);
    expect(batch("batch-a").status).toBe("wasted");
    expect(dish().stockOnHand).toBe(0);
  });

  // Spec 15 — full cancellation: stock and ingredients fully restored.
  it("full preparation cancellation reverses everything", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    expect(usePosStore.getState().cancelPrepBatch({ batchId: "batch-a" }).ok).toBe(true);

    expect(dish().stockOnHand).toBe(0);
    expect(batch("batch-a").status).toBe("cancelled");
    expect(batch("batch-a").remainingPortions).toBe(0);
    expect(product(CHICKEN_ID).stockOnHand).toBe(10); // +5 kg restored
    expect(product(POTATOES_ID).stockOnHand).toBe(20); // +6 kg
    expect(product(OIL_ID).stockOnHand).toBeCloseTo(5, 6); // +0.6 L

    const cancelMoves = usePosStore.getState().stockMovements.filter((m) => m.refId === "batch-a");
    expect(cancelMoves).toContainEqual(expect.objectContaining({ productId: CHICKEN_ID, deltaBaseUnits: 5, kind: "adjust_use" }));
    expect(cancelMoves.some((m) => m.productId === DISH_ID && m.deltaBaseUnits === -20)).toBe(true);
  });

  // Spec 16 — partial cancellation: only unsold portions reverse; sold history stands.
  it("partial cancellation reverses only the 12 unsold portions", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 8, "l1")] });
    expect(finalize().ok).toBe(true);
    expect(dish().stockOnHand).toBe(12);
    expect(product(CHICKEN_ID).stockOnHand).toBe(5);

    expect(usePosStore.getState().cancelPrepBatch({ batchId: "batch-a" }).ok).toBe(true);

    // Only 12 portions reverse: chicken +3 kg (0.25 × 12), not the full 5 kg.
    expect(product(CHICKEN_ID).stockOnHand).toBeCloseTo(8, 6);
    expect(product(POTATOES_ID).stockOnHand).toBeCloseTo(17.6, 4); // 14 + 3.6 kg restored
    expect(dish().stockOnHand).toBe(0);
    expect(batch("batch-a").status).toBe("cancelled");

    // The 8 sold portions are historical: sale line COGS unchanged.
    const sale = usePosStore.getState().sales.find((s) => s.status === "completed")!;
    expect(sale.lines[0]!.cogsUgx).toBe(8 * 2_780);
  });

  // Spec 17 — void on a prepared-food sale: shared reversal, financial correctness.
  it("voiding a prepared-food sale restocks portions and preserves the audit trail", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 2, "l1")] });
    expect(finalize().ok).toBe(true);
    const saleId = usePosStore.getState().sales.find((s) => s.status === "completed")!.id;

    const voided = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" });
    expect(voided.ok).toBe(true);

    // Shared mechanism restocks finished portions; batch provenance is credited back.
    expect(dish().stockOnHand).toBe(20);
    expect(batch("batch-a").remainingPortions).toBe(20);
    expect(batch("batch-a").status).toBe("active");
    // No raw ingredients recreated, no double restore.
    expect(product(CHICKEN_ID).stockOnHand).toBe(5);

    const sale = usePosStore.getState().sales.find((s) => s.id === saleId)!;
    expect(sale.lines[0]!.voided).toBe(true);
    expect(sale.totalUgx).toBe(0);
    expect(usePosStore.getState().voidRecords).toHaveLength(1);
  });

  // Spec 19 — unbatched finished-menu stock: sale blocked, never silent cost invention.
  it("unbatched prepared stock blocks the sale until reconciled", () => {
    const legacy = makeDish("batch_prepared", { stockOnHand: 5 }); // stock without batch provenance
    seed([{ ...chicken }, { ...potatoes }, { ...oil }, legacy], [qtyLine(legacy, 1, "l1")]);
    const res = finalize();
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("unbatchedStock");
    expect(dish().stockOnHand).toBe(5);
    expect(usePosStore.getState().sales).toHaveLength(0);
  });

  // Spec 20–22 — offline/sync: idempotent prep with stable ids, pendingSync flags.
  it("prepare is idempotent by batchId and flags sync state", () => {
    const first = prepare(20, "batch-a");
    expect(first.ok).toBe(true);
    const movementsAfterFirst = usePosStore.getState().stockMovements.length;
    const chickenAfterFirst = product(CHICKEN_ID).stockOnHand;

    const retry = prepare(20, "batch-a"); // same caller-supplied id
    expect(retry.ok).toBe(true);
    expect(usePosStore.getState().stockMovements.length).toBe(movementsAfterFirst); // no duplicate movements
    expect(product(CHICKEN_ID).stockOnHand).toBe(chickenAfterFirst); // no double deduction
    expect(batches()).toHaveLength(1);

    usePosStore.setState({ draftLines: [qtyLine(dish(), 1, "l1")] });
    expect(finalize().ok).toBe(true);
    expect(usePosStore.getState().sales[0]!.pendingSync).toBe(true); // offline sale queued
  });

  // Spec 23–24 — movement ledger + recovery reconciliation explain every quantity.
  it("inventory integrity and recovery reconciliation hold across prep, sale, waste", () => {
    expect(prepare(20, "batch-a").ok).toBe(true);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 3, "l1"), qtyLine(drink, 2, "l2")] });
    expect(finalize().ok).toBe(true);
    expect(usePosStore.getState().wastePreparedPortions({ batchId: "batch-a", portions: 2, reason: "unsold" }).ok).toBe(true);

    expect(dish().stockOnHand).toBe(15);
    expect(batch("batch-a").remainingPortions).toBe(15);
    expect(product(DRINK_ID).stockOnHand).toBe(22);
    expectLedgerConsistent();

    // Recovery synthesis (replay movements from recorded sales) must agree.
    const report = reconcileRecoveryInventoryLedger({ applyToStore: false });
    expect(report.remainingMismatches).toEqual([]);
    expect(report.status).toBe("healthy");
  });

  // Spec 25 (light) — day-close inputs unaffected: prep writes no revenue/payment state.
  it("preparation creates no revenue, payment, debt, or shift-cash effects", () => {
    const shiftBefore = usePosStore.getState().preferences.shifts?.[0];
    expect(prepare(20, "batch-a").ok).toBe(true);
    const shiftAfter = usePosStore.getState().preferences.shifts?.[0];
    expect(shiftAfter?.estimatedCashUgx ?? 0).toBe(shiftBefore?.estimatedCashUgx ?? 0);
    expect(usePosStore.getState().customers).toHaveLength(0);
    expect(usePosStore.getState().sales).toHaveLength(0);
    const prepMoves = usePosStore.getState().stockMovements.filter((m) => m.refId === "batch-a");
    expect(prepMoves.every((m) => m.kind === "adjust_use")).toBe(true);
  });
});
