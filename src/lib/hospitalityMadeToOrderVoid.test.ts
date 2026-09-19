/**
 * Round 4 — made-to-order recipe void / return architecture.
 *
 * A made-to-order dish consumes INGREDIENTS at sale and never has finished-dish stock, so reversing it
 * must give back exactly the ingredients that line consumed (its frozen provenance) and must not credit
 * finished-dish stock. The original Sale/SaleLine (price, unit cost, COGS) stays the historical record.
 * Retail (finished stock) and batch-prepared (PrepBatch portions) reversals are unchanged and must
 * coexist in the same sale. All flows run through the real store actions.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../offline/syncEngine";
import type { Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { defaultHospitalityFloor } from "./hospitality";
import { decodeSaleLineFromCloud, encodeSaleLineForCloud } from "./saleLineCloudCodec";
import { allocateIngredientConsumption, ingredientReversalFor } from "./recipeEngine";
import { verifyInventoryIntegrity } from "./inventoryIntegrity";

const BEEF = "beef";
const BUN = "bun";
const SAUCE = "sauce";
const BURGER = "burger";
const COKE = "coke";
const CHICKEN_DISH = "chicken-dish"; // batch-prepared
const CH_A = "ch-a"; // ingredients of the batch-prepared dish
const CH_B = "ch-b";

function base(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
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

const ing = (id: string, cost: number) => base({ id, name: id, costPricePerUnitUgx: cost, baseUnit: "u", menu: { productKind: "ingredient" } });

/** Made-to-order: 1 beef (8,000) + 1 bun (1,000) + 1 sauce (500) per burger = 9,500 cost, sells 20,000. */
function makeBurger(): Product {
  return base({
    id: BURGER,
    name: "Burger",
    sellingPricePerUnitUgx: 20_000,
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    menu: {
      productKind: "finished_menu",
      prepMode: "made_to_order",
      recipe: {
        yieldQty: 1,
        lines: [
          { ingredientProductId: BEEF, quantityBase: 1, unitLabel: "u" },
          { ingredientProductId: BUN, quantityBase: 1, unitLabel: "u" },
          { ingredientProductId: SAUCE, quantityBase: 1, unitLabel: "u" },
        ],
      },
      modifierGroups: [],
      variants: [],
    },
  });
}

/** Batch-prepared: per 20 portions → A 40, B 20 (2 + 1 per portion). */
function makeChicken(): Product {
  return base({
    id: CHICKEN_DISH,
    name: "Prepared Chicken",
    costPricePerUnitUgx: 0,
    stockOnHand: 0,
    baseUnit: "portion",
    menu: {
      productKind: "finished_menu",
      prepMode: "batch_prepared",
      recipe: {
        yieldQty: 20,
        lines: [
          { ingredientProductId: CH_A, quantityBase: 40, unitLabel: "u" },
          { ingredientProductId: CH_B, quantityBase: 20, unitLabel: "u" },
        ],
      },
      modifierGroups: [],
      variants: [],
    },
  });
}

const coke = base({ id: COKE, name: "Coke", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 50, baseUnit: "bottle", category: "Drinks" });

const st = () => usePosStore.getState();
const stock = (id: string) => st().products.find((p) => p.id === id)!.stockOnHand;
const product = (id: string) => st().products.find((p) => p.id === id)!;
const sale = () => st().sales.find((s) => s.status === "completed")!;
const lineOf = (productId: string) => sale().lines.find((l) => l.productId === productId)!;
const lineIndexOf = (productId: string) => sale().lines.findIndex((l) => l.productId === productId);

const qtyLine = (p: Product, quantity: number, id: string): SaleLine => ({
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
});

const OPENING = { [BEEF]: 100, [BUN]: 100, [SAUCE]: 100, [BURGER]: 0, [COKE]: 50, [CH_A]: 100, [CH_B]: 100 };

