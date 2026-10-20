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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrepBatch, Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { mergeProductFromCloudPull, verifyInventoryIntegrity } from "./inventoryIntegrity";
import { computePrepBatchProjection } from "./recipeEngine";
import { inventoryLineValueAtCostUgx } from "./costPrecision";
import { computeTodayProfitBreakdown } from "./homeProfit";
import { t } from "./i18n";
import { normalizeProductMenu } from "./menuModifiers";
import * as syncEngine from "../offline/syncEngine";
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

  // Batch-costing phase — legacy shape and semantics stay untouched.
  it("keeps the legacy batch shape when no explicit yield/cost fields are supplied", () => {
    expect(prepare(20, "batch-legacy").ok).toBe(true);
    const b = batch("batch-legacy");
    expect(b.expectedPortions).toBeUndefined();
    expect(b.actualPortions).toBeUndefined();
    expect(b.totalCostUgx).toBeUndefined();
    expect(b.unitCostUgx).toBe(2_780);
    expect(b.portionsPrepared).toBe(20);
  });

  it("deducts the full expected batch and costs it per actual plate", () => {
    const res = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 18,
      expectedPortions: 20,
      actualPortions: 18,
      additionalCosts: [
        { id: "charcoal", label: "Charcoal", amountUgx: 5_000 },
        { id: "labour", label: "Labour", amountUgx: 10_000 },
        { id: "packaging", label: "Packaging", amountUgx: 2_000 },
      ],
      batchId: "batch-costed",
    });
    expect(res.ok).toBe(true);

    // The full pot was cooked: ingredients are NOT scaled down to 18 plates.
    expect(product(CHICKEN_ID).stockOnHand).toBe(5);
    expect(product(POTATOES_ID).stockOnHand).toBe(14);
    expect(product(OIL_ID).stockOnHand).toBeCloseTo(4.4, 6);
    expect(dish().stockOnHand).toBe(18);

    const b = batch("batch-costed");
    expect(b.portionsPrepared).toBe(18);
    expect(b.expectedPortions).toBe(20);
    expect(b.actualPortions).toBe(18);
    expect(b.yieldBasis).toBe("actual");
    expect(b.ingredientCostUgx).toBe(55_600);
    expect(b.additionalCostUgx).toBe(17_000);
    expect(b.totalCostUgx).toBe(72_600);
    // The batch keeps its ingredient-only historical record, and freezes the
    // actual-yield full cost that sale consumption uses.
    expect(b.unitCostUgx).toBe(2_780); // frozen ingredient-only record
    expect(b.batchCostPerPlateUgx).toBe(4_033); // 72,600 / 18, rounded
    expect(b.costBasis).toBe("recipe_estimate");
    expect(b.additionalCosts).toHaveLength(3);

    const projection = computePrepBatchProjection(b, dish())!;
    expect(projection.isProjection).toBe(true);
    expect(projection.projectedRevenueUgx).toBe(270_000);
    expect(projection.projectedProfitUgx).toBe(197_400);
  });

  it("uses the full batch cost per actual plate in sale COGS and the shared Profit report", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-cogs",
      }).ok,
    ).toBe(true);
    expect(batch("batch-cogs").unitCostUgx).toBe(2_780);
    expect(batch("batch-cogs").batchCostPerPlateUgx).toBe(4_033);

    seed(usePosStore.getState().products, []);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 1, "l1")] });
    expect(finalize().ok).toBe(true);
    const sale = usePosStore.getState().sales[0]!;
    const line = sale.lines[0]!;
    expect(line.unitCostUgx).toBe(4_033); // 72,600 / 18 actual plates
    expect(line.cogsUgx).toBe(4_033);
    expect(line.estimatedProfitUgx).toBe(10_967);

    // The shared Profit report reads the same frozen sale-line snapshot.
    const productById = new Map(usePosStore.getState().products.map((p) => [p.id, p]));
    const profit = computeTodayProfitBreakdown([sale], productById);
    expect(profit.salesUgx).toBe(15_000);
    expect(profit.costUgx).toBe(4_033);
    expect(profit.profitUgx).toBe(10_967);
    expect(profit.costIncomplete).toBe(false);
    // The batch record itself is never rewritten by the sale.
    expect(batch("batch-cogs").unitCostUgx).toBe(2_780);
    expect(batch("batch-cogs").batchCostPerPlateUgx).toBe(4_033);

    // Later batch/product edits cannot rewrite the frozen sale-line snapshot
    // that the shared Profit report reads.
    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === DISH_ID
          ? {
              ...p,
              menu: {
                ...p.menu,
                prepBatches: (p.menu?.prepBatches ?? []).map((b) =>
                  b.id === "batch-cogs" ? { ...b, unitCostUgx: 88_888, batchCostPerPlateUgx: 99_999 } : b,
                ),
              },
            }
          : p,
      ),
    });
    expect(sale.lines[0]!.unitCostUgx).toBe(4_033);
    expect(sale.lines[0]!.cogsUgx).toBe(4_033);
    const profitAfterEdit = computeTodayProfitBreakdown(
      [sale],
      new Map(usePosStore.getState().products.map((p) => [p.id, p])),
    );
    expect(profitAfterEdit.costUgx).toBe(4_033);
    expect(profitAfterEdit.profitUgx).toBe(10_967);
  });

  it("values each FIFO batch at its own full cost and freezes the exact sale COGS", () => {
    // Batch A: 10 plates → 20,000 actual ingredients + 1,000 gas = 2,100/plate.
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 10,
        expectedPortions: 10,
        actualPortions: 10,
        actualIngredientCostUgx: 20_000,
        additionalCosts: [{ id: "gas-a", label: "Gas", amountUgx: 1_000 }],
        batchId: "batch-a",
      }).ok,
    ).toBe(true);
    // Batch B: an 20-plate pot yielding 18 plates → 40,000 + 17,000 = 3,167/plate.
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        actualIngredientCostUgx: 40_000,
        additionalCosts: [{ id: "charcoal-b", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-b",
      }).ok,
    ).toBe(true);

    seed(usePosStore.getState().products, []);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 12, "l1")] });
    expect(finalize().ok).toBe(true);

    const sale = usePosStore.getState().sales[0]!;
    const line = sale.lines[0]!;
    // 10 × 2,100 + 2 × 3,167 = 27,334. The weighted unit is 2,278, but the
    // frozen COGS is the exact FIFO cost (unit × qty would lose 2 UGX).
    expect(line.unitCostUgx).toBe(2_278);
    expect(line.cogsUgx).toBe(27_334);
    expect(line.estimatedProfitUgx).toBe(180_000 - 27_334);
    expect(line.prepAllocation).toEqual([
      { batchId: "batch-a", portions: 10 },
      { batchId: "batch-b", portions: 2 },
    ]);
    expect(batch("batch-a").remainingPortions).toBe(0);
    expect(batch("batch-b").remainingPortions).toBe(16);

    // The raw ingredients were consumed at preparation, never again at sale.
    expect(product(CHICKEN_ID).stockOnHand).toBe(2.5);
    expect(product(POTATOES_ID).stockOnHand).toBe(11);
    expect(product(OIL_ID).stockOnHand).toBeCloseTo(4.1, 6);

    const productById = new Map(usePosStore.getState().products.map((p) => [p.id, p]));
    const profit = computeTodayProfitBreakdown([sale], productById);
    expect(profit.costUgx).toBe(27_334);
    expect(profit.profitUgx).toBe(152_666);
  });

  it("adds modifier ingredient cost only to the line that consumes it at sale", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-modifiers",
      }).ok,
    ).toBe(true);

    const cheese: Product = baseProduct({
      id: "cheese-1",
      name: "Cheese",
      costPricePerUnitUgx: 4_000,
      stockOnHand: 5,
      baseUnit: "kg",
      menu: { productKind: "ingredient" },
    });
    const burger: Product = baseProduct({
      id: "burger-1",
      name: "Burger",
      sellingPricePerUnitUgx: 20_000,
      costPricePerUnitUgx: 0,
      stockOnHand: 0,
      baseUnit: "pcs",
      menu: {
        productKind: "finished_menu",
        prepMode: "made_to_order",
        recipe: { yieldQty: 1, lines: [{ ingredientProductId: CHICKEN_ID, quantityBase: 0.1, unitLabel: "kg" }] },
        modifierGroups: [
          {
            id: "extras",
            label: "Extras",
            required: false,
            selectionMode: "multiple",
            options: [
              {
                id: "cheese",
                label: "Extra cheese",
                priceDeltaUgx: 0,
                ingredientProductId: "cheese-1",
                ingredientQtyBase: 0.05,
              },
            ],
          },
        ],
        variants: [],
      },
    });

    seed([...usePosStore.getState().products, cheese, burger], []);
    usePosStore.setState({
      draftLines: [
        qtyLine(dish(), 1, "l-batch"),
        {
          ...qtyLine(burger, 2, "l-burger"),
          selectedModifiers: [
            { groupId: "extras", groupLabel: "Extras", optionId: "cheese", optionLabel: "Extra cheese", priceDeltaUgx: 0 },
          ],
        },
      ],
    });
    expect(finalize().ok).toBe(true);

    const sale = usePosStore.getState().sales[0]!;
    const batchLine = sale.lines.find((l) => l.productId === DISH_ID)!;
    const burgerLine = sale.lines.find((l) => l.productId === "burger-1")!;
    // Batch portion: full batch cost only; the batch already contains the recipe.
    expect(batchLine.unitCostUgx).toBe(4_033);
    expect(batchLine.cogsUgx).toBe(4_033);
    // Made-to-order line: base recipe + the modifier ingredient consumed at sale.
    expect(burgerLine.cogsUgx).toBe(2_000); // 2 × (0.1 × 8,000 + 0.05 × 4,000)
    expect(sale.estimatedProfitUgx).toBe(55_000 - (4_033 + 2_000));

    expect(product("cheese-1").stockOnHand).toBeCloseTo(4.9, 6);
    expect(product(CHICKEN_ID).stockOnHand).toBeCloseTo(4.8, 6); // 5 left from prep − 0.2
    expect(product(DISH_ID).stockOnHand).toBe(17);
  });

  it("a replayed completion consumes no batch portions and does not rewrite sale COGS", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-replay",
      }).ok,
    ).toBe(true);
    seed(usePosStore.getState().products, []);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 2, "l1")] });
    expect(finalize().ok).toBe(true);
    const sale = usePosStore.getState().sales[0]!;
    const before = {
      cogs: sale.lines[0]!.cogsUgx,
      unitCost: sale.lines[0]!.unitCostUgx,
      remaining: batch("batch-replay").remainingPortions,
      dishStock: dish().stockOnHand,
      movements: usePosStore.getState().stockMovements.length,
    };

    // A stale queue entry still points at the completed sale as its target.
    usePosStore.setState({ activePendingSaleId: sale.id, draftLines: [qtyLine(dish(), 2, "l2")] });
    const replay = finalize();

    expect(replay).toMatchObject({ ok: true, idempotent: true, saleId: sale.id });
    expect(usePosStore.getState().sales).toHaveLength(1);
    expect(usePosStore.getState().sales[0]!.lines[0]!.cogsUgx).toBe(before.cogs);
    expect(usePosStore.getState().sales[0]!.lines[0]!.unitCostUgx).toBe(before.unitCost);
    expect(batch("batch-replay").remainingPortions).toBe(before.remaining);
    expect(dish().stockOnHand).toBe(before.dishStock);
    expect(usePosStore.getState().stockMovements).toHaveLength(before.movements);
  });

  it("returns and voids reverse portions at the frozen batch cost, never raw ingredients", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 10,
        expectedPortions: 10,
        actualPortions: 10,
        actualIngredientCostUgx: 20_000,
        additionalCosts: [{ id: "gas-a", label: "Gas", amountUgx: 1_000 }],
        batchId: "batch-a",
      }).ok,
    ).toBe(true);
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        actualIngredientCostUgx: 40_000,
        additionalCosts: [{ id: "charcoal-b", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-b",
      }).ok,
    ).toBe(true);
    seed(usePosStore.getState().products, []);
    usePosStore.setState({ draftLines: [qtyLine(dish(), 12, "l1")] });
    expect(finalize().ok).toBe(true);

    const sale = usePosStore.getState().sales[0]!;
    const line = sale.lines[0]!;
    expect(line.cogsUgx).toBe(27_334);
    const raw = {
      chicken: product(CHICKEN_ID).stockOnHand,
      potatoes: product(POTATOES_ID).stockOnHand,
      oil: product(OIL_ID).stockOnHand,
    };

    // Return 3 portions: the last-consumed batch B gives 2 back, then batch A 1.
    const ret = usePosStore.getState().returnProduct({
      saleId: sale.id,
      productId: DISH_ID,
      quantity: 3,
      refundAmountUgx: 45_000,
      reason: "wrong_item",
      note: "n",
    });
    expect(ret.ok).toBe(true);
    const returnRec = usePosStore.getState().returnRecords[0]!;
    expect(returnRec.cogsUgx).toBe(6_834); // round(27,334 × 3 / 12)
    expect(batch("batch-a").remainingPortions).toBe(1);
    expect(batch("batch-b").remainingPortions).toBe(18);
    expect(dish().stockOnHand).toBe(19);
    expect(product(CHICKEN_ID).stockOnHand).toBe(raw.chicken);
    expect(product(POTATOES_ID).stockOnHand).toBe(raw.potatoes);
    expect(product(OIL_ID).stockOnHand).toBe(raw.oil);
    // The historical sale-line cost is untouched by the return.
    expect(usePosStore.getState().sales[0]!.lines[0]!.cogsUgx).toBe(27_334);

    // Void the remaining 9: batch A takes its 1 already-returned portion back
    // first, then the remaining 9.
    expect(usePosStore.getState().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    expect(batch("batch-a").remainingPortions).toBe(10);
    expect(batch("batch-b").remainingPortions).toBe(18);
    expect(dish().stockOnHand).toBe(28);
    expect(product(CHICKEN_ID).stockOnHand).toBe(raw.chicken);
    expect(product(POTATOES_ID).stockOnHand).toBe(raw.potatoes);
    expect(product(OIL_ID).stockOnHand).toBe(raw.oil);
    expect(usePosStore.getState().sales[0]!.lines[0]!.cogsUgx).toBe(27_334);
  });

  it("keeps yield estimated when actual plates are unknown", () => {
    const res = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 20,
      expectedPortions: 20,
      actualPortions: null,
      batchId: "batch-estimated",
    });
    expect(res.ok).toBe(true);
    const b = batch("batch-estimated");
    expect(b.actualPortions).toBeNull();
    expect(b.yieldBasis).toBe("estimated");
    expect(b.portionsPrepared).toBe(20);
    expect(b.totalCostUgx).toBe(55_600);
    expect(b.unitCostUgx).toBe(2_780);
    expect(b.batchCostPerPlateUgx).toBe(2_780);

    const projection = computePrepBatchProjection(b, dish())!;
    expect(projection.yieldBasis).toBe("estimated");
    expect(projection.projectedRevenueUgx).toBe(300_000);
    expect(projection.projectedProfitUgx).toBe(244_400);
  });

  it("uses an actual ingredient cost once, with extra costs added separately", () => {
    const res = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 20,
      expectedPortions: 20,
      actualPortions: 20,
      actualIngredientCostUgx: 40_000,
      additionalCosts: [{ id: "gas", label: "Gas", amountUgx: 5_000 }],
      batchId: "batch-actual-cost",
    });
    expect(res.ok).toBe(true);
    const b = batch("batch-actual-cost");
    expect(b.ingredientCostUgx).toBe(40_000);
    expect(b.additionalCostUgx).toBe(5_000);
    expect(b.totalCostUgx).toBe(45_000);
    expect(b.unitCostUgx).toBe(2_780); // existing sale COGS basis, unchanged
    expect(b.batchCostPerPlateUgx).toBe(2_250); // full batch cost / plate
    expect(b.costBasis).toBe("actual");
    // The cost override never changes the physical ingredient deduction.
    expect(product(CHICKEN_ID).stockOnHand).toBe(5);
    expect(product(POTATOES_ID).stockOnHand).toBe(14);
    expect(product(OIL_ID).stockOnHand).toBeCloseTo(4.4, 6);

    const projection = computePrepBatchProjection(b, dish())!;
    expect(projection.costBasis).toBe("actual");
    expect(projection.projectedRevenueUgx).toBe(300_000);
    expect(projection.projectedProfitUgx).toBe(255_000);
  });

  it("values prepared stock at the frozen batch cost through prep, sale and waste", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-value",
      }).ok,
    ).toBe(true);
    const batchCost = batch("batch-value").batchCostPerPlateUgx!;
    expect(batchCost).toBe(4_033);
    expect(inventoryLineValueAtCostUgx(dish())).toBe(18 * batchCost);
    // Retail/plain products keep their existing valuation.
    expect(inventoryLineValueAtCostUgx(product(DRINK_ID))).toBe(24 * 1_200);

    usePosStore.setState({ draftLines: [qtyLine(dish(), 2, "l1")] });
    expect(finalize().ok).toBe(true);
    expect(inventoryLineValueAtCostUgx(dish())).toBe(16 * batchCost);

    expect(
      usePosStore.getState().wastePreparedPortions({ batchId: "batch-value", portions: 4, reason: "unsold" }).ok,
    ).toBe(true);
    expect(inventoryLineValueAtCostUgx(dish())).toBe(12 * batchCost);
  });

  it("values waste and remaining plates at the batch's frozen cost", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-waste",
      }).ok,
    ).toBe(true);
    const b = batch("batch-waste");
    expect(b.unitCostUgx).toBe(2_780);
    expect(b.batchCostPerPlateUgx).toBe(4_033);

    const res = usePosStore.getState().wastePreparedPortions({
      batchId: "batch-waste",
      portions: 4,
      reason: "unsold",
    });
    expect(res.ok).toBe(true);
    expect(res.lossValueUgx).toBe(16_132);
    expect(batch("batch-waste").wastedPortions).toBe(4);
    expect(batch("batch-waste").wasteCostUgx).toBe(16_132);
    expect(batch("batch-waste").remainingPortions).toBe(14);
    expect(dish().stockOnHand).toBe(14);
  });

  it("cancelling an explicit batch restores the full-pot ingredient share", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        batchId: "batch-cancel-costed",
      }).ok,
    ).toBe(true);
    expect(usePosStore.getState().cancelPrepBatch({ batchId: "batch-cancel-costed" }).ok).toBe(true);

    // All 18 unsold plates came from the full expected batch, so the full
    // 5 kg / 6 kg / 0.6 L is restored — not 18/20 of it.
    expect(product(CHICKEN_ID).stockOnHand).toBe(10);
    expect(product(POTATOES_ID).stockOnHand).toBe(20);
    expect(product(OIL_ID).stockOnHand).toBeCloseTo(5, 6);
    expect(dish().stockOnHand).toBe(0);
    expect(batch("batch-cancel-costed").status).toBe("cancelled");
  });

  it("blocks preparation and returns missing ingredient ids instead of zero-costing them", () => {
    const valid = makeDish("batch_prepared");
    const broken = {
      ...valid,
      menu: {
        ...valid.menu!,
        recipe: {
          yieldQty: 20,
          lines: [{ ingredientProductId: "ghost-ingredient", quantityBase: 1, unitLabel: "kg" }],
        },
      },
    };
    seed([{ ...chicken }, broken]);
    const res = usePosStore.getState().prepareMenuBatch({
      productId: DISH_ID,
      portions: 10,
      expectedPortions: 10,
      batchId: "batch-missing",
    });
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("menuPrepMissingIngredient");
    expect(res.missingIngredientIds).toContain("ghost-ingredient");
    expect(dish().stockOnHand).toBe(0);
    expect(batches()).toHaveLength(0);
    expect(usePosStore.getState().stockMovements).toHaveLength(0);
  });

  it("labels the sell-out projection as projected, not recorded revenue", () => {
    expect(t("en", "menuPrepProjectionTitle")).toContain("projection only");
    expect(t("en", "menuPrepProjectionNote")).toContain("Not recorded revenue");
  });

  it("queues product metadata after prepare, waste and cancel so another device receives the batch", async () => {
    const spy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
    const productOps = () =>
      spy.mock.calls.filter((call) => {
        const op = call[0] as {
          kind?: string;
          payload?: { id?: string; catalogOnly?: boolean };
        };
        return (
          op.kind === "product" &&
          op.payload?.id === DISH_ID &&
          op.payload?.catalogOnly === true
        );
      });
    try {
      expect(
        usePosStore.getState().prepareMenuBatch({
          productId: DISH_ID,
          portions: 20,
          expectedPortions: 20,
          actualPortions: 20,
          batchId: "batch-sync",
        }).ok,
      ).toBe(true);
      await vi.waitFor(() => expect(productOps().length).toBeGreaterThan(0));

      spy.mockClear();
      expect(usePosStore.getState().wastePreparedPortions({ batchId: "batch-sync", portions: 1, reason: "unsold" }).ok).toBe(true);
      await vi.waitFor(() => expect(productOps().length).toBeGreaterThan(0));

      spy.mockClear();
      expect(usePosStore.getState().cancelPrepBatch({ batchId: "batch-sync" }).ok).toBe(true);
      await vi.waitFor(() => expect(productOps().length).toBeGreaterThan(0));
    } finally {
      spy.mockRestore();
    }
  });

  it("a device with no local batches adopts the pushed explicit batch metadata", () => {
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-adopt",
      }).ok,
    ).toBe(true);
    const remote = dish();
    const local: Product = {
      ...remote,
      stockOnHand: 0,
      updatedAt: "2020-01-01T00:00:00.000Z",
      version: 1,
      menu: { ...remote.menu!, prepBatches: [] },
    };
    const merged = mergeProductFromCloudPull(local, remote, {});
    expect(merged.stockOnHand).toBe(18);
    expect(merged.menu?.prepBatches?.[0]).toMatchObject({
      id: "batch-adopt",
      expectedPortions: 20,
      actualPortions: 18,
      totalCostUgx: 72_600,
      unitCostUgx: 2_780,
      batchCostPerPlateUgx: 4_033,
    });

    const normalized = normalizeProductMenu({ ...remote.menu!, prepBatches: remote.menu?.prepBatches });
    expect(normalized?.prepBatches?.[0]).toMatchObject({
      expectedPortions: 20,
      actualPortions: 18,
      totalCostUgx: 72_600,
      additionalCostUgx: 17_000,
      unitCostUgx: 2_780,
      batchCostPerPlateUgx: 4_033,
    });

    // The same pull path must carry a wasted batch's state and stock.
    expect(
      usePosStore.getState().wastePreparedPortions({
        batchId: "batch-adopt",
        portions: 4,
        reason: "unsold",
      }).ok,
    ).toBe(true);
    const wastedRemote = dish();
    const wastedLocal: Product = {
      ...wastedRemote,
      stockOnHand: 0,
      updatedAt: "2020-01-01T00:00:00.000Z",
      version: 1,
      menu: { ...wastedRemote.menu!, prepBatches: [] },
    };
    const wastedMerged = mergeProductFromCloudPull(wastedLocal, wastedRemote, {});
    expect(wastedMerged.stockOnHand).toBe(14);
    expect(wastedMerged.menu?.prepBatches?.[0]).toMatchObject({
      remainingPortions: 14,
      wastedPortions: 4,
      wasteCostUgx: 16_132,
    });

    // ...and a cancelled batch's terminal state.
    expect(usePosStore.getState().cancelPrepBatch({ batchId: "batch-adopt" }).ok).toBe(true);
    const cancelledRemote = dish();
    const cancelledLocal: Product = {
      ...cancelledRemote,
      stockOnHand: 0,
      updatedAt: "2020-01-01T00:00:00.000Z",
      version: 1,
      menu: { ...cancelledRemote.menu!, prepBatches: [] },
    };
    const cancelledMerged = mergeProductFromCloudPull(cancelledLocal, cancelledRemote, {});
    expect(cancelledMerged.stockOnHand).toBe(0);
    expect(cancelledMerged.menu?.prepBatches?.[0]).toMatchObject({
      status: "cancelled",
      remainingPortions: 0,
    });
  });
});

