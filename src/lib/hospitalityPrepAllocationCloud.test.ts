/**
 * Phase 6 — batch-prepared provenance travels with the sale.
 *
 * A batch-prepared sale freezes WHICH PrepBatches its portions came from (`prepAllocation`, FIFO).
 * That used to live only on the selling device: another device that pulled the sale from the cloud had no
 * allocation, so its void/return fell back to crediting the newest batch — the wrong one, and possibly
 * past what the batch ever held. The allocation now rides in `sale_line_items.metadata` (the cloud stores
 * it verbatim and never applies batch state itself — finished portions are restored by the existing,
 * bounded void/return RPCs), and every restore is validated on the receiving side.
 *
 * "Device B" below is built the way the app builds it: the sale's lines go through the REAL cloud
 * encode/decode round trip before B voids or returns anything.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../offline/syncEngine";
import type { Product, Sale, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { buildSalePushPayload } from "../offline/cloudSync";
import { creditPrepAllocation, restorePrepBatchesForReversal } from "./recipeEngine";
import { decodePrepAllocation, decodeSaleLineFromCloud, encodeSaleLineForCloud, roundTripSaleLineThroughCloud } from "./saleLineCloudCodec";

const DISH = "dish-1";
const A = "ing-a";
const B = "ing-b";
const COKE = "coke";
const BURGER = "burger";
const BEEF = "beef";

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

function makeDish(): Product {
  return base({
    id: DISH,
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
          { ingredientProductId: A, quantityBase: 40, unitLabel: "u" },
          { ingredientProductId: B, quantityBase: 20, unitLabel: "u" },
        ],
      },
      modifierGroups: [],
      variants: [],
    },
  });
}
const burger = base({
  id: BURGER,
  name: "Burger",
  sellingPricePerUnitUgx: 20_000,
  costPricePerUnitUgx: 0,
  stockOnHand: 0,
  menu: {
    productKind: "finished_menu",
    prepMode: "made_to_order",
    recipe: { yieldQty: 1, lines: [{ ingredientProductId: BEEF, quantityBase: 1, unitLabel: "u" }] },
    modifierGroups: [],
    variants: [],
  },
});
const coke = base({ id: COKE, name: "Coke", sellingPricePerUnitUgx: 2_000, costPricePerUnitUgx: 1_200, stockOnHand: 50, baseUnit: "bottle", category: "Drinks" });

const L_BATCH = "bbbbbbbb-0000-4000-8000-000000000001";
const L_OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const st = () => usePosStore.getState();
const product = (id: string) => st().products.find((p) => p.id === id)!;
const dish = () => product(DISH);
const batch = (id: string) => (dish().menu?.prepBatches ?? []).find((b) => b.id === id)!;
const batchesRemaining = () => Object.fromEntries((dish().menu?.prepBatches ?? []).map((b) => [b.id, b.remainingPortions]));
const sumRemaining = () => (dish().menu?.prepBatches ?? []).reduce((n, b) => n + b.remainingPortions, 0);
const sale = () => st().sales.find((s) => s.status === "completed")!;

const line = (p: Product, quantity: number, id: string): SaleLine => ({
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

function seed(extraProducts: Product[] = []) {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [ing(A, 1_000), ing(B, 500), ing(BEEF, 8_000), makeDish(), { ...coke }, { ...burger }, ...extraProducts],
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

const prepare = (id: string, portions: number) => expect(st().prepareMenuBatch({ productId: DISH, portions, batchId: id }).ok).toBe(true);
const finalize = () => expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);

/** Device A sold; now become Device B: same catalog state, but the sale arrives THROUGH THE CLOUD CODEC. */
function becomeDeviceB(opts: { dropAllocation?: boolean } = {}) {
  const s = sale();
  const pulled: Sale = {
    ...s,
    pendingSync: false,
    lines: s.lines.map((l) => {
      const viaCloud = roundTripSaleLineThroughCloud(l);
      return opts.dropAllocation ? { ...viaCloud, prepAllocation: undefined } : viaCloud;
    }),
  };
  usePosStore.setState({ sales: [pulled], voidRecords: [], returnRecords: [], stockMovements: [] });
  return pulled;
}