function seed(extra: Partial<Product>[] = []) {
  const products = [ing(BEEF, 8_000), ing(BUN, 1_000), ing(SAUCE, 500), ing(CH_A, 1_000), ing(CH_B, 500), makeBurger(), makeChicken(), { ...coke }];
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: products.map((p) => ({ ...p, ...(extra.find((e) => e.id === p.id) ?? {}) })),
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

const finalizeRetail = () => st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" });

/** Burger × 3 (made-to-order) + Coke × 2 (retail) + Chicken × 2 (batch-prepared), one completed sale. */
function sellMixed() {
  seed();
  expect(st().prepareMenuBatch({ productId: CHICKEN_DISH, portions: 20, batchId: "b1" }).ok).toBe(true);
  usePosStore.setState({
    draftLines: [qtyLine(product(BURGER), 3, "l-burger"), qtyLine(product(COKE), 2, "l-coke"), qtyLine(product(CHICKEN_DISH), 2, "l-chicken")],
  });
  expect(finalizeRetail().ok).toBe(true);
  return sale().id;
}

function snapshotStock() {
  return Object.fromEntries(Object.keys(OPENING).map((id) => [id, stock(id)]));
}
const chickenBatch = () => (product(CHICKEN_DISH).menu?.prepBatches ?? []).find((b) => b.id === "b1")!;

const enqueued = () =>
  (vi.mocked(syncEngine.enqueueSync).mock.calls as Array<[{ kind: string; payload: Record<string, unknown> }]>)
    .map((c) => c[0])
    .filter((op) => op.kind === "pending_stock_updates");

beforeEach(() => {
  vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("provenance is frozen at finalize", () => {
  it("records exactly what each made-to-order line consumed; retail and batch-prepared lines carry none", () => {
    sellMixed();
    expect(lineOf(BURGER).ingredientConsumption).toEqual([
      { productId: BEEF, quantity: 3 },
      { productId: BUN, quantity: 3 },
      { productId: SAUCE, quantity: 3 },
    ]);
    expect(lineOf(COKE).ingredientConsumption).toBeUndefined();
    expect(lineOf(CHICKEN_DISH).ingredientConsumption).toBeUndefined();
    expect(lineOf(CHICKEN_DISH).prepAllocation).toEqual([{ batchId: "b1", portions: 2 }]);
    // stock: ingredients consumed, dish never had stock, coke sold, chicken portions sold
    expect(stock(BEEF)).toBe(97);
    expect(stock(BURGER)).toBe(0);
    expect(stock(COKE)).toBe(48);
    expect(chickenBatch().remainingPortions).toBe(18);
  });

  it("a permitted shortfall is not invented: provenance = what actually left the shelf, attributed in line order", () => {
    seed([{ id: BEEF, stockOnHand: 4 }]);
    usePosStore.setState({ draftLines: [qtyLine(product(BURGER), 3, "l1"), { ...qtyLine(product(BURGER), 2, "l2"), variantId: null }] });
    // both lines are the same dish; needs 5 beef, 4 on the shelf (default policy: warn → proceeds)
    expect(finalizeRetail().ok).toBe(true);
    const lines = sale().lines.filter((l) => l.productId === BURGER);
    const beef = lines.map((l) => l.ingredientConsumption!.find((c) => c.productId === BEEF)?.quantity ?? 0);
    expect(beef).toEqual([3, 1]);
    expect(stock(BEEF)).toBe(0);
  });

  it("the pure allocator caps each line by its own requirement", () => {
    const products = [ing(BEEF, 1), ing(BUN, 1), ing(SAUCE, 1), makeBurger()];
    const out = allocateIngredientConsumption(
      [qtyLine(makeBurger(), 2, "a"), qtyLine(makeBurger(), 2, "b")],
      products,
      new Map([[BEEF, 3], [BUN, 4], [SAUCE, 4]]),
    );
    expect(out[0]!.find((c) => c.productId === BEEF)!.quantity).toBe(2);
    expect(out[1]!.find((c) => c.productId === BEEF)!.quantity).toBe(1);
    expect(out[1]!.find((c) => c.productId === BUN)!.quantity).toBe(2);
  });
});

describe("full void of a made-to-order line", () => {
  it("returns its ingredients, creates NO finished-dish stock, leaves every other line alone", () => {
    sellMixed();
    const before = snapshotStock();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);

    expect(stock(BEEF)).toBe(before[BEEF]! + 3);
    expect(stock(BUN)).toBe(before[BUN]! + 3);
    expect(stock(SAUCE)).toBe(before[SAUCE]! + 3);
    expect(stock(BEEF)).toBe(OPENING[BEEF]);
    expect(stock(BURGER)).toBe(0); // no phantom finished stock
    expect(stock(COKE)).toBe(before[COKE]);
    expect(stock(CH_A)).toBe(before[CH_A]);
    expect(chickenBatch().remainingPortions).toBe(18);
  });

  it("books ingredient credits against the void record — and no movement for the dish", () => {
    sellMixed();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);
    const voidRec = st().voidRecords[0]!;
    const credits = st().stockMovements.filter((m) => m.refId === voidRec.id);
    expect(credits.map((m) => [m.productId, m.deltaBaseUnits]).sort()).toEqual([
      [BEEF, 3],
      [BUN, 3],
      [SAUCE, 3],
    ]);
    expect(credits.every((m) => m.kind === "adjust_other")).toBe(true);
    expect(st().stockMovements.some((m) => m.productId === BURGER && m.deltaBaseUnits > 0)).toBe(false);
  });

  it("the historical sale line is untouched: price, unit cost and COGS stay the sale-time snapshot", () => {
    sellMixed();
    const line = { ...lineOf(BURGER) };
    expect(line.unitCostUgx).toBe(9_500);
    expect(line.cogsUgx).toBe(28_500);
    // ingredient prices AND the recipe change afterwards
    usePosStore.setState({
      products: st().products.map((p) =>
        p.id === BEEF
          ? { ...p, costPricePerUnitUgx: 99_999 }
          : p.id === BURGER
            ? { ...p, menu: { ...p.menu!, recipe: { yieldQty: 1, lines: [{ ingredientProductId: BEEF, quantityBase: 5, unitLabel: "u" }] } } }
            : p,
      ),
    });
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);
    const after = lineOf(BURGER);
    expect(after.unitCostUgx).toBe(line.unitCostUgx);
    expect(after.cogsUgx).toBe(line.cogsUgx);
    expect(after.unitPriceUgx).toBe(line.unitPriceUgx);
    expect(after.lineTotalUgx).toBe(line.lineTotalUgx);
    expect(after.ingredientConsumption).toEqual(line.ingredientConsumption);
    // ...and the credit used the ORIGINAL consumption (3), not today's recipe (5 per burger)
    expect(stock(BEEF)).toBe(OPENING[BEEF]);
  });

  it("a second void of the same line is refused and credits nothing more", () => {
    sellMixed();
    const idx = lineIndexOf(BURGER);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: idx, reason: "wrong_item" }).ok).toBe(true);
    const after = snapshotStock();
    const movements = st().stockMovements.length;
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: idx, reason: "wrong_item" }).ok).toBe(false);
    expect(snapshotStock()).toEqual(after);
    expect(st().stockMovements).toHaveLength(movements);
  });

  it("a stale copy of the sale (line not yet marked voided) cannot be reversed a second time", () => {
    sellMixed();
    const idx = lineIndexOf(BURGER);
    const stale = JSON.parse(JSON.stringify(sale()));
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: idx, reason: "wrong_item" }).ok).toBe(true);
    const after = snapshotStock();
    // another device's older copy of the sale wins the merge (line looks live again), the void record stays
    usePosStore.setState({ sales: st().sales.map((s) => (s.id === stale.id ? stale : s)) });
    expect(st().voidSaleLine({ saleId: stale.id, lineIndex: idx, reason: "wrong_item" }).ok).toBe(false);
    expect(snapshotStock()).toEqual(after);
  });
});

