/**
 * Phase 5 — one sale, one product, SEVERAL lines (other variant / modifiers).
 *
 * Returns and voids used to be matched by (sale, product): they read the FIRST line's quantity and
 * amount, so voiding the second line of a product took the first line's numbers, and a return could not
 * say which line — or which line's recipe — it came from. Every reversal is now bound to the sale line
 * (id), with the previous behaviour kept for callers/records that name no line.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as syncEngine from "../offline/syncEngine";
import type { Product, ReturnRecord, Sale, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import { planWholeBillVoid } from "./voidCompletedSale";
import { remainingReturnableQuantity, remainingVoidableLine } from "./returnLimits";

const BEEF = "beef";
const BUN = "bun";
const CHEESE = "cheese";
const BURGER = "burger";
const L1 = "aaaaaaaa-0000-4000-8000-000000000001"; // base burger x3 @ 20,000
const L2 = "aaaaaaaa-0000-4000-8000-000000000002"; // large burger x2 @ 25,000 (its own recipe)

const ing = (id: string, cost: number): Product => ({
  id,
  name: id,
  sellingMode: "unit",
  baseUnit: "u",
  sellingPricePerUnitUgx: 10_000,
  costPricePerUnitUgx: cost,
  stockOnHand: 100,
  minimumStockAlert: 0,
  category: "Ingredients",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
  menu: { productKind: "ingredient" },
});

const burger: Product = {
  id: BURGER,
  name: "Burger",
  sellingMode: "unit",
  baseUnit: "pcs",
  sellingPricePerUnitUgx: 20_000,
  costPricePerUnitUgx: 0,
  stockOnHand: 0,
  minimumStockAlert: 0,
  category: "Food",
  sku: "",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
  menu: {
    productKind: "finished_menu",
    prepMode: "made_to_order",
    recipe: {
      yieldQty: 1,
      lines: [
        { ingredientProductId: BEEF, quantityBase: 1, unitLabel: "u" },
        { ingredientProductId: BUN, quantityBase: 1, unitLabel: "u" },
      ],
    },
    variants: [{ id: "regular", label: "Regular", priceUgx: 20_000, recipe: { yieldQty: 1, lines: [{ ingredientProductId: BEEF, quantityBase: 1, unitLabel: "u" }, { ingredientProductId: BUN, quantityBase: 1, unitLabel: "u" }] } }, { id: "large", label: "Large", priceUgx: 25_000, recipe: { yieldQty: 1, lines: [{ ingredientProductId: BEEF, quantityBase: 1, unitLabel: "u" }, { ingredientProductId: CHEESE, quantityBase: 1, unitLabel: "u" }] } }],
    modifierGroups: [],
  } as never,
};

const draft = (id: string, qty: number, unit: number, variantId: string | null, name: string): SaleLine => ({
  id,
  productId: BURGER,
  name,
  inputMode: "quantity",
  quantity: qty,
  unitPriceUgx: unit,
  unitCostUgx: 0,
  lineTotalUgx: unit * qty,
  estimatedProfitUgx: unit * qty,
  variantId,
  updatedAt: "2026-09-17T08:05:00.000Z",
});

const st = () => usePosStore.getState();
const stock = (id: string) => st().products.find((p) => p.id === id)!.stockOnHand;
const sale = () => st().sales.find((s) => s.status === "completed")!;
const lineIdx = (id: string) => sale().lines.findIndex((l) => l.id === id);

function sellTwoLines() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [ing(BEEF, 8_000), ing(BUN, 1_000), ing(CHEESE, 700), { ...burger }],
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
    draftLines: [draft(L1, 3, 20_000, "regular", "Burger (Regular)"), draft(L2, 2, 25_000, "large", "Burger (Large)")],
    draftCartDiscountUgx: 0,
    activePendingSaleId: null,
    draftInput: null,
    draftSaleCustomerId: "",
    draftSaleCustomerName: "",
    draftSaleCustomerPhone: "",
    draftPaymentMethod: "cash",
  });
  expect(openTestShift().ok).toBe(true);
  expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
}

let refundStep = 0;
const ret = (lineId: string | undefined, qty: number, unit: number) =>
  st().returnProduct({
    saleId: sale().id,
    productId: BURGER,
    quantity: qty,
    refundAmountUgx: unit * qty - ++refundStep,
    reason: "wrong_item",
    note: "n",
    ...(lineId ? { saleLineId: lineId } : {}),
  });

beforeEach(() => {
  refundStep = 0;
  vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("each line keeps its OWN provenance", () => {
  it("base line consumed beef+bun; large line consumed beef+cheese; the dish is untouched", () => {
    sellTwoLines();
    const l1 = sale().lines[lineIdx(L1)]!;
    const l2 = sale().lines[lineIdx(L2)]!;
    expect(l1.ingredientConsumption).toEqual([{ productId: BEEF, quantity: 3 }, { productId: BUN, quantity: 3 }]);
    expect(l2.ingredientConsumption).toEqual([{ productId: BEEF, quantity: 2 }, { productId: CHEESE, quantity: 2 }]);
    expect([stock(BEEF), stock(BUN), stock(CHEESE), stock(BURGER)]).toEqual([95, 97, 98, 0]);
  });
});

describe("partial returns are bound to a line", () => {
  it("return from line 1 gives back line 1's ingredients only, and the record names the line", () => {
    sellTwoLines();
    expect(ret(L1, 1, 20_000).ok).toBe(true);
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual([96, 98, 98]);
    expect(st().returnRecords[0]!.saleLineId).toBe(L1);
  });

  it("return from line 2 gives back line 2's ingredients (cheese) only", () => {
    sellTwoLines();
    expect(ret(L2, 1, 25_000).ok).toBe(true);
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual([96, 97, 99]);
    expect(st().returnRecords[0]!.saleLineId).toBe(L2);
  });

  it("no cross-line over-credit: line 2 has 1 unit left although the product has 3 — asking for 2 is refused and changes nothing", () => {
    sellTwoLines();
    expect(ret(L1, 1, 20_000).ok).toBe(true);
    expect(ret(L2, 1, 25_000).ok).toBe(true);
    const before = [stock(BEEF), stock(BUN), stock(CHEESE)];
    const res = ret(L2, 2, 25_000);
    expect(res.ok).toBe(false);
    expect(res.errorKey).toBe("returnExceedsQty");
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual(before);
    expect(st().returnRecords).toHaveLength(2);
  });

  it("without a line id the return goes to the product's first active line (previous behaviour) and is stamped", () => {
    sellTwoLines();
    expect(ret(undefined, 1, 20_000).ok).toBe(true);
    expect(st().returnRecords[0]!.saleLineId).toBe(L1);
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual([96, 98, 98]);
  });

  it("an unknown or foreign line id is refused", () => {
    sellTwoLines();
    expect(ret("aaaaaaaa-0000-4000-8000-0000000000ff", 1, 20_000).ok).toBe(false);
  });
});

describe("voiding a line takes THAT line's quantity and amount", () => {
  it("voiding line 2 first uses line 2's own 2 × 25,000 (it used to take line 1's 3 × 20,000)", () => {
    sellTwoLines();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L2), reason: "wrong_item" }).ok).toBe(true);
    const rec = st().voidRecords[0]!;
    expect([rec.quantity, rec.amountUgx, rec.saleLineId]).toEqual([2, 50_000, L2]);
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual([97, 97, 100]); // line 2's beef + cheese back
    expect(sale().lines[lineIdx(L1)]!.voided).toBeFalsy();
  });

  it("void remaining after a partial return: only what is left of THAT line", () => {
    sellTwoLines();
    expect(ret(L1, 1, 20_000).ok).toBe(true);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L1), reason: "wrong_item" }).ok).toBe(true);
    const rec = st().voidRecords[0]!;
    expect([rec.quantity, rec.saleLineId]).toEqual([2, L1]);
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual([98, 100, 98]); // line 1 fully back; line 2 untouched
  });

  it("both lines returned and voided in a mixed order end exactly at the opening stock — nothing extra, nothing missing", () => {
    sellTwoLines();
    expect(ret(L2, 1, 25_000).ok).toBe(true);
    expect(ret(L1, 2, 20_000).ok).toBe(true);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L1), reason: "wrong_item" }).ok).toBe(true);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L2), reason: "wrong_item" }).ok).toBe(true);
    expect([stock(BEEF), stock(BUN), stock(CHEESE), stock(BURGER)]).toEqual([100, 100, 100, 0]);
    // and nothing more can be reversed on either line
    const after = [stock(BEEF), stock(BUN), stock(CHEESE)];
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L1), reason: "wrong_item" }).ok).toBe(false);
    expect(ret(L2, 1, 25_000).ok).toBe(false);
    expect([stock(BEEF), stock(BUN), stock(CHEESE)]).toEqual(after);
  });

  it("the historical sale lines (price, unit cost, COGS, provenance) never change", () => {
    sellTwoLines();
    const before = JSON.parse(JSON.stringify(sale().lines)) as SaleLine[];
    expect(ret(L1, 1, 20_000).ok).toBe(true);
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L2), reason: "wrong_item" }).ok).toBe(true);
    for (const b of before) {
      const a = sale().lines.find((l) => l.id === b.id)!;
      expect([a.unitPriceUgx, a.unitCostUgx, a.cogsUgx, a.lineTotalUgx, a.ingredientConsumption]).toEqual([
        b.unitPriceUgx,
        b.unitCostUgx,
        b.cogsUgx,
        b.lineTotalUgx,
        b.ingredientConsumption,
      ]);
    }
  });

  it("a whole-bill void reverses each line with its own line id", () => {
    sellTwoLines();
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
    expect(plan.voidRecords.map((v) => [v.saleLineId, v.quantity, v.amountUgx])).toEqual([
      [L1, 3, 60_000],
      [L2, 2, 50_000],
    ]);
    const stockOf = (id: string) => plan.products.find((p) => p.id === id)!.stockOnHand;
    expect([stockOf(BEEF), stockOf(BUN), stockOf(CHEESE), stockOf(BURGER)]).toEqual([100, 100, 100, 0]);
  });
});

describe("cloud payloads carry the line", () => {
  const enqueued = () =>
    (vi.mocked(syncEngine.enqueueSync).mock.calls as Array<[{ kind: string; payload: Record<string, unknown> }]>)
      .map((c) => c[0])
      .filter((o) => o.kind === "pending_stock_updates");

  it("a line void queues its line id and marks it a recipe line", () => {
    sellTwoLines();
    vi.mocked(syncEngine.enqueueSync).mockClear();
    expect(st().voidSaleLine({ saleId: sale().id, lineIndex: lineIdx(L2), reason: "wrong_item" }).ok).toBe(true);
    const ops = enqueued();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.payload).toMatchObject({ productId: BURGER, delta: 2, saleLineId: L2, recipeLine: true, amountUgx: 50_000 });
  });
});

describe("product-level behaviour is unchanged when no line is named (legacy data, single-line sales)", () => {
  const line = (id: string, qty: number, unit: number): SaleLine => ({
    id,
    productId: BURGER,
    name: "Burger",
    inputMode: "quantity",
    quantity: qty,
    unitPriceUgx: unit,
    unitCostUgx: 0,
    lineTotalUgx: unit * qty,
    estimatedProfitUgx: 0,
  });
  const mk = (lines: SaleLine[]): Sale => ({
    id: "sale-1",
    status: "completed",
    createdAt: "2026-09-17T08:00:00.000Z",
    subtotalUgx: lines.reduce((a, l) => a + l.lineTotalUgx, 0),
    totalUgx: lines.reduce((a, l) => a + l.lineTotalUgx, 0),
    cashPaidUgx: lines.reduce((a, l) => a + l.lineTotalUgx, 0),
    debtUgx: 0,
    estimatedProfitUgx: 0,
    pendingSync: false,
    lines,
  });
  const legacyReturn = (qty: number, refund: number): ReturnRecord => ({
    id: `r-${qty}`,
    saleId: "sale-1",
    productId: BURGER,
    productName: "Burger",
    quantity: qty,
    refundAmountUgx: refund,
    reason: "wrong_item",
    actorUserId: "u",
    createdAt: "2026-09-17T09:00:00.000Z",
  });

  it("single line: naming the line or not gives identical numbers, with or without legacy returns", () => {
    const s = mk([line("a", 3, 20_000)]);
    const records = [legacyReturn(1, 20_000)];
    expect(remainingVoidableLine(s, BURGER, records, "a")).toEqual(remainingVoidableLine(s, BURGER, records));
    expect(remainingReturnableQuantity(s, BURGER, records, 0, "a")).toBe(remainingReturnableQuantity(s, BURGER, records));
    expect(remainingVoidableLine(s, BURGER, [], "a")).toEqual(remainingVoidableLine(s, BURGER, []));
  });

  it("legacy returns (no line id) count against the FIRST active line only, as they always did", () => {
    const s = mk([line("a", 3, 20_000), line("b", 2, 25_000)]);
    const records = [legacyReturn(1, 20_000)];
    expect(remainingReturnableQuantity(s, BURGER, records, 0, "a")).toBe(2);
    expect(remainingReturnableQuantity(s, BURGER, records, 0, "b")).toBe(2); // unaffected
    expect(remainingReturnableQuantity(s, BURGER, records)).toBe(2); // product-level default = first line
  });

  it("with no line named, the first line's numbers are used (unchanged); naming line b uses b's", () => {
    const s = mk([line("a", 3, 20_000), line("b", 2, 25_000)]);
    expect(remainingVoidableLine(s, BURGER, [])).toEqual({ quantity: 3, amountUgx: 60_000 });
    expect(remainingVoidableLine(s, BURGER, [], "b")).toEqual({ quantity: 2, amountUgx: 50_000 });
  });

  it("a returned line's id is honoured even when it is not the first line", () => {
    const s = mk([line("a", 3, 20_000), line("b", 2, 25_000)]);
    const records: ReturnRecord[] = [{ ...legacyReturn(1, 25_000), saleLineId: "b" }];
    expect(remainingReturnableQuantity(s, BURGER, records, 0, "a")).toBe(3);
    expect(remainingReturnableQuantity(s, BURGER, records, 0, "b")).toBe(1);
  });
});