describe("batch-prepared modifier ingredients", () => {
  const CHEESE_ID = "cheese-1";
  const MODIFIER = {
    groupId: "extras",
    groupLabel: "Extras",
    optionId: "cheese",
    optionLabel: "Extra cheese",
    priceDeltaUgx: 0,
  };

  const cheese = baseProduct({
    id: CHEESE_ID,
    name: "Cheese",
    costPricePerUnitUgx: 4_000,
    stockOnHand: 5,
    baseUnit: "kg",
    menu: { productKind: "ingredient" },
  });

  function dishWithModifier(): Product {
    return {
      ...makeDish("batch_prepared"),
      menu: {
        ...makeDish("batch_prepared").menu!,
        modifierGroups: [
          {
            id: "extras",
            label: "Extras",
            required: false,
            selectionMode: "multiple",
            options: [
              {
                id: "cheese",
                label: "Extra cheese",
                priceDeltaUgx: 0,
                ingredientProductId: CHEESE_ID,
                ingredientQtyBase: 0.05,
              },
            ],
          },
        ],
      },
    };
  }

  function seedCostedDish() {
    seed([{ ...chicken }, { ...potatoes }, { ...oil }, { ...drink }, dishWithModifier(), { ...cheese }], []);
    expect(
      usePosStore.getState().prepareMenuBatch({
        productId: DISH_ID,
        portions: 18,
        expectedPortions: 20,
        actualPortions: 18,
        additionalCosts: [{ id: "charcoal", label: "Charcoal", amountUgx: 17_000 }],
        batchId: "batch-mod",
      }).ok,
    ).toBe(true);
  }

  const modLine = (qty: number) => ({
    ...qtyLine(dish(), qty, "l1"),
    selectedModifiers: [MODIFIER],
  });

  const rawStock = () => ({
    chicken: product(CHICKEN_ID).stockOnHand,
    potatoes: product(POTATOES_ID).stockOnHand,
    oil: product(OIL_ID).stockOnHand,
  });

  it("consumes the modifier ingredient once, keeps the batch recipe untouched, and freezes both costs", () => {
    seedCostedDish();
    const raw = rawStock();
    usePosStore.setState({ draftLines: [modLine(2)] });
    expect(finalize().ok).toBe(true);

    // Prepared portions + modifier ingredient only; the batch recipe stays consumed at prep.
    expect(product(DISH_ID).stockOnHand).toBe(16);
    expect(batch("batch-mod").remainingPortions).toBe(16);
    expect(product(CHEESE_ID).stockOnHand).toBeCloseTo(4.9, 6);
    expect(rawStock()).toEqual(raw);

    const sale = usePosStore.getState().sales[0]!;
    const line = sale.lines[0]!;
    expect(line.prepAllocation).toEqual([{ batchId: "batch-mod", portions: 2 }]);
    expect(line.ingredientConsumption).toEqual([{ productId: CHEESE_ID, quantity: 0.1 }]);
    // 2 × 4,033 batch cost + 2 × 0.05 kg × 4,000 cheese = 8,466; unit 4,233.
    expect(line.unitCostUgx).toBe(4_233);
    expect(line.cogsUgx).toBe(8_466);
    expect(line.estimatedProfitUgx).toBe(30_000 - 8_466);

    const moves = usePosStore.getState().stockMovements.filter((m) => m.refId === sale.id);
    expect(moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: DISH_ID, kind: "sale_out", deltaBaseUnits: -2 }),
        expect.objectContaining({ productId: CHEESE_ID, kind: "adjust_use", deltaBaseUnits: -0.1 }),
      ]),
    );
    expect(moves.some((m) => [CHICKEN_ID, POTATOES_ID, OIL_ID].includes(m.productId))).toBe(false);

    const integrity = verifyInventoryIntegrity({
      products: usePosStore.getState().products,
      movements: usePosStore.getState().stockMovements,
      openingStockByProduct: { ...OPENING, [CHEESE_ID]: 5 },
    });
    expect(integrity.mismatches).toEqual([]);
  });

  it("voids both the prepared portion and the modifier ingredient, never the batch recipe", () => {
    seedCostedDish();
    const raw = rawStock();
    usePosStore.setState({ draftLines: [modLine(2)] });
    expect(finalize().ok).toBe(true);
    const saleId = usePosStore.getState().sales[0]!.id;

    expect(usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);

    expect(product(DISH_ID).stockOnHand).toBe(18);
    expect(batch("batch-mod").remainingPortions).toBe(18);
    expect(product(CHEESE_ID).stockOnHand).toBe(5);
    expect(rawStock()).toEqual(raw);
    expect(usePosStore.getState().sales[0]!.lines[0]!.cogsUgx).toBe(8_466);

    const voidRec = usePosStore.getState().voidRecords[0]!;
    const moves = usePosStore.getState().stockMovements.filter((m) => m.refId === voidRec.id);
    expect(moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: DISH_ID, deltaBaseUnits: 2 }),
        expect.objectContaining({ productId: CHEESE_ID, deltaBaseUnits: 0.1 }),
      ]),
    );
    expect(moves.some((m) => [CHICKEN_ID, POTATOES_ID, OIL_ID].includes(m.productId))).toBe(false);
  });

  it("returns a portion and its share of the modifier ingredient proportionally", () => {
    seedCostedDish();
    const raw = rawStock();
    usePosStore.setState({ draftLines: [modLine(2)] });
    expect(finalize().ok).toBe(true);
    const saleId = usePosStore.getState().sales[0]!.id;

    const ret = usePosStore.getState().returnProduct({
      saleId,
      productId: DISH_ID,
      quantity: 1,
      refundAmountUgx: 15_000,
      reason: "wrong_item",
      note: "n",
    });
    expect(ret.ok).toBe(true);

    expect(product(DISH_ID).stockOnHand).toBe(17);
    expect(batch("batch-mod").remainingPortions).toBe(17);
    expect(product(CHEESE_ID).stockOnHand).toBeCloseTo(4.95, 6);
    expect(rawStock()).toEqual(raw);
    expect(usePosStore.getState().returnRecords[0]!.cogsUgx).toBe(4_233); // half of 8,466
    expect(usePosStore.getState().sales[0]!.lines[0]!.cogsUgx).toBe(8_466);

    const returnMoves = usePosStore.getState().stockMovements.filter(
      (m) => m.refId === usePosStore.getState().returnRecords[0]!.id,
    );
    expect(returnMoves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: DISH_ID, deltaBaseUnits: 1 }),
        expect.objectContaining({ productId: CHEESE_ID, deltaBaseUnits: 0.05 }),
      ]),
    );
    expect(returnMoves.some((m) => [CHICKEN_ID, POTATOES_ID, OIL_ID].includes(m.productId))).toBe(false);
  });

  it("order-taking checks the modifier ingredient, not the batch recipe, at sale time", () => {
    seedCostedDish();
    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === CHEESE_ID ? { ...p, stockOnHand: 0 } : p,
      ),
      preferences: {
        ...usePosStore.getState().preferences,
        hospitalityIngredientPolicy: { policy: "block", allowNegativeInventory: false },
      },
    });
    const blocked = usePosStore.getState().addHospitalityDraftLine({
      product: dish(),
      quantity: 1,
      modifiers: [MODIFIER],
    });
    expect(blocked).toMatchObject({ ok: false, errorKey: "ingredientShortage" });

    // The base recipe is not checked: its ingredients were consumed during preparation.
    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === CHICKEN_ID ? { ...p, stockOnHand: 0 } : p,
      ),
      draftLines: [],
    });
    expect(usePosStore.getState().addHospitalityDraftLine({ product: dish(), quantity: 1 }).ok).toBe(true);
  });

  it("a replayed completion consumes neither the portion nor the modifier twice", () => {
    seedCostedDish();
    usePosStore.setState({ draftLines: [modLine(2)] });
    expect(finalize().ok).toBe(true);
    const sale = usePosStore.getState().sales[0]!;
    const before = {
      cogs: sale.lines[0]!.cogsUgx,
      remaining: batch("batch-mod").remainingPortions,
      dishStock: product(DISH_ID).stockOnHand,
      cheese: product(CHEESE_ID).stockOnHand,
      movements: usePosStore.getState().stockMovements.length,
    };

    usePosStore.setState({ activePendingSaleId: sale.id, draftLines: [modLine(2)] });
    expect(finalize()).toMatchObject({ ok: true, idempotent: true, saleId: sale.id });

    expect(usePosStore.getState().sales[0]!.lines[0]!.cogsUgx).toBe(before.cogs);
    expect(batch("batch-mod").remainingPortions).toBe(before.remaining);
    expect(product(DISH_ID).stockOnHand).toBe(before.dishStock);
    expect(product(CHEESE_ID).stockOnHand).toBe(before.cheese);
    expect(usePosStore.getState().stockMovements).toHaveLength(before.movements);
  });
});