describe("partial returns and voids of a made-to-order line", () => {
  // (a differing refund per call keeps the duplicate-submit guard from treating repeats as one double-tap)
  let refundStep = 0;
  const ret = (qty: number, reason: "wrong_item" | "damaged" = "wrong_item") =>
    st().returnProduct({ saleId: sale().id, productId: BURGER, quantity: qty, refundAmountUgx: 20_000 * qty - 100 * ++refundStep, reason, note: "n" });

  it("returning 1 of 3 gives back exactly 1 burger's ingredients — not the dish, not the drink, not the chicken", () => {
    sellMixed();
    const before = snapshotStock();
    expect(ret(1).ok).toBe(true);
    expect(stock(BEEF)).toBe(before[BEEF]! + 1);
    expect(stock(BUN)).toBe(before[BUN]! + 1);
    expect(stock(SAUCE)).toBe(before[SAUCE]! + 1);
    expect(stock(BURGER)).toBe(0);
    expect(stock(COKE)).toBe(before[COKE]);
    expect(chickenBatch().remainingPortions).toBe(18);
    expect(stock(CH_A)).toBe(before[CH_A]);
  });

  it("return, return, then void the rest: the credits sum to exactly the original consumption", () => {
    sellMixed();
    refundStep = 0;
    expect(ret(1).ok).toBe(true);
    expect(ret(1).ok).toBe(true);
    expect(stock(BEEF)).toBe(OPENING[BEEF]! - 1);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);
    expect(stock(BEEF)).toBe(OPENING[BEEF]);
    expect(stock(BUN)).toBe(OPENING[BUN]);
    expect(stock(SAUCE)).toBe(OPENING[SAUCE]);
    expect(stock(BURGER)).toBe(0);
    // nothing left to give back
    const after = snapshotStock();
    expect(ret(1).ok).toBe(false);
    expect(snapshotStock()).toEqual(after);
  });

  it("an unsellable return reason (damaged) restocks nothing — dish or ingredients", () => {
    sellMixed();
    const before = snapshotStock();
    expect(ret(1, "damaged").ok).toBe(true);
    expect(snapshotStock()).toEqual(before);
    expect(st().returnRecords).toHaveLength(1); // the refund itself is still recorded
  });

  it("fractional recipes never drift: 3 single-unit returns sum to the consumed quantity exactly", () => {
    const third = makeBurger();
    third.menu!.recipe = { yieldQty: 1, lines: [{ ingredientProductId: BEEF, quantityBase: 0.3333, unitLabel: "u" }] };
    seed();
    usePosStore.setState({ products: st().products.map((p) => (p.id === BURGER ? third : p)) });
    usePosStore.setState({ draftLines: [qtyLine(third, 3, "l1")] });
    expect(finalizeRetail().ok).toBe(true);
    const consumed = OPENING[BEEF]! - stock(BEEF);
    expect(consumed).toBeCloseTo(0.9999, 4);
    for (let i = 0; i < 3; i++) expect(ret(1).ok).toBe(true);
    expect(stock(BEEF)).toBeCloseTo(OPENING[BEEF]!, 4);
  });

  it("the pure reversal math is cumulative and capped", () => {
    const line = { quantity: 3, ingredientConsumption: [{ productId: BEEF, quantity: 1 }] };
    const parts = [0, 1, 2].map((done) => ingredientReversalFor(line, 1, done)[0]!.quantity);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(ingredientReversalFor(line, 5, 0)[0]!.quantity).toBe(1); // capped at the consumption
    expect(ingredientReversalFor(line, 1, 3)).toEqual([]); // nothing left
  });
});