let refundStep = 0;
const ret = (productId: string, qty: number, unit: number, lineId?: string) =>
  st().returnProduct({
    saleId: sale().id,
    productId,
    quantity: qty,
    refundAmountUgx: unit * qty - ++refundStep,
    reason: "wrong_item",
    note: "n",
    ...(lineId ? { saleLineId: lineId } : {}),
  });
const voidLine = (idx: number) => st().voidSaleLine({ saleId: sale().id, lineIndex: idx, reason: "wrong_item" });
const idxOf = (id: string) => sale().lines.findIndex((l) => l.id === id);

beforeEach(() => {
  refundStep = 0;
  vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("the allocation travels through the cloud", () => {
  it("is written into the line metadata the RPC stores verbatim, and read back on the other device", () => {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    const l = sale().lines[0]!;
    expect(l.prepAllocation).toEqual([{ batchId: "b1", portions: 10 }, { batchId: "b2", portions: 2 }]);
    const payload = buildSalePushPayload(sale(), { shopId: "s", userId: "u" });
    const meta = (payload.lines as Array<{ metadata: Record<string, unknown> }>)[0]!.metadata;
    expect(meta.prepAllocation).toEqual(l.prepAllocation);
    expect(roundTripSaleLineThroughCloud(l).prepAllocation).toEqual(l.prepAllocation);
  });

  it("retail and made-to-order lines send none", () => {
    seed();
    usePosStore.setState({ draftLines: [line(product(COKE), 2, "l1"), line(product(BURGER), 1, "l2")] });
    finalize();
    const payload = buildSalePushPayload(sale(), { shopId: "s", userId: "u" });
    for (const l of payload.lines as Array<{ metadata: Record<string, unknown> }>) expect(l.metadata).not.toHaveProperty("prepAllocation");
  });

  it("malformed or inconsistent provenance reads as 'none' — never as a guess", () => {
    const row = (a: unknown) => ({ ...encodeSaleLineForCloud({ ...line(dish(), 12, "l") }), metadata: { prepAllocation: a } });
    const cases: unknown[] = [
      "x",
      [],
      [{ batchId: "", portions: 12 }],
      [{ batchId: "b1", portions: -12 }],
      [{ batchId: "b1", portions: "12" as unknown as number }],
      [null],
      [{ batchId: "b1", portions: 5 }], // sums to 5, the line sold 12
      [{ batchId: "b1", portions: 13 }], // sums to more than was sold
    ];
    for (const c of cases) expect(decodeSaleLineFromCloud(row(c) as never).prepAllocation).toBeUndefined();
    expect(decodePrepAllocation([{ batchId: "b1", portions: 7 }, { batchId: "b2", portions: 5 }], 12)).toEqual([
      { batchId: "b1", portions: 7 },
      { batchId: "b2", portions: 5 },
    ]);
  });
});

describe("Device B restores the EXACT originating batches", () => {
  it("one batch", () => {
    seed();
    prepare("b1", 10);
    usePosStore.setState({ draftLines: [line(dish(), 4, "l1")] });
    finalize();
    becomeDeviceB();
    expect(batchesRemaining()).toEqual({ b1: 6 });
    expect(voidLine(0).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 10 });
    expect(dish().stockOnHand).toBe(10);
  });

  it("two FIFO batches: A=10, B=2 come back as A=10, B=2 — not 'the newest batch'", () => {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    expect(batchesRemaining()).toEqual({ b1: 0, b2: 8 });
    becomeDeviceB();
    expect(voidLine(0).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 10, b2: 10 });
    expect(batch("b1").status).toBe("active");
    expect(dish().stockOnHand).toBe(20);
    expect(sumRemaining()).toBe(dish().stockOnHand); // provenance and finished stock reconcile
  });

  it("three FIFO batches", () => {
    seed();
    prepare("b1", 5);
    prepare("b2", 5);
    prepare("b3", 5);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    expect(sale().lines[0]!.prepAllocation).toEqual([{ batchId: "b1", portions: 5 }, { batchId: "b2", portions: 5 }, { batchId: "b3", portions: 2 }]);
    becomeDeviceB();
    expect(voidLine(0).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 5, b2: 5, b3: 5 });
  });

  it("partial sale and full sale (which depletes the batch)", () => {
    seed();
    prepare("b1", 10);
    usePosStore.setState({ draftLines: [line(dish(), 10, "l1")] });
    finalize();
    expect(batch("b1").status).toBe("depleted");
    becomeDeviceB();
    expect(voidLine(0).ok).toBe(true);
    expect(batch("b1").remainingPortions).toBe(10);
    expect(batch("b1").status).toBe("active");
  });

  it("partial return, then void of the rest: each batch ends exactly where it started", () => {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    becomeDeviceB();
    expect(ret(DISH, 4, 10_000).ok).toBe(true);
    // the last-consumed portions come back first: 2 from b2, 2 from b1
    expect(batchesRemaining()).toEqual({ b1: 2, b2: 10 });
    expect(voidLine(0).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 10, b2: 10 });
    expect(sumRemaining()).toBe(dish().stockOnHand);
  });

  it("a repeated void restores nothing more (offline retry / replay)", () => {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    becomeDeviceB();
    expect(voidLine(0).ok).toBe(true);
    const after = batchesRemaining();
    const moves = st().stockMovements.length;
    expect(voidLine(0).ok).toBe(false);
    expect(batchesRemaining()).toEqual(after);
    expect(st().stockMovements).toHaveLength(moves);
  });

  it("a stale copy of the sale (line not yet voided) cannot restore the batches a second time", () => {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    const stale = becomeDeviceB();
    expect(voidLine(0).ok).toBe(true);
    const after = batchesRemaining();
    usePosStore.setState({ sales: [stale] }); // another device's older copy wins the merge
    expect(voidLine(0).ok).toBe(false);
    expect(batchesRemaining()).toEqual(after);
  });
});

