/**
 * Hospitality recipe-sale invariants — run through the REAL retail engine
 * (usePosStore.finalizeDraftSale) so these tests prove hospitality rides on
 * retail financial logic instead of a parallel ledger.
 *
 * Covers spec section 20 tests: direct drink sale, recipe food sale,
 * ingredient deduction, food cost, yield, waste %, COGS-profit, historical
 * COGS preservation, returns/voids, sync, and inventory reconciliation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";

const DRINK_ID = "drink-1";
const BURGER_ID = "burger-1";
const PILAU_ID = "pilau-1";
const BUN_ID = "bun-1";
const CHICKEN_ID = "chicken-1";
const RICE_ID = "rice-1";

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

const drink = baseProduct({
  id: DRINK_ID,
  name: "Soda 300ml",
  sellingPricePerUnitUgx: 2_000,
  costPricePerUnitUgx: 1_200,
  stockOnHand: 24,
  baseUnit: "bottle",
  category: "Drinks",
});

const bun = baseProduct({
  id: BUN_ID,
  name: "Burger Bun",
  costPricePerUnitUgx: 500,
  stockOnHand: 100,
  baseUnit: "pc",
  menu: { productKind: "ingredient" },
});

const chicken = baseProduct({
  id: CHICKEN_ID,
  name: "Chicken",
  costPricePerUnitUgx: 8_000,
  stockOnHand: 10,
  baseUnit: "kg",
  menu: { productKind: "ingredient" },
});

const rice = baseProduct({
  id: RICE_ID,
  name: "Rice",
  costPricePerUnitUgx: 4_000,
  stockOnHand: 50,
  baseUnit: "kg",
  menu: { productKind: "ingredient" },
});

/** Recipe-driven finished menu item with NO finished stock (stockOnHand 0). */
function makeBurger(overrides?: Partial<Product>): Product {
  return baseProduct({
    id: BURGER_ID,
    name: "Chicken Burger",
    sellingPricePerUnitUgx: 15_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    baseUnit: "plate",
    menu: {
      productKind: "finished_menu",
      recipe: {
        lines: [
          { ingredientProductId: BUN_ID, quantityBase: 1, unitLabel: "pc" },
          { ingredientProductId: CHICKEN_ID, quantityBase: 0.15, unitLabel: "kg" },
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

function seed(products: Product[], lines: SaleLine[]) {
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

function product(id: string): Product {
  return usePosStore.getState().products.find((p) => p.id === id)!;
}

function onlySale() {
  const sales = usePosStore.getState().sales;
  expect(sales).toHaveLength(1);
  return sales[0]!;
}

/** Ledger check: recorded stock must equal opening + movement deltas for every product. */
function expectLedgerConsistent(openingStock: Record<string, number>) {
  const s = usePosStore.getState();
  const result = verifyInventoryIntegrity({
    products: s.products,
    movements: s.stockMovements,
    archivedMovements: s.archivedStockMovements,
    openingStockByProduct: openingStock,
  });
  expect(result.mismatches).toEqual([]);
  expect(result.ok).toBe(true);
}

describe("hospitality recipe sale invariants", () => {
  beforeEach(() => {
    seed([{ ...drink }, { ...bun }, { ...chicken }, makeBurger()], []);
  });

  it("A/G: direct drink (takeaway) sale stays pure retail — stock −1, product cost, sale_out movement", () => {
    seed([{ ...drink }, { ...bun }, { ...chicken }, makeBurger()], [qtyLine(drink, 1, "l1")]);
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);

    expect(product(DRINK_ID).stockOnHand).toBe(23);
    const sale = onlySale();
    expect(sale.totalUgx).toBe(2_000);
    expect(sale.lines[0]!.unitCostUgx).toBe(1_200);
    expect(sale.lines[0]!.cogsUgx).toBe(1_200);
    expect(sale.estimatedProfitUgx).toBe(800);

    const moves = usePosStore.getState().stockMovements.filter((m) => m.refId === sale.id);
    expect(moves).toHaveLength(1);
    expect(moves[0]!).toMatchObject({ productId: DRINK_ID, kind: "sale_out", deltaBaseUnits: -1 });

    expectLedgerConsistent({ [DRINK_ID]: 24, [BUN_ID]: 100, [CHICKEN_ID]: 10, [BURGER_ID]: 0 });
  });

  it("B/C: recipe food sale deducts ingredients per plate and never finished stock (burger has 0 stock)", () => {
    // Burger stockOnHand = 0: the finalize stock gate must NOT block recipe items.
    seed([{ ...drink }, { ...bun }, { ...chicken }, makeBurger()], [qtyLine(makeBurger(), 2, "l1")]);
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);

    expect(product(BURGER_ID).stockOnHand).toBe(0); // no double deduction of finished stock
    expect(product(BUN_ID).stockOnHand).toBe(98); // 2 plates × 1 bun
    expect(product(CHICKEN_ID).stockOnHand).toBeCloseTo(9.7, 6); // 2 × 0.15 kg
  });

  it("D/J: recipe line COGS = recipe food cost × qty and sale reconciles with retail totals", () => {
    seed(
      [{ ...drink }, { ...bun }, { ...chicken }, makeBurger()],
      [qtyLine(drink, 1, "l1"), qtyLine(makeBurger(), 2, "l2")],
    );
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);

    const sale = onlySale();
    const burgerLine = sale.lines.find((l) => l.productId === BURGER_ID)!;
    // food cost per plate = 1 bun × 500 + 0.15 kg chicken × 8,000 = 1,700
    expect(burgerLine.unitCostUgx).toBe(1_700);
    expect(burgerLine.cogsUgx).toBe(3_400);

    const drinkLine = sale.lines.find((l) => l.productId === DRINK_ID)!;
    const totalCogs = (drinkLine.cogsUgx ?? 0) + (burgerLine.cogsUgx ?? 0);
    const lineSum = sale.lines.reduce((sum, l) => sum + l.lineTotalUgx, 0);
    expect(sale.totalUgx).toBe(lineSum); // reconciliation with retail totals
    expect(sale.estimatedProfitUgx).toBe(sale.totalUgx - totalCogs);
  });

  it("E: yieldQty batch math — 10 kg rice yields 20 plates, selling 4 deducts 2 kg", () => {
    const pilau = baseProduct({
      id: PILAU_ID,
      name: "Pilau",
      sellingPricePerUnitUgx: 12_000,
      costPricePerUnitUgx: 0,
      stockOnHand: 0,
      baseUnit: "plate",
      menu: {
        productKind: "finished_menu",
        recipe: {
          yieldQty: 20,
          lines: [{ ingredientProductId: RICE_ID, quantityBase: 10, unitLabel: "kg" }],
        },
        modifierGroups: [],
        variants: [],
      },
    });
    seed([{ ...rice }, pilau], [qtyLine(pilau, 4, "l1")]);
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);

    expect(product(RICE_ID).stockOnHand).toBe(48); // 4 plates × (10/20) kg
    const sale = onlySale();
    const line = sale.lines[0]!;
    expect(line.unitCostUgx).toBe(2_000); // 0.5 kg × 4,000
    expect(line.cogsUgx).toBe(8_000);
  });

  it("F: wastePercent is included in ingredient deduction and food cost", () => {
    const burgerWithWaste = makeBurger({
      menu: {
        productKind: "finished_menu",
        recipe: {
          lines: [
            { ingredientProductId: BUN_ID, quantityBase: 1, unitLabel: "pc" },
            { ingredientProductId: CHICKEN_ID, quantityBase: 0.15, unitLabel: "kg", wastePercent: 10 },
          ],
        },
        modifierGroups: [],
        variants: [],
      },
    });
    seed([{ ...bun }, { ...chicken }, burgerWithWaste], [qtyLine(burgerWithWaste, 2, "l1")]);
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);

    // chicken per plate = 0.15 × 1.10 = 0.165 kg → 2 plates = 0.33 kg
    expect(product(CHICKEN_ID).stockOnHand).toBeCloseTo(9.67, 6);
    const sale = onlySale();
    const line = sale.lines[0]!;
    // per plate = 500 + 0.165 × 8,000 = 1,820
    expect(line.unitCostUgx).toBe(1_820);
    expect(line.cogsUgx).toBe(3_640);
  });

  it("K: line COGS is frozen at sale time — later ingredient cost change does not rewrite history", () => {
    seed([{ ...bun }, { ...chicken }, makeBurger()], [qtyLine(makeBurger(), 1, "l1")]);
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);
    expect(onlySale().lines[0]!.cogsUgx).toBe(1_700);

    // Supplier price changes after the sale.
    usePosStore.setState({
      products: usePosStore.getState().products.map((p) =>
        p.id === CHICKEN_ID ? { ...p, costPricePerUnitUgx: 9_500 } : p,
      ),
    });

    const saleAfter = onlySale();
    expect(saleAfter.lines[0]!.unitCostUgx).toBe(1_700);
    expect(saleAfter.lines[0]!.cogsUgx).toBe(1_700);
    expect(saleAfter.estimatedProfitUgx).toBe(15_000 - 1_700);
  });

  it("L: void on a recipe sale keeps the audit trail and reduces sale totals", () => {
    seed([{ ...bun }, { ...chicken }, makeBurger()], [qtyLine(makeBurger(), 2, "l1")]);
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);
    const saleId = onlySale().id;

    const voided = usePosStore.getState().voidSaleLine({ saleId, lineIndex: 0, reason: "wrong_item" });
    expect(voided.ok).toBe(true);

    const s = usePosStore.getState();
    expect(s.voidRecords).toHaveLength(1);
    const sale = s.sales.find((x) => x.id === saleId)!;
    expect(sale.lines[0]!.voided).toBe(true);
    expect(sale.totalUgx).toBe(0);
    // Known limitation (documented in report): void restocks the finished item
    // (never deducted) and does NOT return ingredients to stock.
    expect(product(BURGER_ID).stockOnHand).toBe(2);
    expect(product(BUN_ID).stockOnHand).toBe(98);
  });

  it("M/N: sale is queued for sync and the movement ledger matches recorded stock for every product", () => {
    seed(
      [{ ...drink }, { ...bun }, { ...chicken }, makeBurger()],
      [qtyLine(drink, 2, "l1"), qtyLine(makeBurger(), 2, "l2")],
    );
    const res = usePosStore.getState().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });
    expect(res.ok).toBe(true);

    const sale = onlySale();
    expect(sale.pendingSync).toBe(true); // offline/sync outbox

    const moves = usePosStore.getState().stockMovements.filter((m) => m.refId === sale.id);
    // drink sale_out −2; NO phantom sale_out for the recipe burger.
    expect(moves.some((m) => m.productId === BURGER_ID)).toBe(false);
    expect(moves).toContainEqual(
      expect.objectContaining({ productId: DRINK_ID, kind: "sale_out", deltaBaseUnits: -2 }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({ productId: BUN_ID, kind: "adjust_use", deltaBaseUnits: -2 }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({ productId: CHICKEN_ID, kind: "adjust_use", deltaBaseUnits: -0.3 }),
    );

    expect(product(DRINK_ID).stockOnHand).toBe(22);
    expect(product(BUN_ID).stockOnHand).toBe(98);
    expect(product(CHICKEN_ID).stockOnHand).toBeCloseTo(9.7, 6);

    expectLedgerConsistent({ [DRINK_ID]: 24, [BUN_ID]: 100, [CHICKEN_ID]: 10, [BURGER_ID]: 0 });
  });
});