describe("whole-bill void of a mixed table bill", () => {
  function settleMixedTable() {
    seed();
    usePosStore.setState({
      preferences: {
        ...st().preferences,
        businessType: "hospitality",
        hospitalityModeEnabled: true,
        hospitalityFloor: defaultHospitalityFloor(),
        hospitalityServiceChargePercent: 0,
        hospitalityTaxEnabled: false,
      },
    });
    expect(st().prepareMenuBatch({ productId: CHICKEN_DISH, portions: 20, batchId: "b1" }).ok).toBe(true);
    const floor = st().preferences.hospitalityFloor!;
    const opened = st().openTable({ tableId: floor.tables[0]!.id, guestCount: 3 });
    expect(opened.ok).toBe(true);
    const sessionId = (opened as { sessionId: string }).sessionId;
    expect(st().addHospitalityDraftLine({ product: product(BURGER), quantity: 3 }).ok).toBe(true);
    expect(st().addHospitalityDraftLine({ product: product(COKE), quantity: 2 }).ok).toBe(true);
    expect(st().addHospitalityDraftLine({ product: product(CHICKEN_DISH), quantity: 2 }).ok).toBe(true);
    st().saveTableBill();
    expect(st().recordTableBillPayment({ method: "cash", amountUgx: 84_000 }).ok).toBe(true);
    expect(st().finalizeTableBill().ok).toBe(true);
    return { sessionId, saleId: sale().id };
  }

  it("reverses each line by ITS OWN model: ingredients / finished stock / prepared portions", () => {
    const { sessionId } = settleMixedTable();
    expect(stock(BEEF)).toBe(97);
    expect(stock(COKE)).toBe(48);
    expect(chickenBatch().remainingPortions).toBe(18);
    const rawChicken = stock(CH_A);

    expect(st().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);

    expect(stock(BEEF)).toBe(OPENING[BEEF]);
    expect(stock(BUN)).toBe(OPENING[BUN]);
    expect(stock(SAUCE)).toBe(OPENING[SAUCE]);
    expect(stock(BURGER)).toBe(0); // made-to-order: no phantom dish
    expect(stock(COKE)).toBe(OPENING[COKE]); // retail: finished stock back
    expect(chickenBatch().remainingPortions).toBe(20); // batch-prepared: exact PrepBatch portions back
    expect(stock(CH_A)).toBe(rawChicken); // ...and raw ingredients of a batch dish never restored
  });

  it("cannot be replayed", () => {
    const { sessionId } = settleMixedTable();
    expect(st().voidSettledTableBill({ sessionId, reason: "x", managerPin: "" }).ok).toBe(true);
    const after = snapshotStock();
    const movements = st().stockMovements.length;
    expect(st().voidSettledTableBill({ sessionId, reason: "again", managerPin: "" }).ok).toBe(false);
    expect(snapshotStock()).toEqual(after);
    expect(st().stockMovements).toHaveLength(movements);
  });

  it("after a partial return, the whole-bill void gives back only the remainder", () => {
    const { sessionId, saleId } = settleMixedTable();
    expect(
      st().returnProduct({ saleId, productId: BURGER, quantity: 1, refundAmountUgx: 20_000, reason: "wrong_item", note: "n" }).ok,
    ).toBe(true);
    expect(stock(BEEF)).toBe(98);
    expect(st().voidSettledTableBill({ sessionId, reason: "wrong table", managerPin: "" }).ok).toBe(true);
    expect(stock(BEEF)).toBe(OPENING[BEEF]);
    expect(stock(BUN)).toBe(OPENING[BUN]);
  });

  it("the shift books the void once, like any retail void (revenue stays gross, void and cash reversed)", () => {
    const { sessionId } = settleMixedTable();
    const shift = () => (st().preferences.shifts ?? [])[0]!;
    expect(shift().salesTotalUgx).toBe(84_000);
    expect(st().voidSettledTableBill({ sessionId, reason: "x", managerPin: "" }).ok).toBe(true);
    expect(shift().salesTotalUgx).toBe(84_000);
    expect(shift().voidsTotalUgx).toBe(84_000);
    expect(shift().estimatedCashUgx).toBe(0);
  });
});