describe("same product, several lines", () => {
  function sellTwoLines() {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 8, "aaaaaaaa-0000-4000-8000-000000000001"), line(dish(), 6, "aaaaaaaa-0000-4000-8000-000000000002")] });
    finalize();
    return becomeDeviceB();
  }
  it("each line frees its OWN batches: line 2 = b1×2 + b2×4, line 1 = b1×8", () => {
    sellTwoLines();
    expect(sale().lines.map((l) => l.prepAllocation)).toEqual([[{ batchId: "b1", portions: 8 }], [{ batchId: "b1", portions: 2 }, { batchId: "b2", portions: 4 }]]);
    expect(batchesRemaining()).toEqual({ b1: 0, b2: 6 });
    expect(voidLine(1).ok).toBe(true); // line 2 first
    expect(batchesRemaining()).toEqual({ b1: 2, b2: 10 });
    expect(voidLine(0).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 10, b2: 10 });
  });

  it("a return aimed at line 2 does not touch line 1's batch portions", () => {
    sellTwoLines();
    const l2 = sale().lines[1]!.id!;
    expect(ret(DISH, 6, 10_000, l2).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 2, b2: 10 });
  });
});

describe("mixed sales", () => {
  it("batch-prepared + made-to-order: portions to their batches, ingredients to the shelf", () => {
    seed();
    prepare("b1", 10);
    usePosStore.setState({ draftLines: [line(dish(), 4, L_BATCH), line(product(BURGER), 2, L_OTHER)] });
    finalize();
    const beefAfterSale = product(BEEF).stockOnHand;
    becomeDeviceB();
    expect(voidLine(idxOf(L_BATCH)).ok).toBe(true);
    expect(voidLine(idxOf(L_OTHER)).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 10 });
    expect(product(BEEF).stockOnHand).toBe(beefAfterSale + 2);
    expect(product(BURGER).stockOnHand).toBe(0);
  });

  it("batch-prepared + retail", () => {
    seed();
    prepare("b1", 10);
    usePosStore.setState({ draftLines: [line(dish(), 4, L_BATCH), line(product(COKE), 2, L_OTHER)] });
    finalize();
    becomeDeviceB();
    expect(voidLine(idxOf(L_BATCH)).ok).toBe(true);
    expect(voidLine(idxOf(L_OTHER)).ok).toBe(true);
    expect(batchesRemaining()).toEqual({ b1: 10 });
    expect(product(COKE).stockOnHand).toBe(50);
  });
});

