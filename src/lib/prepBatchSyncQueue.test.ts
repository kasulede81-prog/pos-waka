import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, SaleLine } from "../types";
import { usePosStore } from "../store/usePosStore";
import { openTestShift } from "../test/shiftTestSetup";
import * as syncEngine from "../offline/syncEngine";
import type { PrepBatchSyncPayload } from "./prepBatchSync";

const DISH = "dish-q";
const ING = "ing-q";

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
    updatedAt: "2026-10-01T08:00:00.000Z",
    version: 1,
    ...partial,
  };
}

const ing = product({
  id: ING,
  name: "Ingredient",
  stockOnHand: 100,
  costPricePerUnitUgx: 500,
  menu: { productKind: "ingredient" },
});
const dish = product({
  id: DISH,
  name: "Batch dish",
  sellingPricePerUnitUgx: 15_000,
  baseUnit: "portion",
  menu: {
    productKind: "finished_menu",
    prepMode: "batch_prepared",
    recipe: { yieldQty: 10, lines: [{ ingredientProductId: ING, quantityBase: 5, unitLabel: "kg" }] },
    modifierGroups: [],
    variants: [],
  },
});

const line = (quantity: number, id: string): SaleLine => ({
  id,
  productId: DISH,
  name: dish.name,
  inputMode: "quantity",
  quantity,
  unitPriceUgx: 15_000,
  unitCostUgx: 0,
  lineTotalUgx: 15_000 * quantity,
  estimatedProfitUgx: 0,
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const st = () => usePosStore.getState();
let spy: import("vitest").MockInstance<typeof syncEngine.enqueueSync>;

function ops(): Array<{ kind: string; payload: Record<string, unknown>; id?: string }> {
  return spy.mock.calls.map((call) => call[0] as { kind: string; payload: Record<string, unknown>; id?: string });
}
const prepOps = () => ops().filter((o) => o.kind === "pending_prep_batches");
const prep = (kind: string) => prepOps().filter((o) => o.payload.kind === kind);
const stockOps = () => ops().filter((o) => o.kind === "pending_stock_updates");

function seed() {
  usePosStore.setState({
    _hydrated: true,
    sessionActor: { userId: "owner:1", role: "owner", displayName: "Owner" },
    products: [{ ...ing }, { ...dish }],
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
    preferences: {
      ...st().preferences,
      businessType: "hospitality",
      hospitalityModeEnabled: true,
      hospitalityIngredientPolicy: { policy: "warn", allowNegativeInventory: false },
    },
  });
  expect(openTestShift().ok).toBe(true);
}

const prepare = (batchId: string, portions = 5) =>
  st().prepareMenuBatch({
    productId: DISH,
    portions,
    expectedPortions: portions,
    actualPortions: portions,
    batchId,
  });

beforeEach(() => {
  spy = vi.spyOn(syncEngine, "enqueueSync").mockResolvedValue(undefined);
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prep batch durable events from the store", () => {
  it("create queues the batch event and KEEPS the existing creation stock path", async () => {
    expect(prepare("batch-c", 5).ok).toBe(true);
    await vi.waitFor(() => expect(prep("create")).toHaveLength(1));
    const event = prep("create")[0]!.payload as unknown as PrepBatchSyncPayload;
    expect(event).toMatchObject({
      eventId: "batch-c",
      batchId: "batch-c",
      productId: DISH,
      ingredientBasisPortions: 5,
    });
    expect(event.batch).toMatchObject({ id: "batch-c", portionsPrepared: 5 });
    expect(event.ingredientRequirements).toEqual([{ productId: ING, quantityBase: 2.5 }]);
    // Creation stock still rides the existing queue (this RPC changes batch state only).
    expect(stockOps().some((o) => String(o.payload.note) === "prep:batch-c")).toBe(true);
    expect(stockOps().some((o) => String(o.payload.note) === "prep_batch:batch-c")).toBe(true);
  });

  it("waste queues only the batch event; the server owns the portion-dependent stock", async () => {
    expect(prepare("batch-w", 5).ok).toBe(true);
    await vi.waitFor(() => expect(prep("create")).toHaveLength(1));
    spy.mockClear();

    expect(st().wastePreparedPortions({ batchId: "batch-w", portions: 2, reason: "unsold" }).ok).toBe(true);
    await vi.waitFor(() => expect(prep("waste")).toHaveLength(1));
    const event = prep("waste")[0]!.payload as unknown as PrepBatchSyncPayload;
    const movement = st().stockMovements.find((m) => m.id === event.eventId)!;
    expect(movement.deltaBaseUnits).toBe(-2);
    expect(event).toMatchObject({
      batchId: "batch-w",
      productId: DISH,
      portions: 2,
      dishStockAdjustmentId: movement.id,
    });
    expect(stockOps().some((o) => String(o.payload.note ?? "").startsWith("prep_waste"))).toBe(false);
  });

  it("cancel queues only the batch event; no duplicate stock ops are queued", async () => {
    expect(prepare("batch-x", 5).ok).toBe(true);
    await vi.waitFor(() => expect(prep("create")).toHaveLength(1));
    spy.mockClear();

    expect(st().cancelPrepBatch({ batchId: "batch-x" }).ok).toBe(true);
    await vi.waitFor(() => expect(prep("cancel")).toHaveLength(1));
    const event = prep("cancel")[0]!.payload as unknown as PrepBatchSyncPayload;
    expect(event).toMatchObject({ batchId: "batch-x", productId: DISH, portions: 5 });
    expect(event.dishStockAdjustmentId).toBeTruthy();
    expect(event.ingredientAdjustments?.length).toBeGreaterThan(0);
    expect(stockOps().some((o) => String(o.payload.note ?? "").startsWith("prep_cancel"))).toBe(false);
  });

  it("finalize, void and return queue their server-authoritative batch events", async () => {
    expect(prepare("batch-s", 5).ok).toBe(true);
    await vi.waitFor(() => expect(prep("create")).toHaveLength(1));
    spy.mockClear();

    usePosStore.setState({ draftLines: [line(2, "sale-line-1")] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    await vi.waitFor(() => expect(prep("sale_consume")).toHaveLength(1));
    const sale = st().sales[0]!;
    const saleLine = sale.lines[0]!;
    expect(saleLine.prepAllocation).toEqual([{ batchId: "batch-s", portions: 2 }]);
    expect(prep("sale_consume")[0]!.payload).toMatchObject({
      saleId: sale.id,
      saleLineId: saleLine.id,
    });

    spy.mockClear();
    expect(st().voidSaleLine({ saleId: sale.id, lineIndex: 0, reason: "wrong_item" }).ok).toBe(true);
    await vi.waitFor(() => expect(prep("sale_void")).toHaveLength(1));
    const voidRec = st().voidRecords[0]!;
    expect(prep("sale_void")[0]!.payload).toMatchObject({
      eventId: voidRec.id,
      saleId: sale.id,
      saleLineId: saleLine.id,
      quantity: 2,
    });

    // A fresh batch/sale for the return path.
    expect(prepare("batch-r", 5).ok).toBe(true);
    usePosStore.setState({ draftLines: [line(2, "sale-line-2")] });
    expect(st().finalizeDraftSale({ debtUgx: 0, paymentMethod: "cash" }).ok).toBe(true);
    const sale2 = st().sales.find((s) => s.id !== sale.id)!;
    spy.mockClear();
    expect(
      st().returnProduct({
        saleId: sale2.id,
        productId: DISH,
        quantity: 1,
        refundAmountUgx: 15_000,
        reason: "wrong_item",
        note: "n",
      }).ok,
    ).toBe(true);
    await vi.waitFor(() => expect(prep("sale_return")).toHaveLength(1));
    const ret = st().returnRecords[0]!;
    expect(prep("sale_return")[0]!.payload).toMatchObject({
      eventId: ret.id,
      saleId: sale2.id,
      saleLineId: sale2.lines[0]!.id,
      quantity: 1,
    });
  });
});