describe("the cloud void ledger is untouched (sold product + quantity + amount)", () => {
  it("a single-line void queues ONE cloud void for the SOLD dish — never for an ingredient", () => {
    sellMixed();
    vi.mocked(syncEngine.enqueueSync).mockClear();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);
    const ops = enqueued();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.payload).toMatchObject({ productId: BURGER, delta: 3, referenceType: "sale_void", amountUgx: 60_000, saleId: sale().id });
    expect(ops.some((o) => [BEEF, BUN, SAUCE].includes(String(o.payload.productId)))).toBe(false);
  });

  it("a whole-bill void queues one cloud void per voided line, keyed on the sold product (not on local ingredient movements)", () => {
    sellMixed();
    vi.mocked(syncEngine.enqueueSync).mockClear();
    const sessionless = st().voidSettledTableBill({ sessionId: "none", reason: "x", managerPin: "" });
    expect(sessionless.ok).toBe(false); // (retail sale without a table session cannot use the table route)
    // drive the shared planner exactly as the table route does
    return import("./voidCompletedSale").then(({ planWholeBillVoid }) => {
      const planned = planWholeBillVoid({
        sale: sale(),
        products: st().products,
        customers: [],
        shopKey: "shop",
        at: new Date().toISOString(),
        reason: "other",
        note: "x",
        actorUserId: "owner:1",
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const { plan } = planned;
      expect(plan.voidRecords.map((v) => [v.productId, v.quantity]).sort()).toEqual([
        [BURGER, 3],
        [CHICKEN_DISH, 2],
        [COKE, 2],
      ]);
      // the local ledger, in contrast, carries ingredient credits for the burger
      const burgerRec = plan.voidRecords.find((v) => v.productId === BURGER)!;
      const burgerMoves = plan.movements.filter((m) => m.refId === burgerRec.id);
      expect(burgerMoves.map((m) => m.productId).sort()).toEqual([BEEF, BUN, SAUCE]);
      expect(plan.products.find((p) => p.id === BURGER)!.stockOnHand).toBe(0);
    });
  });

  it("the table route queues cloud voids from the void records", () => {
    seed();
    usePosStore.setState({
      preferences: { ...st().preferences, businessType: "hospitality", hospitalityModeEnabled: true, hospitalityFloor: defaultHospitalityFloor(), hospitalityServiceChargePercent: 0, hospitalityTaxEnabled: false },
    });
    const floor = st().preferences.hospitalityFloor!;
    const opened = st().openTable({ tableId: floor.tables[0]!.id, guestCount: 2 });
    const sessionId = (opened as { sessionId: string }).sessionId;
    st().addHospitalityDraftLine({ product: product(BURGER), quantity: 2 });
    st().addHospitalityDraftLine({ product: product(COKE), quantity: 1 });
    st().saveTableBill();
    st().recordTableBillPayment({ method: "cash", amountUgx: 42_000 });
    expect(st().finalizeTableBill().ok).toBe(true);
    vi.mocked(syncEngine.enqueueSync).mockClear();
    expect(st().voidSettledTableBill({ sessionId, reason: "x", managerPin: "" }).ok).toBe(true);
    const ops = enqueued();
    expect(ops.map((o) => [o.payload.productId, o.payload.delta]).sort()).toEqual([
      [BURGER, 2],
      [COKE, 1],
    ]);
    for (const o of ops) expect(o.payload).toMatchObject({ referenceType: "sale_void", saleId: sale().id });
    expect(ops.every((o) => Number(o.payload.amountUgx) > 0)).toBe(true);
  });
});