describe("legacy sale with no allocation", () => {
  it("keeps the previous behaviour (newest open batch) — never a reconstruction from today's FIFO — and never exceeds what was prepared", () => {
    seed();
    prepare("b1", 10);
    prepare("b2", 10);
    usePosStore.setState({ draftLines: [line(dish(), 12, "l1")] });
    finalize();
    becomeDeviceB({ dropAllocation: true });
    expect(sale().lines[0]!.prepAllocation).toBeUndefined();
    expect(voidLine(0).ok).toBe(true);
    // legacy: the newest batch takes it back — but capped at the 10 it ever held (the old code let it reach 8+12=20)
    expect(batch("b2").remainingPortions).toBe(10);
    expect(batch("b1").remainingPortions).toBe(0);
    expect(dish().stockOnHand).toBe(20); // finished stock is still restored in full
  });
});

describe("restore-side validation", () => {
  it("a batch of another dish, or a written-off batch, is never credited", () => {
    const p: Product = {
      ...makeDish(),
      menu: {
        ...makeDish().menu!,
        prepBatches: [
          { id: "foreign", menuProductId: "some-other-dish", preparedAt: "t", portionsPrepared: 10, remainingPortions: 0, unitCostUgx: 1, status: "active", createdAt: "t", updatedAt: "t" },
          { id: "wasted", menuProductId: DISH, preparedAt: "t", portionsPrepared: 10, remainingPortions: 0, unitCostUgx: 1, status: "wasted", createdAt: "t", updatedAt: "t" },
        ],
      },
    };
    expect(creditPrepAllocation(p, [{ batchId: "foreign", portions: 5 }, { batchId: "wasted", portions: 5 }], "now")).toBeNull();
  });

  it("a credit can never lift a batch above the portions it was prepared with", () => {
    const p: Product = {
      ...makeDish(),
      menu: {
        ...makeDish().menu!,
        prepBatches: [{ id: "b", menuProductId: DISH, preparedAt: "t", portionsPrepared: 10, remainingPortions: 8, unitCostUgx: 1, status: "active", createdAt: "t", updatedAt: "t" }],
      },
    };
    const out = creditPrepAllocation(p, [{ batchId: "b", portions: 9 }], "now")!;
    expect(out.menu!.prepBatches![0]!.remainingPortions).toBe(10);
    const legacy = restorePrepBatchesForReversal({ ...p, stockOnHand: 8 }, { prepAllocation: null }, 9, 0, "now");
    expect(legacy.menu!.prepBatches![0]!.remainingPortions).toBe(10);
  });

  it("an allocation naming a batch this device does not have restores what it can and invents nothing", () => {
    seed();
    prepare("b1", 10);
    usePosStore.setState({ draftLines: [line(dish(), 4, "l1")] });
    finalize();
    becomeDeviceB();
    // this device never received batch b1 (its catalog copy has no batches)
    usePosStore.setState({ products: st().products.map((p) => (p.id === DISH ? { ...p, menu: { ...p.menu!, prepBatches: [] } } : p)) });
    expect(voidLine(0).ok).toBe(true);
    expect(dish().menu!.prepBatches).toEqual([]);
    expect(dish().stockOnHand).toBe(10); // finished stock is still restored
  });
});

describe("older batch records", () => {
  it("a batch without a known prepared quantity is credited exactly (no NaN, no cap to invent)", () => {
    const p: Product = {
      ...makeDish(),
      menu: {
        ...makeDish().menu!,
        prepBatches: [{ id: "old", menuProductId: DISH, preparedAt: "t", remainingPortions: 3, unitCostUgx: 1, status: "active", createdAt: "t", updatedAt: "t" } as never],
      },
    };
    const out = creditPrepAllocation(p, [{ batchId: "old", portions: 2 }], "now")!;
    expect(out.menu!.prepBatches![0]!.remainingPortions).toBe(5);
  });
});