describe("the inventory ledger stays reconciled with stock", () => {
  it("sale -> partial return -> void: Σ(movements) == stock for every product, ingredients and dish included", () => {
    sellMixed();
    expect(
      st().returnProduct({ saleId: sale().id, productId: BURGER, quantity: 1, refundAmountUgx: 20_000, reason: "wrong_item", note: "n" }).ok,
    ).toBe(true);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(COKE), reason: "wrong_item" }).ok).toBe(true);
    const s = st();
    const result = verifyInventoryIntegrity({
      products: s.products,
      movements: s.stockMovements,
      archivedMovements: s.archivedStockMovements,
      openingStockByProduct: { ...OPENING, [CHICKEN_DISH]: 0 },
    });
    expect(result.mismatches).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("compatibility", () => {
  it("a line sold before provenance existed keeps the previous behaviour exactly (nothing is guessed from today's recipe)", () => {
    sellMixed();
    usePosStore.setState({
      sales: st().sales.map((s) => ({ ...s, lines: s.lines.map((l) => (l.productId === BURGER ? { ...l, ingredientConsumption: undefined } : l)) })),
    });
    const before = snapshotStock();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(BURGER), reason: "wrong_item" }).ok).toBe(true);
    expect(stock(BEEF)).toBe(before[BEEF]); // no ingredient guess
    expect(stock(BURGER)).toBe(3); // legacy: finished-dish credit (mirrors what the cloud deducted for it)
  });

  it("retail line void is unchanged", () => {
    sellMixed();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(COKE), reason: "wrong_item" }).ok).toBe(true);
    expect(stock(COKE)).toBe(OPENING[COKE]);
    expect(stock(BEEF)).toBe(97);
  });

  it("batch-prepared line void is unchanged (portions back, raw ingredients untouched)", () => {
    sellMixed();
    const raw = stock(CH_A);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIndexOf(CHICKEN_DISH), reason: "wrong_item" }).ok).toBe(true);
    expect(chickenBatch().remainingPortions).toBe(20);
    expect(stock(CH_A)).toBe(raw);
    expect(stock(BEEF)).toBe(97);
  });
});

describe("provenance travels with the sale to other devices", () => {
  const line: SaleLine = {
    ...qtyLine(makeBurger(), 3, "line-1"),
    ingredientConsumption: [
      { productId: BEEF, quantity: 3 },
      { productId: BUN, quantity: 3 },
    ],
  };

  it("survives the cloud encode/decode round trip", () => {
    const decoded = decodeSaleLineFromCloud(encodeSaleLineForCloud(line));
    expect(decoded.ingredientConsumption).toEqual(line.ingredientConsumption);
  });

  it("an empty provenance (nothing was on the shelf) still marks the line as made-to-order", () => {
    const decoded = decodeSaleLineFromCloud(encodeSaleLineForCloud({ ...line, ingredientConsumption: [] }));
    expect(decoded.ingredientConsumption).toEqual([]);
  });

  it("legacy or malformed metadata decodes as 'no provenance' (never a guess)", () => {
    const legacy = decodeSaleLineFromCloud(encodeSaleLineForCloud({ ...line, ingredientConsumption: undefined }));
    expect(legacy.ingredientConsumption).toBeUndefined();
    const row = encodeSaleLineForCloud(line);
    for (const bad of ["x", [{ productId: "", quantity: 1 }], [{ productId: BEEF, quantity: -2 }], [null]]) {
      expect(decodeSaleLineFromCloud({ ...row, metadata: { ...row.metadata, ingredientConsumption: bad } }).ingredientConsumption).toBeUndefined();
    }
  });
});
